/**
 * Unit tests for PULL_ON_START config parsing and related tuning env vars.
 *
 * Tests exercise the Config class constructor and its static helper methods
 * by manipulating env vars around Config instantiation. The approach mirrors
 * envInstances.test.ts: save/restore env vars around each test case.
 */

import { assertEquals, assertThrows } from '@std/assert';

// ---------------------------------------------------------------------------
// Env var save/restore helpers
// ---------------------------------------------------------------------------

type EnvRestore = Record<string, string | undefined>;

const PULL_ENV_KEYS = ['PULL_ON_START', 'PULL_ON_START_MAX_CONCURRENCY', 'PULL_ON_START_TIMEOUT_MS'] as const;

function saveAndClearPullEnv(): EnvRestore {
  const saved: EnvRestore = {};
  for (const key of PULL_ENV_KEYS) {
    saved[key] = Deno.env.get(key);
    Deno.env.delete(key);
  }
  return saved;
}

function restorePullEnv(saved: EnvRestore): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

/**
 * Helper that sets env vars, dynamically imports a fresh Config instance,
 * runs assertions, then restores env. We re-import the module to force
 * a new Config constructor call with the test-specific env state.
 *
 * Note: the config singleton exported from config.ts is created at module
 * evaluation time. Since Deno caches modules, we cannot re-import to get a
 * fresh constructor call without cache busting. Instead, we directly test
 * the static parsing behavior embedded in Config by instantiating a new
 * Config via the exported class. The exported singleton `config` is
 * constructed once at import time, so we test the parsing helpers directly.
 */

// We import the module once; the singleton is already constructed.
// For PULL_ON_START we can test by importing the Config class if exported,
// but config.ts only exports the singleton instance. Since the Config class
// is not exported, we test the observable behavior: the three fields on
// the singleton. For env-var tests that need fresh parsing, we dynamically
// import with a cache-busting query param.

async function withPullEnv<T>(
  vars: Record<string, string>,
  fn: (cfg: {
    pullOnStart: boolean;
    pullOnStartMaxConcurrency: number | null;
    pullOnStartTimeoutMs: number | null;
  }) => T
): Promise<T> {
  const saved = saveAndClearPullEnv();
  for (const [key, value] of Object.entries(vars)) {
    Deno.env.set(key, value);
  }
  try {
    // Dynamic import with unique query string busts Deno's module cache
    // so the Config constructor re-reads Deno.env.
    const timestamp = `${Date.now()}_${Math.random()}`;
    const mod = await import(`../../lib/server/utils/config/config.ts?t=${timestamp}`);
    return fn(mod.config);
  } finally {
    restorePullEnv(saved);
  }
}

async function withPullEnvThrows(vars: Record<string, string>, expectedMessageSubstring: string): Promise<void> {
  const saved = saveAndClearPullEnv();
  for (const [key, value] of Object.entries(vars)) {
    Deno.env.set(key, value);
  }
  try {
    const timestamp = `${Date.now()}_${Math.random()}`;
    let threw = false;
    try {
      await import(`../../lib/server/utils/config/config.ts?t=${timestamp}`);
    } catch (err: unknown) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      assertEquals(
        message.includes(expectedMessageSubstring),
        true,
        `Expected error to contain "${expectedMessageSubstring}", got: "${message}"`
      );
    }
    assertEquals(threw, true, `Expected import to throw for env vars: ${JSON.stringify(vars)}`);
  } finally {
    restorePullEnv(saved);
  }
}

// =============================================================================
// PULL_ON_START boolean parsing
// =============================================================================

Deno.test('PULL_ON_START: defaults to false when env var is missing', async () => {
  await withPullEnv({}, (cfg) => {
    assertEquals(cfg.pullOnStart, false);
  });
});

Deno.test('PULL_ON_START: parses "true" as true', async () => {
  await withPullEnv({ PULL_ON_START: 'true' }, (cfg) => {
    assertEquals(cfg.pullOnStart, true);
  });
});

Deno.test('PULL_ON_START: parses "1" as true', async () => {
  await withPullEnv({ PULL_ON_START: '1' }, (cfg) => {
    assertEquals(cfg.pullOnStart, true);
  });
});

Deno.test('PULL_ON_START: parses "yes" as true', async () => {
  await withPullEnv({ PULL_ON_START: 'yes' }, (cfg) => {
    assertEquals(cfg.pullOnStart, true);
  });
});

Deno.test('PULL_ON_START: parses "on" as true', async () => {
  await withPullEnv({ PULL_ON_START: 'on' }, (cfg) => {
    assertEquals(cfg.pullOnStart, true);
  });
});

Deno.test('PULL_ON_START: parses "false" as false', async () => {
  await withPullEnv({ PULL_ON_START: 'false' }, (cfg) => {
    assertEquals(cfg.pullOnStart, false);
  });
});

Deno.test('PULL_ON_START: parses "0" as false', async () => {
  await withPullEnv({ PULL_ON_START: '0' }, (cfg) => {
    assertEquals(cfg.pullOnStart, false);
  });
});

Deno.test('PULL_ON_START: parses empty string as false', async () => {
  await withPullEnv({ PULL_ON_START: '' }, (cfg) => {
    assertEquals(cfg.pullOnStart, false);
  });
});

Deno.test('PULL_ON_START: parses arbitrary invalid string as false', async () => {
  await withPullEnv({ PULL_ON_START: 'maybe' }, (cfg) => {
    assertEquals(cfg.pullOnStart, false);
  });
});

Deno.test('PULL_ON_START: case-insensitive "TRUE" parses as true', async () => {
  await withPullEnv({ PULL_ON_START: 'TRUE' }, (cfg) => {
    assertEquals(cfg.pullOnStart, true);
  });
});

Deno.test('PULL_ON_START: whitespace-padded " true " parses as true', async () => {
  await withPullEnv({ PULL_ON_START: ' true ' }, (cfg) => {
    assertEquals(cfg.pullOnStart, true);
  });
});

// =============================================================================
// PULL_ON_START_MAX_CONCURRENCY parsing
// =============================================================================

Deno.test('PULL_ON_START_MAX_CONCURRENCY: defaults to null when missing', async () => {
  await withPullEnv({}, (cfg) => {
    assertEquals(cfg.pullOnStartMaxConcurrency, null);
  });
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: parses valid positive integer', async () => {
  await withPullEnv({ PULL_ON_START_MAX_CONCURRENCY: '4' }, (cfg) => {
    assertEquals(cfg.pullOnStartMaxConcurrency, 4);
  });
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: parses "1" as 1', async () => {
  await withPullEnv({ PULL_ON_START_MAX_CONCURRENCY: '1' }, (cfg) => {
    assertEquals(cfg.pullOnStartMaxConcurrency, 1);
  });
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: empty string returns null', async () => {
  await withPullEnv({ PULL_ON_START_MAX_CONCURRENCY: '' }, (cfg) => {
    assertEquals(cfg.pullOnStartMaxConcurrency, null);
  });
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: whitespace-only returns null', async () => {
  await withPullEnv({ PULL_ON_START_MAX_CONCURRENCY: '   ' }, (cfg) => {
    assertEquals(cfg.pullOnStartMaxConcurrency, null);
  });
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: throws on non-numeric value', async () => {
  await withPullEnvThrows({ PULL_ON_START_MAX_CONCURRENCY: 'abc' }, 'Invalid value for PULL_ON_START_MAX_CONCURRENCY');
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: throws on negative value', async () => {
  await withPullEnvThrows({ PULL_ON_START_MAX_CONCURRENCY: '-1' }, 'Invalid value for PULL_ON_START_MAX_CONCURRENCY');
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: throws on zero', async () => {
  await withPullEnvThrows({ PULL_ON_START_MAX_CONCURRENCY: '0' }, 'Invalid value for PULL_ON_START_MAX_CONCURRENCY');
});

Deno.test('PULL_ON_START_MAX_CONCURRENCY: throws on decimal value', async () => {
  await withPullEnvThrows({ PULL_ON_START_MAX_CONCURRENCY: '3.5' }, 'Invalid value for PULL_ON_START_MAX_CONCURRENCY');
});

// =============================================================================
// PULL_ON_START_TIMEOUT_MS parsing
// =============================================================================

Deno.test('PULL_ON_START_TIMEOUT_MS: defaults to null when missing', async () => {
  await withPullEnv({}, (cfg) => {
    assertEquals(cfg.pullOnStartTimeoutMs, null);
  });
});

Deno.test('PULL_ON_START_TIMEOUT_MS: parses valid positive integer', async () => {
  await withPullEnv({ PULL_ON_START_TIMEOUT_MS: '30000' }, (cfg) => {
    assertEquals(cfg.pullOnStartTimeoutMs, 30000);
  });
});

Deno.test('PULL_ON_START_TIMEOUT_MS: empty string returns null', async () => {
  await withPullEnv({ PULL_ON_START_TIMEOUT_MS: '' }, (cfg) => {
    assertEquals(cfg.pullOnStartTimeoutMs, null);
  });
});

Deno.test('PULL_ON_START_TIMEOUT_MS: throws on non-numeric value', async () => {
  await withPullEnvThrows({ PULL_ON_START_TIMEOUT_MS: 'fast' }, 'Invalid value for PULL_ON_START_TIMEOUT_MS');
});

Deno.test('PULL_ON_START_TIMEOUT_MS: throws on zero', async () => {
  await withPullEnvThrows({ PULL_ON_START_TIMEOUT_MS: '0' }, 'Invalid value for PULL_ON_START_TIMEOUT_MS');
});

// =============================================================================
// Disabled-mode behavior (pullOnStart=false has no side effects)
// =============================================================================

Deno.test('PULL_ON_START=false: config fields reflect disabled state with no tuning values', async () => {
  await withPullEnv(
    {
      PULL_ON_START: 'false',
      PULL_ON_START_MAX_CONCURRENCY: '5',
      PULL_ON_START_TIMEOUT_MS: '60000',
    },
    (cfg) => {
      assertEquals(cfg.pullOnStart, false);
      // Tuning values are still parsed even when disabled; the caller decides behavior
      assertEquals(cfg.pullOnStartMaxConcurrency, 5);
      assertEquals(cfg.pullOnStartTimeoutMs, 60000);
    }
  );
});

// =============================================================================
// Combined parsing (all three vars together)
// =============================================================================

Deno.test('All PULL_ON_START vars parse correctly together', async () => {
  await withPullEnv(
    {
      PULL_ON_START: 'true',
      PULL_ON_START_MAX_CONCURRENCY: '3',
      PULL_ON_START_TIMEOUT_MS: '15000',
    },
    (cfg) => {
      assertEquals(cfg.pullOnStart, true);
      assertEquals(cfg.pullOnStartMaxConcurrency, 3);
      assertEquals(cfg.pullOnStartTimeoutMs, 15000);
    }
  );
});
