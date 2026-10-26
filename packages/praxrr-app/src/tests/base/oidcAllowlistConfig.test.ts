/**
 * Config tests for the OIDC sign-in allowlist env vars (YAN-436).
 *
 * Mirrors trustedProxyConfig.test.ts: save/clear/restore the env vars around a cache-busting
 * dynamic import so the Config constructor re-reads Deno.env and re-runs `parseOidcAllowlist`.
 * The contract asserted here is that every allowlist variable reaches `config.oidc.allowlist`
 * parsed, that unset variables stay fail-closed, and that a malformed entry marks the policy
 * configured (so it cannot fall through to the allow-all opt-out) while granting nothing.
 */

import { assertEquals } from '@std/assert';
import type { OidcAllowlistPolicy } from '$auth/oidcAllowlist.ts';

type EnvRestore = Record<string, string | undefined>;

const OIDC_ENV_KEYS = [
  'OIDC_ALLOWED_SUBJECTS',
  'OIDC_ALLOWED_EMAILS',
  'OIDC_ALLOWED_GROUPS',
  'OIDC_GROUPS_CLAIM',
  'OIDC_ALLOW_ALL_USERS',
] as const;

/** Set/delete `vars`, import a fresh config, run `fn` against its allowlist, restore env. */
async function withOidcAllowlistEnv<T>(
  vars: Partial<Record<(typeof OIDC_ENV_KEYS)[number], string>>,
  fn: (allowlist: OidcAllowlistPolicy) => T
): Promise<T> {
  const saved: EnvRestore = {};
  for (const key of OIDC_ENV_KEYS) {
    saved[key] = Deno.env.get(key);
    const value = vars[key];
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  try {
    // Cache-busting specifier so the Config constructor re-reads Deno.env on every call.
    const timestamp = `${Date.now()}_${Math.random()}`;
    const mod = await import(`../../lib/server/utils/config/config.ts?t=${timestamp}`);
    return fn(mod.config.oidc.allowlist);
  } finally {
    for (const key of OIDC_ENV_KEYS) {
      if (saved[key] === undefined) Deno.env.delete(key);
      else Deno.env.set(key, saved[key]);
    }
  }
}

Deno.test('OIDC allowlist env: all five vars parse into config.oidc.allowlist', async () => {
  await withOidcAllowlistEnv(
    {
      OIDC_ALLOWED_SUBJECTS: 'admin-sub, other-sub',
      OIDC_ALLOWED_EMAILS: 'Admin@Corp.example, @Trusted.Org',
      OIDC_ALLOWED_GROUPS: 'Praxrr Admins, ops',
      OIDC_GROUPS_CLAIM: ' roles ',
      OIDC_ALLOW_ALL_USERS: 'true',
    },
    (allowlist) => {
      assertEquals([...allowlist.subjects], ['admin-sub', 'other-sub']);
      assertEquals([...allowlist.emails], ['admin@corp.example']);
      assertEquals([...allowlist.emailDomains], ['trusted.org']);
      assertEquals([...allowlist.groups], ['Praxrr Admins', 'ops']);
      // Padded claim names are trimmed; the claim stays top-level and exact.
      assertEquals(allowlist.groupsClaim, 'roles');
      assertEquals(allowlist.allowAll, true);
      assertEquals(allowlist.invalidEntries, []);
      assertEquals(allowlist.configured, true);
      assertEquals(allowlist.usableEntryCount, 6);
    }
  );
});

Deno.test('OIDC allowlist env: unset vars stay fail-closed with the default groups claim', async () => {
  await withOidcAllowlistEnv({}, (allowlist) => {
    assertEquals(allowlist.subjects.size, 0);
    assertEquals(allowlist.emails.size, 0);
    assertEquals(allowlist.emailDomains.size, 0);
    assertEquals(allowlist.groups.size, 0);
    assertEquals(allowlist.groupsClaim, 'groups');
    assertEquals(allowlist.allowAll, false);
    assertEquals(allowlist.invalidEntries, []);
    assertEquals(allowlist.configured, false);
    assertEquals(allowlist.usableEntryCount, 0);
  });
});

Deno.test('OIDC allowlist env: blank OIDC_GROUPS_CLAIM falls back to the default claim', async () => {
  await withOidcAllowlistEnv({ OIDC_GROUPS_CLAIM: '   ' }, (allowlist) => {
    assertEquals(allowlist.groupsClaim, 'groups');
  });
});

Deno.test('OIDC allowlist env: an invalid-only email entry is configured but grants nothing', async () => {
  await withOidcAllowlistEnv(
    {
      OIDC_ALLOWED_EMAILS: '@corp',
      OIDC_ALLOW_ALL_USERS: 'true',
    },
    (allowlist) => {
      assertEquals(allowlist.emails.size, 0);
      assertEquals(allowlist.emailDomains.size, 0);
      assertEquals(allowlist.invalidEntries, ['@corp']);
      // Tokens were supplied, so the policy counts as configured: the allow-all opt-out
      // must not take over just because every entry was malformed.
      assertEquals(allowlist.configured, true);
      assertEquals(allowlist.usableEntryCount, 0);
      assertEquals(allowlist.allowAll, true);
    }
  );
});
