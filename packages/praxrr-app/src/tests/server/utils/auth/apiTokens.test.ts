/**
 * Scoped API tokens (YAN-534, YAN-439, YAN-441, YAN-765): legacy key migration, token-first
 * authentication in every authenticating mode, revocation/expiry, and the route scope policy.
 */

import { assert, assertEquals, assertFalse, assertMatch, assertNotEquals } from '@std/assert';
import { createHash } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { config, type AuthMode } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { migrateLegacyApiKey } from '$db/migrations/20261021_create_api_tokens.ts';
import { apiTokensQueries } from '$db/queries/apiTokens.ts';
import { usersQueries } from '$db/queries/users.ts';
import { createApiToken, hashApiToken, resolveApiToken, ApiTokenValidationError } from '$auth/apiTokens.ts';
import { getAuthState } from '$auth/middleware.ts';
import { enforceTokenScope, requiredScopeFor } from '$auth/scopePolicy.ts';
import type { AuthPrincipal } from '$auth/principal.ts';
import { hasScope } from '$shared/auth/apiTokenScopes.ts';

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/api-tokens-${crypto.randomUUID()}`;
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

/** `config.authMode` is readonly; tests swap it and always restore. */
async function withAuthMode(mode: AuthMode, fn: () => Promise<void> | void): Promise<void> {
  const original = config.authMode;
  Object.defineProperty(config, 'authMode', { value: mode, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(config, 'authMode', { value: original, configurable: true, writable: true });
  }
}

function fakeEvent(path: string, headers: Record<string, string> = {}): RequestEvent {
  const url = new URL(`http://praxrr.test${path}`);
  return {
    url,
    request: new Request(url, { headers }),
    cookies: { get: () => undefined },
    getClientAddress: () => '203.0.113.10',
  } as unknown as RequestEvent;
}

// ---------------------------------------------------------------------------
// Legacy key migration
// ---------------------------------------------------------------------------

migratedTest('migrateLegacyApiKey converts an existing key into a hashed legacy admin token', async () => {
  const legacyKey = 'abcd0123456789abcdef0123456789ef';
  usersQueries.create('admin', 'hash');
  db.execute('UPDATE auth_settings SET api_key = ? WHERE id = 1', legacyKey);

  await migrateLegacyApiKey();

  const row = db.queryFirst<{ token_hash: string; prefix: string; is_legacy: number; scopes: string; name: string }>(
    'SELECT token_hash, prefix, is_legacy, scopes, name FROM api_tokens'
  )!;
  assertEquals(row.token_hash, createHash('sha256').update(legacyKey).digest('hex'));
  assertEquals(row.prefix, 'abcd');
  assertEquals(row.is_legacy, 1);
  assertEquals(JSON.parse(row.scopes), ['admin']);
  assertEquals(row.name, 'Legacy API key');
  assertEquals(db.queryFirst<{ api_key: string | null }>('SELECT api_key FROM auth_settings')!.api_key, null);
  assert(apiTokensQueries.hasActiveLegacy());

  // The old key keeps authenticating, now via hash lookup.
  const resolved = resolveApiToken(legacyKey);
  assertEquals(resolved?.isLegacy, true);

  // Idempotent: a second run inserts nothing.
  await migrateLegacyApiKey();
  assertEquals(apiTokensQueries.list().length, 1);
});

migratedTest('migrateLegacyApiKey without users clears the key and creates no token', async () => {
  db.execute('UPDATE auth_settings SET api_key = ? WHERE id = 1', 'ffff0123456789abcdef0123456789ef');

  await migrateLegacyApiKey();

  assertEquals(apiTokensQueries.list().length, 0);
  assertEquals(db.queryFirst<{ api_key: string | null }>('SELECT api_key FROM auth_settings')!.api_key, null);
});

migratedTest('migrateLegacyApiKey with only OIDC users clears the key and creates no token', async () => {
  usersQueries.getOrCreateOidcUser('someone');
  db.execute('UPDATE auth_settings SET api_key = ? WHERE id = 1', 'eeee0123456789abcdef0123456789ef');

  await migrateLegacyApiKey();

  assertEquals(apiTokensQueries.list().length, 0);
  assertEquals(db.queryFirst<{ api_key: string | null }>('SELECT api_key FROM auth_settings')!.api_key, null);
});

// ---------------------------------------------------------------------------
// Token creation
// ---------------------------------------------------------------------------

migratedTest('createApiToken stores only the hash and a display prefix', () => {
  const { token, secret } = createApiToken({ name: '  Grafana  ', scopes: ['read', 'read'], expiresInDays: '30' });
  assertMatch(secret, /^prx_[a-f0-9]{64}$/);
  assertEquals(token.name, 'Grafana');
  assertEquals(token.prefix, secret.slice(0, 8));
  assertEquals(token.scopes, ['read']);
  assertEquals(token.status, 'active');
  assertMatch(token.expiresAt!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const stored = db.queryFirst<{ token_hash: string }>('SELECT token_hash FROM api_tokens WHERE id = ?', token.id)!;
  assertEquals(stored.token_hash, hashApiToken(secret));
  assertFalse(JSON.stringify(apiTokensQueries.list()).includes(secret));
  assertFalse(JSON.stringify(apiTokensQueries.list()).includes(stored.token_hash));
});

migratedTest('createApiToken rejects invalid name, scopes, and expiry', () => {
  for (const input of [
    { name: '   ', scopes: ['read'], expiresInDays: null },
    { name: 'x'.repeat(65), scopes: ['read'], expiresInDays: null },
    { name: 'ok', scopes: [], expiresInDays: null },
    { name: 'ok', scopes: ['root'], expiresInDays: null },
    { name: 'ok', scopes: ['read'], expiresInDays: 7 },
  ]) {
    let thrown: unknown;
    try {
      createApiToken(input);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof ApiTokenValidationError, JSON.stringify(input));
  }
  assertEquals(createApiToken({ name: 'n', scopes: ['mcp'], expiresInDays: 'never' }).token.expiresAt, null);
});

// ---------------------------------------------------------------------------
// getAuthState
// ---------------------------------------------------------------------------

for (const mode of ['on', 'oidc'] as const) {
  migratedTest(`getAuthState authenticates a valid token on /api/v1 paths under AUTH=${mode}`, async () => {
    usersQueries.create('admin', 'hash');
    const { token, secret } = createApiToken({ name: 'metrics', scopes: ['read'], expiresInDays: null });

    await withAuthMode(mode, () => {
      const header = getAuthState(fakeEvent('/api/v1/metrics', { 'X-Api-Key': secret }));
      assertEquals(header.user?.id, 0);
      assertEquals(header.principal?.kind, 'token');
      if (header.principal?.kind === 'token') {
        assertEquals(header.principal.tokenId, token.id);
        assertEquals(header.principal.scopes, ['read']);
      }

      const query = getAuthState(fakeEvent(`/api/v1/metrics?apikey=${secret}`));
      assertEquals(query.principal?.kind, 'token');

      // Tokens never authenticate page routes or form actions.
      const page = getAuthState(fakeEvent('/settings/security', { 'X-Api-Key': secret }));
      assertEquals(page.user, null);
      assertEquals(page.principal, null);

      // Tokens only authenticate /api/v1/*; legacy app-internal /api/* routes need a session.
      for (const legacyPath of ['/api/backups/download/backup-2026-01-01-000000.tar.gz', '/api/databases']) {
        const legacy = getAuthState(fakeEvent(legacyPath, { 'X-Api-Key': secret }));
        assertEquals(legacy.user, null, legacyPath);
        assertEquals(legacy.principal, null, legacyPath);
      }

      const invalid = getAuthState(fakeEvent('/api/v1/metrics', { 'X-Api-Key': 'prx_nottherightsecret' }));
      assertEquals(invalid.user, null);
      assertEquals(invalid.principal, null);
    });

    const used = apiTokensQueries.list().find((row) => row.id === token.id)!;
    assertNotEquals(used.lastUsedAt, null);
  });
}

migratedTest('getAuthState rejects revoked and expired tokens', async () => {
  usersQueries.create('admin', 'hash');
  const revoked = createApiToken({ name: 'revoked', scopes: ['admin'], expiresInDays: null });
  const expired = createApiToken({ name: 'expired', scopes: ['admin'], expiresInDays: 30 });

  await withAuthMode('on', () => {
    assertEquals(getAuthState(fakeEvent('/api/v1/x', { 'X-Api-Key': revoked.secret })).principal?.kind, 'token');
    assert(apiTokensQueries.revoke(revoked.token.id));
    assertFalse(apiTokensQueries.revoke(revoked.token.id));
    assertEquals(getAuthState(fakeEvent('/api/v1/x', { 'X-Api-Key': revoked.secret })).principal, null);

    db.execute("UPDATE api_tokens SET expires_at = datetime('now', '-1 minute') WHERE id = ?", expired.token.id);
    assertEquals(getAuthState(fakeEvent('/api/v1/x', { 'X-Api-Key': expired.secret })).principal, null);
  });

  const statuses = Object.fromEntries(apiTokensQueries.list().map((row) => [row.name, row.status]));
  assertEquals(statuses, { revoked: 'revoked', expired: 'expired' });
  assertEquals(apiTokensQueries.countActive(), 0);
});

migratedTest('touchLastUsed throttles writes to once per 60 seconds', () => {
  const { token } = createApiToken({ name: 't', scopes: ['read'], expiresInDays: null });
  db.execute("UPDATE api_tokens SET last_used_at = datetime('now', '-30 seconds') WHERE id = ?", token.id);
  const before = apiTokensQueries.list()[0].lastUsedAt;
  apiTokensQueries.touchLastUsed(token.id);
  assertEquals(apiTokensQueries.list()[0].lastUsedAt, before);

  db.execute("UPDATE api_tokens SET last_used_at = datetime('now', '-5 minutes') WHERE id = ?", token.id);
  const stale = apiTokensQueries.list()[0].lastUsedAt;
  apiTokensQueries.touchLastUsed(token.id);
  assertNotEquals(apiTokensQueries.list()[0].lastUsedAt, stale);
});

// ---------------------------------------------------------------------------
// Scope policy
// ---------------------------------------------------------------------------

Deno.test('requiredScopeFor maps routes to scopes and fails closed', () => {
  const cases: [string, string, string][] = [
    ['GET', '/api/v1/metrics', 'read'],
    ['HEAD', '/api/v1/arr/library', 'read'],
    ['GET', '/api/v1/arr/library', 'read'],
    ['GET', '/api/v1/arr/releases', 'admin'],
    ['HEAD', '/api/v1/arr/releases', 'admin'],
    ['GET', '/api/v1/mcp', 'mcp'],
    ['POST', '/api/v1/mcp', 'mcp'],
    ['POST', '/api/v1/sync/preview', 'read'],
    ['POST', '/api/v1/goals/preview', 'read'],
    ['POST', '/api/v1/simulate/score', 'admin'],
    ['POST', '/api/v1/simulate/impact', 'admin'],
    ['POST', '/api/v1/entity-testing/evaluate', 'admin'],
    ['POST', '/api/v1/sync/preview/preview_1_2_abc/apply', 'sync:apply'],
    ['POST', '/api/v1/trash-guide/sources/3/sync', 'sync:apply'],
    ['POST', '/api/v1/goals/apply', 'sync:apply'],
    ['POST', '/api/v1/pcd/1/snapshots/9/rollback', 'sync:apply'],
    ['POST', '/api/v1/canary/rollouts', 'sync:apply'],
    ['POST', '/api/v1/canary/rollouts/4/proceed', 'sync:apply'],
    ['POST', '/api/v1/canary/rollouts/4/abort', 'sync:apply'],
    // Anchored segments: siblings and deeper paths do not inherit a weaker scope.
    ['POST', '/api/v1/sync/preview/x/apply/extra', 'admin'],
    ['POST', '/api/v1/goals/preview-and-apply', 'admin'],
    ['POST', '/api/v1/mcpx', 'admin'],
    ['DELETE', '/api/v1/sync/preview/abc', 'admin'],
    ['PUT', '/api/v1/canary/settings', 'admin'],
    ['POST', '/api/v1/goals/reconcile', 'admin'],
    ['POST', '/api/v1/unknown', 'admin'],
    ['POST', '/api/databases/1/generate-commit-message', 'admin'],
  ];
  for (const [method, path, scope] of cases) {
    assertEquals(requiredScopeFor(method, path), scope, `${method} ${path}`);
  }
});

Deno.test('hasScope: admin implies every scope; otherwise exact membership', () => {
  for (const scope of ['read', 'mcp', 'sync:apply', 'admin'] as const) {
    assert(hasScope(['admin'], scope));
  }
  assert(hasScope(['read'], 'read'));
  assertFalse(hasScope(['read'], 'admin'));
  assertFalse(hasScope(['read'], 'mcp'));
  assertFalse(hasScope(['sync:apply'], 'read'));
  assertFalse(hasScope([], 'read'));
});

migratedTest('enforceTokenScope returns 403 for an under-scoped token and passes otherwise', async () => {
  usersQueries.create('admin', 'hash');
  const { secret } = createApiToken({ name: 'reader', scopes: ['read'], expiresInDays: null });

  await withAuthMode('on', async () => {
    const principal = getAuthState(fakeEvent('/api/v1/metrics', { 'X-Api-Key': secret })).principal;
    assertEquals(principal?.kind, 'token');

    const patchEvent = {
      url: new URL('http://praxrr.test/api/v1/canary/settings'),
      request: new Request('http://praxrr.test/api/v1/canary/settings', { method: 'PATCH' }),
    };
    const denied = enforceTokenScope(patchEvent, principal);
    assertEquals(denied?.status, 403);
    assertEquals(denied?.headers.get('Content-Type'), 'application/json');
    assertEquals(await denied?.json(), { error: 'Forbidden', requiredScope: 'admin' });

    assertEquals(enforceTokenScope(fakeEvent('/api/v1/metrics'), principal), null);

    const session: AuthPrincipal = { kind: 'session', scopes: ['admin'] };
    assertEquals(enforceTokenScope(patchEvent, session), null);
    assertEquals(enforceTokenScope(patchEvent, null), null);
  });
});
