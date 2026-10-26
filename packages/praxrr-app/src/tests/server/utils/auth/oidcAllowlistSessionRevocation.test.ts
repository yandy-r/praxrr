import { assert, assertEquals } from '@std/assert';
import { config, type AuthMode } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { oidcAllowlistStateQueries } from '$db/queries/oidcAllowlistState.ts';
import { sessionsQueries, hashSessionToken } from '$db/queries/sessions.ts';
import { usersQueries } from '$db/queries/users.ts';
import { fingerprintOidcAllowlist, revokeOidcSessionsOnAllowlistChange } from '$auth/oidcAllowlistSessionRevocation.ts';
import { parseOidcAllowlist, type OidcAllowlistPolicy } from '$auth/oidcAllowlist.ts';

/** Real scratch SQLite DB per test with the full migration chain. */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/oidc-allowlist-revocation-${crypto.randomUUID()}`;
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

async function withAuthPolicy(
  mode: AuthMode,
  policy: OidcAllowlistPolicy,
  fn: () => Promise<void> | void
): Promise<void> {
  const originalMode = config.authMode;
  const originalOidc = config.oidc;
  Object.defineProperty(config, 'authMode', { value: mode, configurable: true, writable: true });
  Object.defineProperty(config, 'oidc', {
    value: { ...originalOidc, allowlist: policy },
    configurable: true,
    writable: true,
  });
  try {
    await fn();
  } finally {
    Object.defineProperty(config, 'authMode', {
      value: originalMode,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(config, 'oidc', {
      value: originalOidc,
      configurable: true,
      writable: true,
    });
  }
}

function sessionIds(): string[] {
  return db.query<{ id: string }>('SELECT id FROM sessions ORDER BY id').map((row) => row.id);
}

Deno.test('fingerprintOidcAllowlist hashes effective semantics and ignores inert fields', () => {
  const first = parseOidcAllowlist({
    subjects: 'subject-b,subject-a',
    emails: 'second@example.com,@example.org,first@example.com',
    groups: 'group-b,group-a',
    groupsClaim: 'roles',
    allowAll: 'true',
  });
  const reordered = parseOidcAllowlist({
    subjects: 'subject-a,subject-b',
    emails: '@example.org,first@example.com,second@example.com',
    groups: 'group-a,group-b',
    groupsClaim: 'roles',
    allowAll: 'true',
  });
  const fingerprint = fingerprintOidcAllowlist(first);
  assert(/^[0-9a-f]{64}$/.test(fingerprint));
  assertEquals(fingerprint, fingerprintOidcAllowlist(reordered));

  const variants = [
    parseOidcAllowlist({
      subjects: 'subject-a,subject-c',
      emails: 'second@example.com,@example.org,first@example.com',
      groups: 'group-b,group-a',
      groupsClaim: 'roles',
      allowAll: 'true',
    }),
    parseOidcAllowlist({
      subjects: 'subject-b,subject-a',
      emails: '@example.org,first@example.com',
      groups: 'group-b,group-a',
      groupsClaim: 'roles',
      allowAll: 'true',
    }),
    parseOidcAllowlist({
      subjects: 'subject-b,subject-a',
      emails: 'first@example.com,second@example.com',
      groups: 'group-b,group-a',
      groupsClaim: 'roles',
      allowAll: 'true',
    }),
    parseOidcAllowlist({
      subjects: 'subject-b,subject-a',
      emails: 'second@example.com,@example.org,first@example.com',
      groups: 'group-a,group-c',
      groupsClaim: 'roles',
      allowAll: 'true',
    }),
    parseOidcAllowlist({
      subjects: 'subject-b,subject-a',
      emails: 'second@example.com,@example.org,first@example.com',
      groups: 'group-b,group-a',
      groupsClaim: 'groups',
      allowAll: 'true',
    }),
    parseOidcAllowlist({
      subjects: 'subject-b,subject-a',
      emails: '@invalid',
      groups: 'group-b,group-a',
      groupsClaim: 'roles',
      allowAll: 'true',
    }),
  ];
  for (const variant of variants) {
    assert(fingerprintOidcAllowlist(variant) !== fingerprint);
  }

  // allowAll is inert while any list is configured: lists are authoritative, so toggling it
  // must not re-revoke every OIDC session.
  const allowAllToggled = parseOidcAllowlist({
    subjects: 'subject-b,subject-a',
    emails: 'second@example.com,@example.org,first@example.com',
    groups: 'group-b,group-a',
    groupsClaim: 'roles',
    allowAll: 'false',
  });
  assertEquals(fingerprintOidcAllowlist(allowAllToggled), fingerprint);

  // groupsClaim names a claim to read group entries from; with no groups configured the
  // claim can never match, so renaming it is not a semantic change.
  const claimRenamedWithoutGroups = parseOidcAllowlist({
    subjects: 'subject-b,subject-a',
    emails: 'second@example.com,@example.org,first@example.com',
    groupsClaim: 'entirely-different-claim',
    allowAll: 'true',
  });
  const originalClaimWithoutGroups = parseOidcAllowlist({
    subjects: 'subject-b,subject-a',
    emails: 'second@example.com,@example.org,first@example.com',
    groupsClaim: 'roles',
    allowAll: 'true',
  });
  assertEquals(
    fingerprintOidcAllowlist(claimRenamedWithoutGroups),
    fingerprintOidcAllowlist(originalClaimWithoutGroups)
  );

  // With groups configured the claim is live, and with no lists at all allowAll alone
  // decides sign-in — both remain effective fields that must change the fingerprint.
  const claimRenamedWithGroups = parseOidcAllowlist({
    groups: 'group-a',
    groupsClaim: 'roles',
  });
  assert(
    fingerprintOidcAllowlist(claimRenamedWithGroups) !==
      fingerprintOidcAllowlist(parseOidcAllowlist({ groups: 'group-a', groupsClaim: 'other' }))
  );
  assert(
    fingerprintOidcAllowlist(parseOidcAllowlist({ allowAll: 'true' })) !==
      fingerprintOidcAllowlist(parseOidcAllowlist({}))
  );
});

migratedTest('changed and first-run policies revoke every OIDC session and retain local sessions', async () => {
  const localId = usersQueries.create('admin', 'local-hash');
  const oidcId = usersQueries.getOrCreateOidcUser('subject-a');
  const secondOidcId = usersQueries.getOrCreateOidcUser('subject-b');
  // Legacy lookalike: exact prefix without the OIDC placeholder remains a local identity.
  db.execute("INSERT INTO users (username, password_hash) VALUES ('oidc:local', 'hash')");
  const lookalikeId = usersQueries.getByUsername('oidc:local');
  assert(lookalikeId);
  const localSessions = [
    hashSessionToken(sessionsQueries.create(localId, 1)),
    hashSessionToken(sessionsQueries.create(lookalikeId.id, 1)),
  ].sort();
  sessionsQueries.create(oidcId, 1);
  sessionsQueries.create(secondOidcId, 1);

  assertEquals(oidcAllowlistStateQueries.getFingerprint(), null);
  await withAuthPolicy('oidc', parseOidcAllowlist({ subjects: 'subject-a' }), async () => {
    assertEquals(await revokeOidcSessionsOnAllowlistChange(), { changed: true, deletedSessions: 2 });
  });
  assertEquals(sessionIds(), localSessions);
  assertEquals(db.queryFirst<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count, 4);
  assertEquals(
    oidcAllowlistStateQueries.getFingerprint(),
    fingerprintOidcAllowlist(parseOidcAllowlist({ subjects: 'subject-a' }))
  );

  sessionsQueries.create(oidcId, 1);
  await withAuthPolicy('oidc', parseOidcAllowlist({ subjects: 'subject-b' }), async () => {
    assertEquals(await revokeOidcSessionsOnAllowlistChange(), { changed: true, deletedSessions: 1 });
  });
  assertEquals(sessionIds(), localSessions);
});

migratedTest('unchanged policy leaves existing sessions and fingerprint untouched', async () => {
  const policy = parseOidcAllowlist({ subjects: 'subject-a' });
  const oidcId = usersQueries.getOrCreateOidcUser('subject-a');
  const localId = usersQueries.create('admin', 'local-hash');

  await withAuthPolicy('oidc', policy, async () => {
    await revokeOidcSessionsOnAllowlistChange();
    const oidcSession = hashSessionToken(sessionsQueries.create(oidcId, 1));
    const localSession = hashSessionToken(sessionsQueries.create(localId, 1));
    const before = oidcAllowlistStateQueries.getFingerprint();

    assertEquals(await revokeOidcSessionsOnAllowlistChange(), { changed: false, deletedSessions: 0 });
    assertEquals(sessionIds(), [localSession, oidcSession].sort());
    assertEquals(oidcAllowlistStateQueries.getFingerprint(), before);
  });
});

migratedTest('adding an invalid-only entry changes configured state and revokes OIDC sessions', async () => {
  const oidcId = usersQueries.getOrCreateOidcUser('subject-a');
  const localId = usersQueries.create('admin', 'local-hash');
  const localSession = hashSessionToken(sessionsQueries.create(localId, 1));
  const allowAll = parseOidcAllowlist({ allowAll: 'true' });
  const unconfigured = parseOidcAllowlist({});
  assert(fingerprintOidcAllowlist(allowAll) !== fingerprintOidcAllowlist(unconfigured));
  const invalidOnly = parseOidcAllowlist({ allowAll: 'true', emails: '@invalid' });
  assertEquals(invalidOnly.usableEntryCount, 0);
  assertEquals(invalidOnly.configured, true);

  await withAuthPolicy('oidc', allowAll, async () => {
    await revokeOidcSessionsOnAllowlistChange();
  });
  sessionsQueries.create(oidcId, 1);
  await withAuthPolicy('oidc', invalidOnly, async () => {
    assertEquals(await revokeOidcSessionsOnAllowlistChange(), { changed: true, deletedSessions: 1 });
  });
  assertEquals(sessionIds(), [localSession]);

  await withAuthPolicy('oidc', unconfigured, async () => {
    await revokeOidcSessionsOnAllowlistChange();
  });
  sessionsQueries.create(oidcId, 1);
  await withAuthPolicy('oidc', invalidOnly, async () => {
    assertEquals(await revokeOidcSessionsOnAllowlistChange(), { changed: true, deletedSessions: 1 });
  });
  assertEquals(sessionIds(), [localSession]);
});

migratedTest('non-OIDC modes neither revoke sessions nor store a policy fingerprint', async () => {
  const oidcId = usersQueries.getOrCreateOidcUser('subject-a');
  const localId = usersQueries.create('admin', 'local-hash');
  const oidcSession = hashSessionToken(sessionsQueries.create(oidcId, 1));
  const localSession = hashSessionToken(sessionsQueries.create(localId, 1));

  for (const mode of ['on', 'local', 'off'] as const) {
    await withAuthPolicy(mode, parseOidcAllowlist({ subjects: 'subject-a' }), async () => {
      assertEquals(await revokeOidcSessionsOnAllowlistChange(), { changed: false, deletedSessions: 0 });
    });
    assertEquals(sessionIds(), [localSession, oidcSession].sort(), mode);
    assertEquals(oidcAllowlistStateQueries.getFingerprint(), null, mode);
  }
});
