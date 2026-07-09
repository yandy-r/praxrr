/**
 * Config Health input gatherer (issue #22).
 *
 * The ONLY DB/cache-touching health code on the read path. It materializes every fact the pure
 * engine needs — drift status (no recompute), per-profile completeness/coherence/compatibility
 * signals, and the detected-version tier — into a {@link HealthInputs}, then hands off to
 * `computeHealthReport`. Mirrors the goals `planRequest.ts` seam so the engine stays unit-testable.
 *
 * NEVER throws per instance: an unbuilt cache, a missing scoring row, or an unexpected reader error
 * degrade the affected profile (or the whole instance) to `unknown`, so one bad instance can never
 * abort a fleet sweep (the same never-throw contract as `$sync/drift/check.ts`).
 */

import { logger } from '$logger/logger.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { getCache, type PCDCache } from '$pcd/index.ts';
import { computeCompatibleProfileNames } from '$pcd/entities/qualityProfiles/compatibility.ts';
import { scoring, QualityProfileScoringNotFoundError } from '$pcd/entities/qualityProfiles/scoring/read.ts';
import { qualities } from '$pcd/entities/qualityProfiles/qualities/read.ts';
import { resolveArrCompatibility } from '$shared/arr/compatibility.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { DriftFacts, HealthArrType, HealthCfScore, HealthInputs, HealthThresholds, ProfileFacts } from '$shared/health/index.ts';

const SOURCE = 'ConfigHealthGather';

/** Read the latest drift status without recomputing; synthesize `never-checked` when absent. */
function gatherDrift(instanceId: number): DriftFacts {
  const detail = driftStatusQueries.getById(instanceId);
  if (!detail) {
    return { status: 'never-checked', reason: null, drifted: 0, missing: 0, unmanaged: 0, checkedAt: null, contentCheckedAt: null };
  }
  return {
    status: detail.status,
    reason: detail.reason,
    drifted: detail.counts.drifted,
    missing: detail.counts.missing,
    unmanaged: detail.counts.unmanaged,
    checkedAt: detail.checkedAt,
    contentCheckedAt: detail.contentCheckedAt
  };
}

/** Map the detected-version support tier to a tri-state the engine can weight. */
function gatherVersionSupported(arrType: HealthArrType, detectedVersion: string | null): boolean | null {
  const tier = resolveArrCompatibility(arrType, detectedVersion).tier;
  if (tier === 'unknown') return null;
  return tier !== 'unsupported';
}

/** A profile we could not read (unbuilt cache / missing row): scored as `unknown`, never crashes. */
function degradedProfile(name: string, arrType: HealthArrType, compatible: boolean): ProfileFacts {
  return {
    name,
    arrType,
    compatible,
    enabledQualityCount: 0,
    hasCutoff: false,
    assignedCfCount: 0,
    totalCfCount: 0,
    recommendedCfCount: 0,
    thresholds: null,
    cfScores: []
  };
}

/** Materialize one profile's facts from its database cache. Reader failures degrade, never throw. */
async function buildProfileFacts(
  cache: PCDCache,
  databaseId: number,
  name: string,
  arrType: HealthArrType,
  compatible: boolean
): Promise<ProfileFacts> {
  let thresholds: HealthThresholds | null = null;
  let cfScores: HealthCfScore[] = [];
  let assignedCfCount = 0;
  let totalCfCount = 0;

  try {
    const score = await scoring(cache, databaseId, name);
    totalCfCount = score.customFormats.length;
    cfScores = score.customFormats.map((cf) => ({ name: cf.name, score: cf.scores[arrType] ?? null }));
    assignedCfCount = cfScores.filter((c) => c.score !== null).length;
    thresholds = {
      minimumScore: score.minimum_custom_format_score,
      // `scoring()` returns 0 (never null) when upgrades are off; 0 => "no upgrade target".
      upgradeUntilScore: score.upgrade_until_score === 0 ? null : score.upgrade_until_score,
      upgradeScoreIncrement: score.upgrade_score_increment === 0 ? null : score.upgrade_score_increment
    };
  } catch (error) {
    if (!(error instanceof QualityProfileScoringNotFoundError)) {
      await logger.warn('Config health: scoring read failed; degrading profile', {
        source: SOURCE,
        meta: { databaseId, profile: name, error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  let enabledQualityCount = 0;
  let hasCutoff = false;
  try {
    const q = await qualities(cache, databaseId, name);
    enabledQualityCount = q.orderedItems.filter((item) => item.enabled).length;
    hasCutoff = q.orderedItems.some((item) => item.upgradeUntil);
  } catch (error) {
    await logger.warn('Config health: qualities read failed; degrading profile qualities', {
      source: SOURCE,
      meta: { databaseId, profile: name, error: error instanceof Error ? error.message : String(error) }
    });
  }

  return {
    name,
    arrType,
    compatible,
    enabledQualityCount,
    hasCutoff,
    assignedCfCount,
    totalCfCount,
    recommendedCfCount: totalCfCount, // Phase 1: assigned-vs-available (no curated TRaSH set yet)
    thresholds,
    cfScores
  };
}

/** Materialize every profile the instance syncs, grouped by database so cache reads are shared. */
async function gatherProfiles(instance: ArrInstance, arrType: HealthArrType): Promise<ProfileFacts[]> {
  const { selections } = arrSyncQueries.getQualityProfilesSync(instance.id);

  const byDatabase = new Map<number, string[]>();
  for (const selection of selections) {
    const names = byDatabase.get(selection.databaseId) ?? [];
    names.push(selection.profileName);
    byDatabase.set(selection.databaseId, names);
  }

  const profiles: ProfileFacts[] = [];
  for (const [databaseId, profileNames] of byDatabase) {
    const cache = getCache(databaseId);
    if (!cache || !cache.isBuilt()) {
      // Cache not ready: degrade every profile in this database to unknown rather than throw.
      for (const name of profileNames) profiles.push(degradedProfile(name, arrType, false));
      continue;
    }
    // Compute the compatibility set once per (cache, arrType) — the guardrail-correct signal.
    let compatibleNames: Set<string>;
    try {
      compatibleNames = await computeCompatibleProfileNames(cache, arrType, profileNames);
    } catch {
      compatibleNames = new Set();
    }
    for (const name of profileNames) {
      profiles.push(await buildProfileFacts(cache, databaseId, name, arrType, compatibleNames.has(name)));
    }
  }
  return profiles;
}

/**
 * Build the fully-materialized {@link HealthInputs} for one enabled, sync-capable Arr instance.
 * `arrType` is narrowed here via {@link isSyncPreviewArrType} before any per-arr semantics apply.
 */
export async function buildHealthInputs(instance: ArrInstance): Promise<HealthInputs> {
  const arrType = instance.type as HealthArrType; // caller guarantees isSyncPreviewArrType(instance.type)
  const nowIso = new Date().toISOString();

  const drift = gatherDrift(instance.id);
  const versionSupported = gatherVersionSupported(arrType, instance.detected_version ?? null);
  const criteria = configHealthSettingsQueries.get().criteria;

  let profiles: ProfileFacts[] = [];
  try {
    profiles = await gatherProfiles(instance, arrType);
  } catch (error) {
    // Catastrophic gather failure still yields a scoreable instance (drift + version only).
    await logger.error('Config health: profile gather failed; scoring instance without profiles', {
      source: SOURCE,
      meta: { instanceId: instance.id, error: error instanceof Error ? error.message : String(error) }
    });
  }

  return {
    instanceId: instance.id,
    instanceName: instance.name,
    arrType,
    detectedVersion: instance.detected_version ?? null,
    versionSupported,
    drift,
    profiles,
    criteria,
    nowIso
  };
}

/** Re-exported for callers that need the eligibility predicate alongside the gatherer. */
export { isSyncPreviewArrType };
