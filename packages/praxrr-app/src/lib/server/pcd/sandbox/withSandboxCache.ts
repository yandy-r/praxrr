/**
 * Ephemeral "what-if" sandbox cache for the impact simulator.
 *
 * Builds a fresh, read-only replay of a PCD (schema+base+tweaks+user — i.e. the
 * CURRENT resolved config, including user overrides), applies a set of proposed
 * scoring changes to THAT cache only, and runs `fn` against it. The sandbox is:
 *
 * - built per call (no memoization, like `withBaseOnlyCache`);
 * - NEVER registered via `setCache()` — it is undiscoverable through
 *   `pcdManager.getCache()`;
 * - NEVER routed through `writeOperation()` — proposed ops are applied directly
 *   to the ephemeral SQLite handle, so `pcd_ops` and the live cache are untouched;
 * - always closed afterward, whether `fn` resolves or throws.
 *
 * Proposed changes are compiled to real SQL by {@link buildScoringOps} — the same
 * op builder the persist path uses — so the sandbox cannot drift from production
 * score semantics ('all'-expansion, value guards, per-arr_type columns). A change
 * whose ops fail (bad increment, guard miss, invalid SQL) is reported per-profile
 * in {@link SandboxReport.skippedChanges} rather than being fatal.
 */

import { PCDCache } from '../database/cache.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { ResolvedConfigDatabaseNotFoundError } from '../resolved/layers.ts';
import { buildScoringOps, type UpdateScoringInput } from '../entities/qualityProfiles/scoring/update.ts';
import { logger } from '$logger/logger.ts';
import type { components } from '$api/v1.d.ts';

type ProposedChange = components['schemas']['ProposedChange'];
type SkippedChange = components['schemas']['SkippedChange'];

const SOURCE = 'ImpactSandbox';

/** Current resolved state (including user overrides) — the what-if baseline. */
const SANDBOX_LAYERS = new Set<'schema' | 'base' | 'tweaks' | 'user'>(['schema', 'base', 'tweaks', 'user']);

/** SQLite bind-parameter type accepted by the sandbox's raw driver (int64 cache). */
type SqlBindParam = string | number | bigint | boolean | null | Uint8Array;

export interface SandboxReport {
  appliedChanges: ProposedChange[];
  skippedChanges: SkippedChange[];
}

export interface ProfileEdit {
  input: UpdateScoringInput;
  changes: ProposedChange[];
}

/**
 * Build an isolated sandbox cache with the proposed per-profile scoring edits
 * applied, run `fn` against it, and always close it afterward.
 *
 * `editsByProfile` maps a PCD quality-profile name to the seeded scoring input
 * plus the original proposed changes it represents; attribution to
 * applied/skipped is done at profile granularity (correction 18: the op builder's
 * internal 'all'-expansion side-ops have no user-facing change to map back to).
 */
export async function withSandboxCache<T>(
  databaseId: number,
  editsByProfile: Map<string, ProfileEdit>,
  fn: (cache: PCDCache, report: SandboxReport) => Promise<T>
): Promise<T> {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) {
    throw new ResolvedConfigDatabaseNotFoundError(databaseId);
  }

  const cache = new PCDCache(instance.local_path, databaseId);
  const startTime = performance.now();
  try {
    await cache.buildReadOnly({ layers: SANDBOX_LAYERS });
    const raw = cache.getRawDb();
    if (!raw) {
      throw new Error('sandbox raw db unavailable');
    }

    const appliedChanges: ProposedChange[] = [];
    const skippedChanges: SkippedChange[] = [];

    for (const [profileName, edit] of editsByProfile) {
      const skipProfile = (reason: string) => {
        for (const change of edit.changes) skippedChanges.push({ change, reason });
      };

      let built: Awaited<ReturnType<typeof buildScoringOps>>;
      try {
        built = await buildScoringOps({ databaseId, cache, layer: 'user', profileName, input: edit.input });
      } catch (err) {
        skipProfile(String(err));
        continue;
      }
      if ('error' in built) {
        skipProfile(built.error);
        continue;
      }

      let failReason: string | null = null;
      for (const op of built.ops) {
        for (const query of op.queries) {
          const params = query.parameters as SqlBindParam[];
          try {
            if (params.length === 0) {
              const validation = cache.validateSql([query.sql]);
              if (!validation.valid) {
                failReason = validation.error ?? 'invalid SQL';
                break;
              }
            }
            raw.prepare(query.sql).run(...params);
          } catch (err) {
            failReason = String(err);
            break;
          }
        }
        if (failReason !== null) break;
      }

      if (failReason !== null) {
        skipProfile(failReason);
      } else {
        for (const change of edit.changes) appliedChanges.push(change);
      }
    }

    return await fn(cache, { appliedChanges, skippedChanges });
  } finally {
    cache.close();
    await logger.debug('withSandboxCache: ephemeral sandbox cache closed', {
      source: SOURCE,
      meta: { databaseId, timingMs: Math.round(performance.now() - startTime) },
    });
  }
}
