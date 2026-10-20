// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals, assertFalse } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { apiTokensQueries } from '$db/queries/apiTokens.ts';
import type { AuthPrincipal } from '$auth/principal.ts';
import { API_TOKEN_SCOPES, type ApiTokenSummary } from '$shared/auth/apiTokenScopes.ts';
import { actions, load } from '../../routes/settings/security/+page.server.ts';

type ActionFailure = { status: number; data?: { apiTokenError?: string } };
type CreatedResult = { createdApiToken: { secret: string; token: ApiTokenSummary } };

/** Real scratch SQLite DB per test with the full migration chain (includes api_tokens). */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/security-api-tokens-route-${crypto.randomUUID()}`;
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

const bypassPrincipal: AuthPrincipal = { kind: 'bypass', scopes: API_TOKEN_SCOPES };

function localsOf(principal: AuthPrincipal | null): App.Locals {
  return { user: null, session: null, authBypass: principal?.kind === 'bypass', principal };
}

function formEvent(locals: App.Locals, form: (fd: FormData) => void) {
  const fd = new FormData();
  form(fd);
  return {
    request: new Request('http://localhost/settings/security', { method: 'POST', body: fd }),
    locals,
  } as unknown as Parameters<typeof actions.createApiToken>[0];
}

async function loadPayload(locals: App.Locals): Promise<Record<string, unknown>> {
  return (await load({
    locals,
    setHeaders: () => {},
  } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
}

async function createToken(
  locals: App.Locals,
  fields: { name?: string; scopes?: string[]; expiresInDays?: string }
): Promise<unknown> {
  return await actions.createApiToken(
    formEvent(locals, (fd) => {
      if (fields.name !== undefined) fd.set('name', fields.name);
      for (const scope of fields.scopes ?? []) fd.append('scopes', scope);
      if (fields.expiresInDays !== undefined) fd.set('expiresInDays', fields.expiresInDays);
    })
  );
}

migratedTest('createApiToken: returns the secret once; load never exposes secret or hash', async () => {
  const locals = localsOf(bypassPrincipal);
  const result = (await createToken(locals, {
    name: 'Home Assistant',
    scopes: ['read', 'mcp'],
    expiresInDays: '30',
  })) as CreatedResult;

  const { secret, token } = result.createdApiToken;
  assert(secret.startsWith('prx_'));
  assertEquals(token.name, 'Home Assistant');
  assertEquals([...token.scopes].sort(), ['mcp', 'read']);
  assertEquals(token.status, 'active');
  assert(token.expiresAt);
  assertFalse(JSON.stringify(token).includes(secret), 'token summary must not contain the secret');

  const payload = await loadPayload(locals);
  const serialized = JSON.stringify(payload);
  const storedHash = db.queryFirst<{ token_hash: string }>(
    'SELECT token_hash FROM api_tokens WHERE id = ?',
    token.id
  )!.token_hash;

  assertFalse(serialized.includes(secret), 'load payload leaks the token secret');
  assertFalse(serialized.includes(storedHash), 'load payload leaks the token hash');
  assertFalse(serialized.includes('token_hash'), 'load payload exposes a token_hash field');
  assertEquals(
    (payload.apiTokens as ApiTokenSummary[]).map((t) => t.id),
    [token.id]
  );
  assertEquals(payload.hasLegacyApiToken, false);
});

migratedTest('createApiToken: invalid name or scopes fail with 400 and create nothing', async () => {
  const locals = localsOf(bypassPrincipal);
  const invalid = [
    { name: '', scopes: ['read'] },
    { name: '   ', scopes: ['read'] },
    { name: 'x'.repeat(65), scopes: ['read'] },
    { name: 'No scopes', scopes: [] },
    { name: 'Unknown scope', scopes: ['superuser'] },
    { name: 'Bad expiry', scopes: ['read'], expiresInDays: '7' },
  ];

  for (const fields of invalid) {
    const result = (await createToken(locals, fields)) as ActionFailure;
    assertEquals(result.status, 400, `expected 400 for ${JSON.stringify(fields)}`);
    assert(result.data?.apiTokenError);
  }
  assertEquals(apiTokensQueries.list(), []);
});

migratedTest('revokeApiToken: revokes once, then 404; malformed id 400', async () => {
  const locals = localsOf(bypassPrincipal);
  const { token } = ((await createToken(locals, { name: 'CI', scopes: ['read'] })) as CreatedResult).createdApiToken;

  const revoke = (id: string) => actions.revokeApiToken(formEvent(locals, (fd) => fd.set('id', id)));

  assertEquals(await revoke(String(token.id)), { apiTokenRevoked: true });
  assertEquals(apiTokensQueries.list().find((t) => t.id === token.id)?.status, 'revoked');

  assertEquals(((await revoke(String(token.id))) as ActionFailure).status, 404);
  assertEquals(((await revoke('999999')) as ActionFailure).status, 404);
  for (const bad of ['', '0', '-1', 'abc', '1.5']) {
    assertEquals(((await revoke(bad)) as ActionFailure).status, 400, `expected 400 for '${bad}'`);
  }
});

migratedTest('token actions: non-interactive principals get 403', async () => {
  const { token } = (
    (await createToken(localsOf(bypassPrincipal), { name: 'Keep', scopes: ['read'] })) as CreatedResult
  ).createdApiToken;

  const tokenPrincipal: AuthPrincipal = {
    kind: 'token',
    tokenId: token.id,
    tokenName: token.name,
    isLegacy: false,
    scopes: ['admin'],
  };

  for (const locals of [localsOf(null), localsOf(tokenPrincipal)]) {
    const created = (await createToken(locals, { name: 'Denied', scopes: ['read'] })) as ActionFailure;
    assertEquals(created.status, 403);
    assertEquals(created.data?.apiTokenError, 'Not allowed');

    const revoked = (await actions.revokeApiToken(
      formEvent(locals, (fd) => fd.set('id', String(token.id)))
    )) as ActionFailure;
    assertEquals(revoked.status, 403);
  }

  assertEquals(
    apiTokensQueries.list().map((t) => [t.name, t.status]),
    [['Keep', 'active']]
  );
});
