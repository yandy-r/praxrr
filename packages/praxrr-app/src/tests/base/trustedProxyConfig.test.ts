/**
 * Unit tests for TRUSTED_PROXY config parsing (issue #228).
 *
 * Mirrors pullOnStartupConfig.test.ts: save/clear/restore the env var around a cache-busting dynamic
 * import so the Config constructor re-reads Deno.env. The key contract asserted here — unlike
 * PULL_ON_START_MAX_CONCURRENCY — is that a malformed value NEVER throws at construction (fail-closed
 * means deny trust, not brick boot); the invalid tokens are preserved so Shield Check can surface them.
 */

import { assertEquals } from '@std/assert';
import type { TrustedProxyConfig } from '$shared/security/index.ts';

type EnvRestore = string | undefined;

async function withTrustedProxyEnv<T>(
  value: string | undefined,
  fn: (cfg: { trustedProxy: TrustedProxyConfig }) => T
): Promise<T> {
  const saved: EnvRestore = Deno.env.get('TRUSTED_PROXY');
  if (value === undefined) Deno.env.delete('TRUSTED_PROXY');
  else Deno.env.set('TRUSTED_PROXY', value);
  try {
    const timestamp = `${Date.now()}_${Math.random()}`;
    const mod = await import(`../../lib/server/utils/config/config.ts?t=${timestamp}`);
    return fn(mod.config);
  } finally {
    if (saved === undefined) Deno.env.delete('TRUSTED_PROXY');
    else Deno.env.set('TRUSTED_PROXY', saved);
  }
}

Deno.test('TRUSTED_PROXY: unset resolves to mode "unset" (feature disabled, trust nobody)', async () => {
  await withTrustedProxyEnv(undefined, (cfg) => {
    assertEquals(cfg.trustedProxy.mode, 'unset');
    assertEquals(cfg.trustedProxy.ranges.length, 0);
    assertEquals(cfg.trustedProxy.overlyBroad, false);
  });
});

Deno.test('TRUSTED_PROXY="" resolves to mode "unset" (explicit opt-out)', async () => {
  await withTrustedProxyEnv('', (cfg) => {
    assertEquals(cfg.trustedProxy.mode, 'unset');
    assertEquals(cfg.trustedProxy.ranges.length, 0);
  });
});

Deno.test('TRUSTED_PROXY: a single IP becomes one /32 explicit range', async () => {
  await withTrustedProxyEnv('172.18.0.2', (cfg) => {
    assertEquals(cfg.trustedProxy.mode, 'explicit');
    assertEquals(cfg.trustedProxy.ranges.length, 1);
    assertEquals(cfg.trustedProxy.ranges[0].prefix, 32);
    assertEquals(cfg.trustedProxy.invalidEntries, []);
  });
});

Deno.test('TRUSTED_PROXY: a malformed token is preserved as invalid and does NOT throw at construction', async () => {
  await withTrustedProxyEnv('10.0.0.0/8, junk', (cfg) => {
    // The critical fail-closed-but-non-throwing contract: import above must not have thrown.
    assertEquals(cfg.trustedProxy.ranges.length, 1);
    assertEquals(cfg.trustedProxy.invalidEntries, ['junk']);
    assertEquals(cfg.trustedProxy.mode, 'explicit');
  });
});

Deno.test('TRUSTED_PROXY="*" resolves to wildcard + overlyBroad', async () => {
  await withTrustedProxyEnv('*', (cfg) => {
    assertEquals(cfg.trustedProxy.mode, 'wildcard');
    assertEquals(cfg.trustedProxy.wildcard, true);
    assertEquals(cfg.trustedProxy.overlyBroad, true);
  });
});
