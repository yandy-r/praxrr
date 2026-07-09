import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { getAllSections } from '$sync/registry.ts';
import { isCanaryResolutionError, resolveCanary, resolveSyncArrType } from '$sync/canary/selection.ts';
import type { CanarySettings, CanaryStartInput } from '$sync/canary/types.ts';

// Side-effect import registers the four sync section handlers so
// getConfiguredSections() (which drives the least-critical heuristic) sees a
// populated registry to patch.
import '$jobs/handlers/arrSync.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path,
 * run the full migration chain (so arr_instances / canary_settings exist), invoke
 * the test body, then tear the connection down. Mirrors syncHistoryQueries.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/canary-selection-${crypto.randomUUID()}`;
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

type Restore = () => void;

/** Insert an enabled arr instance; a random name dodges case-insensitive uniqueness. */
function seedInstance(type: 'radarr' | 'sonarr' | 'lidarr', name?: string): number {
  return arrInstancesQueries.create({
    name: name ?? `${type}-${crypto.randomUUID()}`,
    type,
    url: 'http://127.0.0.1:1',
    apiKey: 'test-api-key',
  });
}

/** Build a CanarySettings DTO with sane defaults; resolveCanary is pure over its arg. */
function settings(overrides: Partial<CanarySettings> = {}): CanarySettings {
  return {
    enabled: true,
    defaultMaxBatchSize: 1,
    autoSelect: true,
    defaultCanaryInstanceId: null,
    defaultPartialPolicy: 'gate',
    updatedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Patch every registered section handler's `hasConfig` so getConfiguredSections()
 * reports a controllable configured-section COUNT per instance. Handler at index i
 * is "configured" for an instance when its desired count exceeds i, so a count of N
 * marks the first N sections configured. `configure(id, n)` mutates the live map.
 */
function patchConfiguredSectionCounts(restores: Restore[]): (instanceId: number, count: number) => void {
  const countByInstance = new Map<number, number>();
  const handlers = getAllSections();

  handlers.forEach((handler, index) => {
    const original = handler.hasConfig;
    handler.hasConfig = (instanceId: number): boolean => (countByInstance.get(instanceId) ?? 0) > index;
    restores.push(() => {
      handler.hasConfig = original;
    });
  });

  return (instanceId: number, count: number) => {
    countByInstance.set(instanceId, count);
  };
}

function undo(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

// ---------------------------------------------------------------------------
// resolveSyncArrType — thin wrapper over isSyncPreviewArrType (pure, no DB)
// ---------------------------------------------------------------------------

Deno.test('resolveSyncArrType narrows radarr/sonarr/lidarr and rejects all/chaptarr/unknown', () => {
  assertEquals(resolveSyncArrType('radarr'), 'radarr');
  assertEquals(resolveSyncArrType('sonarr'), 'sonarr');
  assertEquals(resolveSyncArrType('lidarr'), 'lidarr');

  // Placeholder + unsupported arr types are not canary-capable.
  assertEquals(resolveSyncArrType('all'), null);
  assertEquals(resolveSyncArrType('chaptarr'), null);
  assertEquals(resolveSyncArrType('whisparr'), null);
  assertEquals(resolveSyncArrType(''), null);
});

// ---------------------------------------------------------------------------
// Precedence chain: explicit > default > auto-select > fail-closed
// ---------------------------------------------------------------------------

migratedTest('resolveCanary honors the explicit > default > auto-select > fail-closed precedence', () => {
  // Two radarr instances; `a` is created first (lowest id).
  const a = seedInstance('radarr', 'radarr-a');
  const b = seedInstance('radarr', 'radarr-b');
  const input: CanaryStartInput = { arrType: 'radarr' };

  // (1) Explicit id wins over an unrelated default + auto-select.
  const explicit = resolveCanary({ ...input, canaryInstanceId: b }, settings({ defaultCanaryInstanceId: a }));
  assert(!isCanaryResolutionError(explicit));
  assertEquals(explicit.canary.instanceId, b);
  assertEquals(
    explicit.remaining.map((target) => target.instanceId),
    [a]
  );

  // (2) With no explicit id, the configured default is used.
  const byDefault = resolveCanary(input, settings({ defaultCanaryInstanceId: a }));
  assert(!isCanaryResolutionError(byDefault));
  assertEquals(byDefault.canary.instanceId, a);

  // (3) No explicit, no default -> auto-select least-critical (both 0 configured -> lowest id).
  const auto = resolveCanary(input, settings({ defaultCanaryInstanceId: null, autoSelect: true }));
  assert(!isCanaryResolutionError(auto));
  assertEquals(auto.canary.instanceId, a);

  // (4) Fail-closed: no explicit, no default, auto-select off.
  const failClosed = resolveCanary(input, settings({ defaultCanaryInstanceId: null, autoSelect: false }));
  assert(isCanaryResolutionError(failClosed));
});

migratedTest('resolveCanary fails closed when the arr_type cohort is empty', () => {
  seedInstance('radarr');
  // No sonarr instances exist -> a sonarr rollout is unresolvable even with auto-select.
  const result = resolveCanary({ arrType: 'sonarr' }, settings());
  assert(isCanaryResolutionError(result));
});

// ---------------------------------------------------------------------------
// Per-arr_type cohort isolation (no sibling fallback)
// ---------------------------------------------------------------------------

migratedTest(
  'resolveCanary scopes remaining to the canary arr_type — a radarr canary never pulls sonarr/lidarr',
  () => {
    const radarrCanary = seedInstance('radarr', 'radarr-canary');
    const radarrPeer = seedInstance('radarr', 'radarr-peer');
    const sonarr = seedInstance('sonarr', 'sonarr-other');
    const lidarr = seedInstance('lidarr', 'lidarr-other');

    const result = resolveCanary({ arrType: 'radarr', canaryInstanceId: radarrCanary }, settings());
    assert(!isCanaryResolutionError(result));
    assertEquals(result.arrType, 'radarr');
    assertEquals(result.canary.instanceId, radarrCanary);

    // EXACT remaining targets: only the radarr peer, never the sonarr/lidarr siblings.
    assertEquals(
      result.remaining.map((target) => target.instanceId),
      [radarrPeer]
    );
    const remainingIds = new Set(result.remaining.map((target) => target.instanceId));
    assert(!remainingIds.has(sonarr), 'sonarr must never enter a radarr cohort');
    assert(!remainingIds.has(lidarr), 'lidarr must never enter a radarr cohort');
  }
);

migratedTest('resolveCanary rejects an explicit canary of the wrong arr_type (no silent sibling fallback)', () => {
  seedInstance('radarr', 'radarr-only');
  const sonarr = seedInstance('sonarr', 'sonarr-explicit');

  // Explicit sonarr id against a radarr rollout is a fail-fast error, not a fall-through.
  const result = resolveCanary({ arrType: 'radarr', canaryInstanceId: sonarr }, settings());
  assert(isCanaryResolutionError(result));
});

// ---------------------------------------------------------------------------
// Least-critical heuristic: fewest configured sections, tie-break lowest id
// ---------------------------------------------------------------------------

migratedTest('auto-select picks the least-critical instance by fewest CONFIGURED sections', () => {
  const restores: Restore[] = [];
  const configure = patchConfiguredSectionCounts(restores);

  const a = seedInstance('radarr', 'radarr-a');
  const b = seedInstance('radarr', 'radarr-b');
  const c = seedInstance('radarr', 'radarr-c');

  // b is least-critical: fewest configured sections (0), even though its id is not lowest.
  configure(a, 2);
  configure(b, 0);
  configure(c, 1);

  try {
    const result = resolveCanary({ arrType: 'radarr' }, settings({ autoSelect: true }));
    assert(!isCanaryResolutionError(result));
    assertEquals(result.canary.instanceId, b);
    // Remaining is the rest of the radarr cohort (exact ids), the canary excluded.
    assertEquals(new Set(result.remaining.map((target) => target.instanceId)), new Set([a, c]));
  } finally {
    undo(restores);
  }
});

migratedTest('auto-select tie-break falls to the lowest instance id when configured counts are equal', () => {
  const restores: Restore[] = [];
  const configure = patchConfiguredSectionCounts(restores);

  // Names are reverse of creation order so getEnabled()'s name-ordering != id-ordering;
  // the tie-break must still resolve on the lowest id, independent of cohort order.
  const a = seedInstance('radarr', 'zzz-first'); // lowest id
  const b = seedInstance('radarr', 'yyy-second');
  const c = seedInstance('radarr', 'xxx-third');

  const equalCount: number = 2;
  configure(a, equalCount);
  configure(b, equalCount);
  configure(c, equalCount);

  try {
    const result = resolveCanary({ arrType: 'radarr' }, settings({ autoSelect: true }));
    assert(!isCanaryResolutionError(result));
    // All three tie at 2 configured sections -> lowest id (a) wins the tie-break.
    assertEquals(result.canary.instanceId, a);
    assertEquals(new Set(result.remaining.map((target) => target.instanceId)), new Set([b, c]));
  } finally {
    undo(restores);
  }
});

migratedTest('least-critical selection reflects live configured-section counts, not enabled-only state', () => {
  const restores: Restore[] = [];
  const configure = patchConfiguredSectionCounts(restores);

  const a = seedInstance('radarr', 'radarr-a');
  const b = seedInstance('radarr', 'radarr-b');

  // First: a has more configured sections -> b is chosen.
  configure(a, 3);
  configure(b, 1);

  try {
    const first = resolveCanary({ arrType: 'radarr' }, settings({ autoSelect: true }));
    assert(!isCanaryResolutionError(first));
    assertEquals(first.canary.instanceId, b);

    // Flip the configured counts; the selection follows the count, proving it counts
    // CONFIGURED sections rather than any fixed per-instance property.
    configure(a, 0);
    configure(b, 4);
    const second = resolveCanary({ arrType: 'radarr' }, settings({ autoSelect: true }));
    assert(!isCanaryResolutionError(second));
    assertEquals(second.canary.instanceId, a);
  } finally {
    undo(restores);
  }
});
