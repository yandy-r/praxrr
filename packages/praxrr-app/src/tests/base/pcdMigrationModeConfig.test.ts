import { assertEquals, assertThrows } from '@std/assert';

type EnvRestore = Record<string, string | undefined>;

const CONFIG_ENV_KEYS = ['PRAXRR_PCD_MIGRATION_MODE', 'PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK'] as const;

function saveAndClearMigrationEnv(): EnvRestore {
  const saved: EnvRestore = {};
  for (const key of CONFIG_ENV_KEYS) {
    saved[key] = Deno.env.get(key);
    Deno.env.delete(key);
  }
  return saved;
}

function restoreMigrationEnv(saved: EnvRestore): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

async function withMigrationConfig<T>(
  vars: Record<string, string>,
  fn: (cfg: {
    pcdMigrationIngestionMode: 'sql-only' | 'hybrid';
    pcdMigrationAllowLegacyFallback: boolean;
  }) => Promise<T> | T
): Promise<T> {
  const saved = saveAndClearMigrationEnv();
  Object.entries(vars).forEach(([key, value]) => {
    Deno.env.set(key, value);
  });

  try {
    const ts = `${Date.now()}_${Math.random()}`;
    const mod = await import(`../../lib/server/utils/config/config.ts?pcdMigrationConfig=${ts}`);
    return await fn(mod.config);
  } finally {
    restoreMigrationEnv(saved);
  }
}

async function withMigrationConfigThrows(vars: Record<string, string>, expectedMessage: string): Promise<void> {
  const saved = saveAndClearMigrationEnv();
  Object.entries(vars).forEach(([key, value]) => {
    Deno.env.set(key, value);
  });

  try {
    const ts = `${Date.now()}_${Math.random()}`;
    let threw = false;
    try {
      await import(`../../lib/server/utils/config/config.ts?pcdMigrationConfig=${ts}`);
    } catch (err: unknown) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      assertEquals(
        message.includes(expectedMessage),
        true,
        `Expected error message to include "${expectedMessage}", got "${message}"`
      );
    }

    assertEquals(threw, true, `Expected config import to fail for vars ${JSON.stringify(vars)}`);
  } finally {
    restoreMigrationEnv(saved);
  }
}

Deno.test('Config: PRAXRR_PCD_MIGRATION_MODE defaults to hybrid', async () => {
  await withMigrationConfig({}, (cfg) => {
    assertEquals(cfg.pcdMigrationIngestionMode, 'hybrid');
  });
});

Deno.test('Config: PRAXRR_PCD_MIGRATION_MODE accepts SQL-only values', async () => {
  await withMigrationConfig({ PRAXRR_PCD_MIGRATION_MODE: 'sql-only' }, (cfg) => {
    assertEquals(cfg.pcdMigrationIngestionMode, 'sql-only');
  });
});

Deno.test('Config: PRAXRR_PCD_MIGRATION_MODE treats empty string as default hybrid', async () => {
  await withMigrationConfig({ PRAXRR_PCD_MIGRATION_MODE: '   ' }, (cfg) => {
    assertEquals(cfg.pcdMigrationIngestionMode, 'hybrid');
  });
});

Deno.test('Config: PRAXRR_PCD_MIGRATION_MODE rejects invalid values', async () => {
  await withMigrationConfigThrows(
    { PRAXRR_PCD_MIGRATION_MODE: 'invalid-value' },
    'Invalid value for PRAXRR_PCD_MIGRATION_MODE'
  );
});

Deno.test('Config: PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK parses truthy variants', async () => {
  await withMigrationConfig({ PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK: ' true ' }, (cfg) => {
    assertEquals(cfg.pcdMigrationAllowLegacyFallback, true);
  });
});

Deno.test('Config: PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK defaults false', async () => {
  await withMigrationConfig({}, (cfg) => {
    assertEquals(cfg.pcdMigrationAllowLegacyFallback, false);
  });
});
