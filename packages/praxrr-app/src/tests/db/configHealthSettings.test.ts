import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { configHealthSettingsQueries, normalizeCriteria } from '$db/queries/configHealthSettings.ts';
import { CRITERION_IDS, DEFAULT_CRITERIA, type CriterionConfig } from '$shared/health/index.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain (so config_health_settings + its seeded singleton exist), invoke the body, then
 * tear the connection down. Mirrors syncHistoryRetention.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-settings-${crypto.randomUUID()}`;
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

const defaults: CriterionConfig[] = DEFAULT_CRITERIA.map((c) => ({ id: c.id, enabled: c.enabled, weight: c.weight }));

// ---------------------------------------------------------------------------
// normalizeCriteria — pure, no DB needed
// ---------------------------------------------------------------------------

Deno.test('normalizeCriteria fills every missing criterion from the defaults', () => {
  const result = normalizeCriteria(JSON.stringify([]));
  assertEquals(
    result.map((c) => c.id),
    [...CRITERION_IDS]
  );
  assertEquals(result, defaults);
});

Deno.test('normalizeCriteria drops unknown ids and preserves valid overrides in canonical order', () => {
  const raw = JSON.stringify([
    { id: 'completeness', enabled: false, weight: 99 },
    { id: 'bogus', enabled: true, weight: 5 },
    { id: 'drift', enabled: true, weight: 12 },
  ]);
  const result = normalizeCriteria(raw);

  // Full canonical set, in stable order, with no 'bogus' leak.
  assertEquals(
    result.map((c) => c.id),
    [...CRITERION_IDS]
  );
  assert(!result.some((c) => (c.id as string) === 'bogus'));

  const byId = new Map(result.map((c) => [c.id, c]));
  assertEquals(byId.get('completeness'), { id: 'completeness', enabled: false, weight: 99 });
  assertEquals(byId.get('drift'), { id: 'drift', enabled: true, weight: 12 });
  // Untouched criteria keep their defaults.
  assertEquals(byId.get('coherence'), { id: 'coherence', enabled: true, weight: 20 });
});

Deno.test('normalizeCriteria falls back to defaults on malformed JSON', () => {
  assertEquals(normalizeCriteria('not json'), defaults);
});

Deno.test('normalizeCriteria coerces a negative weight to 0 and a non-boolean enabled to false', () => {
  const raw = JSON.stringify([{ id: 'drift', enabled: 'yes', weight: -7 }]);
  const drift = normalizeCriteria(raw).find((c) => c.id === 'drift');
  assertEquals(drift, { id: 'drift', enabled: false, weight: 0 });
});

// ---------------------------------------------------------------------------
// get() — self-heal + normalized defaults
// ---------------------------------------------------------------------------

migratedTest('get returns the seeded singleton with normalized default criteria', () => {
  const settings = configHealthSettingsQueries.get();
  assertEquals(settings.id, 1);
  assertEquals(settings.enabled, 1);
  assertEquals(settings.interval_minutes, 360);
  assertEquals(settings.retention_days, 90);
  assertEquals(settings.retention_max_entries, 5000);
  assertEquals(settings.criteria, defaults);
});

migratedTest('get self-heals when the singleton row is missing', () => {
  db.execute('DELETE FROM config_health_settings WHERE id = 1');

  const settings = configHealthSettingsQueries.get();
  assertEquals(settings.id, 1);
  assertEquals(settings.criteria, defaults);

  // The row was re-inserted, so a second read still succeeds.
  assertEquals(configHealthSettingsQueries.get().id, 1);
});

// ---------------------------------------------------------------------------
// update() — persistence
// ---------------------------------------------------------------------------

migratedTest('update persists cadence, retention, and normalized criteria', () => {
  const criteria: CriterionConfig[] = [
    { id: 'completeness', enabled: true, weight: 50 },
    { id: 'drift', enabled: false, weight: 0 },
  ];

  const changed = configHealthSettingsQueries.update({
    intervalMinutes: 120,
    retentionDays: 45,
    criteria,
  });
  assertEquals(changed, true);

  const settings = configHealthSettingsQueries.get();
  assertEquals(settings.interval_minutes, 120);
  assertEquals(settings.retention_days, 45);

  // Criteria are normalized on write: overrides applied, missing ids backfilled, canonical order.
  assertEquals(
    settings.criteria.map((c) => c.id),
    [...CRITERION_IDS]
  );
  const byId = new Map(settings.criteria.map((c) => [c.id, c]));
  assertEquals(byId.get('completeness'), { id: 'completeness', enabled: true, weight: 50 });
  assertEquals(byId.get('drift'), { id: 'drift', enabled: false, weight: 0 });
  assertEquals(byId.get('compatibility'), { id: 'compatibility', enabled: true, weight: 20 });
});

migratedTest('update with no fields is a no-op and returns false', () => {
  assertEquals(configHealthSettingsQueries.update({}), false);
});
