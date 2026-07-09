import { assert, assertEquals, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { webauthnCredentialsQueries } from '$db/queries/webauthnCredentials.ts';
import { webauthnChallengesQueries } from '$db/queries/webauthnChallenges.ts';
import { isCounterRegression, defaultCredentialName } from '$lib/server/webauthn/ceremonies.ts';
import { deriveWebAuthnRp, type WebAuthnRpRequestInfo, type WebAuthnRpOverrides } from '$lib/server/webauthn/rp.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain (so the webauthn_* tables exist), invoke the body, then tear the connection
 * down. Mirrors configHealthSettings.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/webauthn-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

/** Insert a user directly (avoids importing the whole auth stack) and return its id. */
function seedUser(username: string): number {
  db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', username, 'x');
  const row = db.queryFirst<{ id: number }>('SELECT id FROM users WHERE username = ?', username);
  assert(row, `seeded user ${username} should exist`);
  return row.id;
}

function makeCredentialInput(userId: number, overrides: Record<string, unknown> = {}) {
  return {
    id: 'credA',
    userId,
    publicKey: 'pkA',
    counter: 0,
    transports: ['internal', 'hybrid'] as string[] | null,
    deviceType: 'multiDevice' as const,
    backedUp: true,
    webauthnUserId: 'dXNlcg',
    aaguid: null,
    name: 'My Key',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema / DDL
// ---------------------------------------------------------------------------

migratedTest('migration 20260717 creates the webauthn tables and indexes', () => {
  const tables = db
    .query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('webauthn_credentials', 'webauthn_challenges') ORDER BY name"
    )
    .map((r) => r.name);
  assertEquals(tables, ['webauthn_challenges', 'webauthn_credentials']);

  const indexes = db
    .query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_webauthn_credentials_user', 'idx_webauthn_credentials_name', 'idx_webauthn_challenges_expires') ORDER BY name"
    )
    .map((r) => r.name);
  assertEquals(indexes, ['idx_webauthn_challenges_expires', 'idx_webauthn_credentials_name', 'idx_webauthn_credentials_user']);
});

// ---------------------------------------------------------------------------
// Credential CRUD
// ---------------------------------------------------------------------------

migratedTest('create + getById round-trips all fields with correct encodings', () => {
  const userId = seedUser('admin');
  const created = webauthnCredentialsQueries.create(makeCredentialInput(userId));
  assertEquals(created.id, 'credA');

  const row = webauthnCredentialsQueries.getById('credA');
  assert(row);
  assertEquals(row.transports, '["internal","hybrid"]');
  assertEquals(row.backed_up, 1);
  assertEquals(row.device_type, 'multiDevice');
  assertEquals(row.counter, 0);
  assertEquals(row.name, 'My Key');
  assertEquals(row.last_used_at, null);
});

migratedTest('null transports persist as null', () => {
  const userId = seedUser('admin');
  webauthnCredentialsQueries.create(makeCredentialInput(userId, { id: 'credN', transports: null, name: 'No Transports' }));
  assertEquals(webauthnCredentialsQueries.getById('credN')?.transports, null);
});

migratedTest('listByUserId is per-user, ordered by created_at then id', () => {
  const user1 = seedUser('admin');
  const user2 = seedUser('other');
  webauthnCredentialsQueries.create(makeCredentialInput(user1, { id: 'c1', name: 'One' }));
  webauthnCredentialsQueries.create(makeCredentialInput(user1, { id: 'c2', name: 'Two' }));
  webauthnCredentialsQueries.create(makeCredentialInput(user2, { id: 'c3', name: 'Three' }));

  const forUser1 = webauthnCredentialsQueries.listByUserId(user1).map((r) => r.id);
  assertEquals(forUser1, ['c1', 'c2']);
  assertEquals(webauthnCredentialsQueries.listByUserId(user2).map((r) => r.id), ['c3']);
});

migratedTest('countByUserId and count', () => {
  const user1 = seedUser('admin');
  const user2 = seedUser('other');
  webauthnCredentialsQueries.create(makeCredentialInput(user1, { id: 'c1', name: 'One' }));
  webauthnCredentialsQueries.create(makeCredentialInput(user1, { id: 'c2', name: 'Two' }));
  webauthnCredentialsQueries.create(makeCredentialInput(user2, { id: 'c3', name: 'Three' }));

  assertEquals(webauthnCredentialsQueries.countByUserId(user1), 2);
  assertEquals(webauthnCredentialsQueries.countByUserId(user2), 1);
  assertEquals(webauthnCredentialsQueries.count(), 3);
});

migratedTest('credential names are unique per user, case-insensitively', () => {
  const userId = seedUser('admin');
  const otherId = seedUser('other');
  webauthnCredentialsQueries.create(makeCredentialInput(userId, { id: 'c1', name: 'MyKey' }));

  assert(webauthnCredentialsQueries.existsByNameForUser(userId, 'mykey'));
  assert(webauthnCredentialsQueries.existsByNameForUser(userId, 'MYKEY'));
  assert(!webauthnCredentialsQueries.existsByNameForUser(otherId, 'MyKey'));

  assertThrows(() => webauthnCredentialsQueries.create(makeCredentialInput(userId, { id: 'c2', name: 'MYKEY' })));

  // Same name is allowed for a different user.
  webauthnCredentialsQueries.create(makeCredentialInput(otherId, { id: 'c3', name: 'MyKey' }));
  assertEquals(webauthnCredentialsQueries.countByUserId(otherId), 1);
});

migratedTest('rename is scoped to the owner', () => {
  const userId = seedUser('admin');
  const wrongUser = seedUser('other');
  webauthnCredentialsQueries.create(makeCredentialInput(userId));

  assertEquals(webauthnCredentialsQueries.rename('credA', userId, 'Renamed'), 1);
  assertEquals(webauthnCredentialsQueries.getById('credA')?.name, 'Renamed');

  assertEquals(webauthnCredentialsQueries.rename('credA', wrongUser, 'Hacked'), 0);
  assertEquals(webauthnCredentialsQueries.getById('credA')?.name, 'Renamed');
});

migratedTest('updateCounter bumps counter and stamps last_used_at', () => {
  const userId = seedUser('admin');
  webauthnCredentialsQueries.create(makeCredentialInput(userId));
  assertEquals(webauthnCredentialsQueries.getById('credA')?.last_used_at, null);

  assertEquals(webauthnCredentialsQueries.updateCounter('credA', 7), 1);
  const row = webauthnCredentialsQueries.getById('credA');
  assertEquals(row?.counter, 7);
  assert(row?.last_used_at, 'last_used_at should be set');
});

migratedTest('deleteById is scoped to the owner', () => {
  const userId = seedUser('admin');
  const wrongUser = seedUser('other');
  webauthnCredentialsQueries.create(makeCredentialInput(userId));

  assertEquals(webauthnCredentialsQueries.deleteById('credA', wrongUser), 0);
  assert(webauthnCredentialsQueries.getById('credA'));

  assertEquals(webauthnCredentialsQueries.deleteById('credA', userId), 1);
  assertEquals(webauthnCredentialsQueries.getById('credA'), undefined);
});

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

migratedTest('challenge consume is single-use', () => {
  const userId = seedUser('admin');
  const handle = webauthnChallengesQueries.create('chal123', 'register', userId, 300);

  const first = webauthnChallengesQueries.consume(handle, 'register');
  assertEquals(first?.challenge, 'chal123');
  assertEquals(first?.userId, userId);

  assertEquals(webauthnChallengesQueries.consume(handle, 'register'), undefined);
});

migratedTest('challenge consume with wrong purpose misses and still deletes the row', () => {
  const handle = webauthnChallengesQueries.create('chalAuth', 'authenticate', null, 300);
  assertEquals(webauthnChallengesQueries.consume(handle, 'register'), undefined);
  // DELETE-always means the row is gone even after a purpose mismatch.
  assertEquals(webauthnChallengesQueries.consume(handle, 'authenticate'), undefined);
});

migratedTest('expired challenge cannot be consumed', () => {
  const handle = webauthnChallengesQueries.create('chalExpired', 'authenticate', null, -1);
  assertEquals(webauthnChallengesQueries.consume(handle, 'authenticate'), undefined);
});

migratedTest('deleteExpired removes only expired challenges', () => {
  const expired = webauthnChallengesQueries.create('old', 'authenticate', null, -1);
  const live = webauthnChallengesQueries.create('new', 'authenticate', null, 300);

  assertEquals(webauthnChallengesQueries.deleteExpired(), 1);
  assertEquals(webauthnChallengesQueries.consume(expired, 'authenticate'), undefined);
  assertEquals(webauthnChallengesQueries.consume(live, 'authenticate')?.challenge, 'new');
});

// ---------------------------------------------------------------------------
// Pure helpers (no DB)
// ---------------------------------------------------------------------------

Deno.test('isCounterRegression: platform passkeys stuck at 0 are allowed', () => {
  assertEquals(isCounterRegression(0, 0), false); // Touch ID / iCloud — never increments
  assertEquals(isCounterRegression(10, 0), false); // first increment from a 0-counter authenticator
  assertEquals(isCounterRegression(1, 0), false);
  assertEquals(isCounterRegression(6, 5), false); // normal advance
  assertEquals(isCounterRegression(5, 5), true); // replay / clone
  assertEquals(isCounterRegression(3, 5), true); // regression
  assertEquals(isCounterRegression(0, 5), true); // regression to 0 with prior > 0
});

Deno.test('defaultCredentialName derives from UA and falls back to Passkey', () => {
  assertEquals(defaultCredentialName(''), 'Passkey');
  const named = defaultCredentialName(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
  );
  assert(named.startsWith('Chrome'));
  assert(named.includes('macOS'));
});

const baseInfo: WebAuthnRpRequestInfo = {
  forwardedHost: null,
  host: null,
  forwardedProto: null,
  urlProtocol: 'http:',
  urlHost: '',
  urlHostname: '',
};
const noOverrides: WebAuthnRpOverrides = { rpId: null, origin: null, rpName: 'Praxrr' };

Deno.test('deriveWebAuthnRp: env overrides win', () => {
  const rp = deriveWebAuthnRp(baseInfo, {
    rpId: 'example.com',
    origin: 'https://example.com,http://host:6868',
    rpName: 'Praxrr',
  });
  assertEquals(rp.rpID, 'example.com');
  assertEquals(rp.allowedOrigins, ['https://example.com', 'http://host:6868']);
  assertEquals(rp.rpName, 'Praxrr');
});

Deno.test('deriveWebAuthnRp: derives from X-Forwarded-* with the port stripped from rpID', () => {
  const rp = deriveWebAuthnRp(
    { ...baseInfo, forwardedHost: 'app.example.com:8443', forwardedProto: 'https' },
    noOverrides
  );
  assertEquals(rp.rpID, 'app.example.com');
  assertEquals(rp.allowedOrigins, ['https://app.example.com:8443']);
});

Deno.test('deriveWebAuthnRp: falls back to the Host header and url protocol', () => {
  const rp = deriveWebAuthnRp({ ...baseInfo, host: 'localhost:6868', urlProtocol: 'http:' }, noOverrides);
  assertEquals(rp.rpID, 'localhost');
  assertEquals(rp.allowedOrigins, ['http://localhost:6868']);
});

Deno.test('deriveWebAuthnRp: throws when no host resolves and no overrides', () => {
  assertThrows(() => deriveWebAuthnRp(baseInfo, noOverrides));
});
