import { assertEquals } from '@std/assert';

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
  fn: (cfg: Record<string, unknown>) => Promise<T> | T
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

Deno.test('Config: migration mode vars are not exported on config', async () => {
  await withMigrationConfig({}, (cfg) => {
    assertEquals('pcdMigrationIngestionMode' in cfg, false);
    assertEquals('pcdMigrationAllowLegacyFallback' in cfg, false);
  });
});

Deno.test('Config: migration env values do not affect config parse', async () => {
  await withMigrationConfig(
    {
      PRAXRR_PCD_MIGRATION_MODE: 'sql-only',
      PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK: 'true',
      AUTH: 'off',
    },
    (cfg) => {
      assertEquals(cfg.authMode, 'off');
      assertEquals('pcdMigrationIngestionMode' in cfg, false);
    }
  );
});

Deno.test('Config: migration env values do not prevent invalid AUTH fallback behavior', async () => {
  await withMigrationConfig({ PRAXRR_PCD_MIGRATION_MODE: 'sql-only', AUTH: 'invalid-mode' }, (cfg) => {
    assertEquals(cfg.authMode, 'on');
  });
});
