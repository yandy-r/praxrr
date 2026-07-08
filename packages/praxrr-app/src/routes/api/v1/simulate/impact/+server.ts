import { json, error, type RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { parseWithCacheBatch, isParserHealthy, matchPatternsBatch } from '$lib/server/utils/arr/parser/index.ts';
import { getAllConditionsForEvaluation, extractAllPatterns } from '$pcd/entities/customFormats/index.ts';
import { scoring, QualityProfileScoringNotFoundError } from '$pcd/entities/qualityProfiles/index.ts';
import type { UpdateScoringInput } from '$pcd/entities/qualityProfiles/scoring/update.ts';
import { getImpact } from '$pcd/graph/resolver.ts';
import { readEntityOrNull, computeUserOverrides } from '$pcd/resolved/layerDiff.ts';
import { withSandboxCache, type ProfileEdit, type SandboxReport } from '$pcd/sandbox/withSandboxCache.ts';
import { simulateReleaseScores, type SimulateScoreContext } from '$pcd/simulate/simulateReleaseScores.ts';
import { isArrType, isReleaseType, parseProfileSelector } from '$pcd/simulate/selectors.ts';
import { resolveThresholdState } from '$shared/pcd/threshold.ts';
import { logger } from '$logger/logger.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { FieldChange } from '$sync/preview/types.ts';
import type { components } from '$api/v1.d.ts';

type SimulateImpactRequest = components['schemas']['SimulateImpactRequest'];
type SimulateImpactResponse = components['schemas']['SimulateImpactResponse'];
type ProposedChange = components['schemas']['ProposedChange'];
type SkippedChange = components['schemas']['SkippedChange'];
type ReleaseImpact = components['schemas']['ReleaseImpact'];
type ProfileImpact = components['schemas']['ProfileImpact'];
type CfContributionDelta = components['schemas']['CfContributionDelta'];
type EntityConfigDiff = components['schemas']['EntityConfigDiff'];
type CascadeWarning = components['schemas']['CascadeWarning'];

const SOURCE = 'ImpactSimulator';
const MAX_RELEASES = 50;
const MAX_PROFILES = 10;
const MAX_CHANGES = 100;

const PROFILE_SETTING_FIELDS = new Set([
  'minimum_custom_format_score',
  'upgrade_until_score',
  'upgrade_score_increment',
]);

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Validate one proposed change and narrow it, or throw a 400. */
function validateProposedChange(change: unknown, index: number): ProposedChange {
  if (typeof change !== 'object' || change === null) {
    throw error(400, `proposedChanges[${index}]: must be an object`);
  }
  const candidate = change as Record<string, unknown>;
  if (typeof candidate.profileName !== 'string' || candidate.profileName.length === 0) {
    throw error(400, `proposedChanges[${index}].profileName: must be a non-empty string`);
  }

  if (candidate.kind === 'set_cf_score') {
    if (typeof candidate.customFormatName !== 'string' || candidate.customFormatName.length === 0) {
      throw error(400, `proposedChanges[${index}].customFormatName: must be a non-empty string`);
    }
    if (!isFiniteInteger(candidate.score)) {
      throw error(400, `proposedChanges[${index}].score: must be a finite integer`);
    }
    return candidate as ProposedChange;
  }

  if (candidate.kind === 'set_profile_setting') {
    if (typeof candidate.field !== 'string' || !PROFILE_SETTING_FIELDS.has(candidate.field)) {
      throw error(400, `proposedChanges[${index}].field: must be one of ${[...PROFILE_SETTING_FIELDS].join(', ')}`);
    }
    if (!isFiniteInteger(candidate.value)) {
      throw error(400, `proposedChanges[${index}].value: must be a finite integer`);
    }
    return candidate as ProposedChange;
  }

  throw error(400, `proposedChanges[${index}].kind: unsupported proposed-change kind`);
}

/**
 * `FieldChange.current`/`.desired` (`$sync/preview/types.ts`) are internally typed
 * `unknown`, while the generated `FieldChange` OpenAPI schema types them as a closed
 * JSON-value union. Same wire-boundary narrowing as resolved-config's `toWireOverrides`
 * / the diff route's `toWireChange` -- the two shapes are identical once serialized.
 */
function toWireChanges(changes: FieldChange[]): EntityConfigDiff['changes'] {
  return changes as unknown as EntityConfigDiff['changes'];
}

/**
 * Build a per-profile config A/B diff (current-resolved vs sandbox-resolved) for
 * each edited quality profile. Must be materialized inside the sandbox closure,
 * before the sandbox cache is closed. Quality profiles are arr-agnostic, so the
 * resolved reads pass `arrType: undefined`.
 */
async function buildConfigDiff(
  currentCache: PCDCache,
  sandboxCache: PCDCache,
  arrType: 'radarr' | 'sonarr',
  profileNames: string[]
): Promise<EntityConfigDiff[]> {
  const result: EntityConfigDiff[] = [];
  for (const name of profileNames) {
    const current = await readEntityOrNull(currentCache, 'qualityProfile', undefined, name);
    const proposed = await readEntityOrNull(sandboxCache, 'qualityProfile', undefined, name);
    const changes = computeUserOverrides(current, proposed);
    result.push({ entityType: 'quality_profile', name, arrType, changes: toWireChanges(changes) });
  }
  return result;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: SimulateImpactRequest;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid request body: expected valid JSON');
  }

  const { databaseId, arrType, releases, profileNames, proposedChanges } = body;

  if (typeof databaseId !== 'number' || !Number.isFinite(databaseId)) {
    throw error(400, 'databaseId must be a finite number');
  }
  if (!isArrType(arrType)) {
    throw error(400, 'Invalid arrType. Expected one of: radarr, sonarr');
  }
  if (!Array.isArray(profileNames) || profileNames.length === 0) {
    throw error(400, 'Missing or empty profileNames array');
  }
  if (profileNames.length > MAX_PROFILES) {
    throw error(400, `profileNames exceeds maximum of ${MAX_PROFILES}`);
  }
  if (!Array.isArray(releases) || releases.length === 0) {
    throw error(400, 'Missing or empty releases array');
  }
  if (releases.length > MAX_RELEASES) {
    throw error(400, `releases exceeds maximum of ${MAX_RELEASES}`);
  }
  for (let i = 0; i < releases.length; i++) {
    const release = releases[i];
    if (typeof release !== 'object' || release === null) {
      throw error(400, `releases[${i}]: must be an object`);
    }
    if (typeof release.title !== 'string' || release.title.trim() === '') {
      throw error(400, `releases[${i}].title: must be a non-empty string`);
    }
    if (!isReleaseType(release.type)) {
      throw error(400, `releases[${i}].type: must be one of "movie", "series"`);
    }
  }
  for (const selector of profileNames) {
    parseProfileSelector(selector);
  }
  if (!Array.isArray(proposedChanges)) {
    throw error(400, 'proposedChanges must be an array');
  }
  if (proposedChanges.length > MAX_CHANGES) {
    throw error(400, `proposedChanges exceeds maximum of ${MAX_CHANGES}`);
  }
  const changes = proposedChanges.map((change, index) => validateProposedChange(change, index));

  const currentCache = pcdManager.getCache(databaseId);
  if (!currentCache) {
    throw error(404, 'Database not found or cache not available');
  }

  const parserAvailable = await isParserHealthy();

  // Which selected profiles are PCD (editable) vs TRaSH (read-only)?
  const pcdProfileNames = new Set<string>();
  const trashProfileNames = new Set<string>();
  for (const selector of profileNames) {
    const parsed = parseProfileSelector(selector);
    if (parsed.kind === 'pcd') pcdProfileNames.add(parsed.name);
    else trashProfileNames.add(parsed.name);
  }

  // Partition proposed changes into per-PCD-profile edits; skip trash/unknown targets.
  const partitionSkipped: SkippedChange[] = [];
  const changesByProfile = new Map<string, ProposedChange[]>();
  for (const change of changes) {
    if (trashProfileNames.has(change.profileName)) {
      partitionSkipped.push({ change, reason: 'trash-profile-not-editable' });
      continue;
    }
    if (!pcdProfileNames.has(change.profileName)) {
      partitionSkipped.push({ change, reason: 'unknown-profile' });
      continue;
    }
    const list = changesByProfile.get(change.profileName) ?? [];
    list.push(change);
    changesByProfile.set(change.profileName, list);
  }

  // Seed each edited profile's scoring input from its current settings, then fold changes in.
  const editsByProfile = new Map<string, ProfileEdit>();
  for (const [name, profileChanges] of changesByProfile) {
    let scoreData;
    try {
      scoreData = await scoring(currentCache, databaseId, name);
    } catch (err) {
      if (err instanceof QualityProfileScoringNotFoundError) {
        for (const change of profileChanges) partitionSkipped.push({ change, reason: 'unknown-profile' });
        continue;
      }
      throw err;
    }

    const input: UpdateScoringInput = {
      minimumScore: scoreData.minimum_custom_format_score,
      upgradeUntilScore: scoreData.upgrade_until_score,
      upgradeScoreIncrement: scoreData.upgrade_score_increment,
      customFormatScores: [],
    };
    for (const change of profileChanges) {
      if (change.kind === 'set_cf_score') {
        input.customFormatScores.push({ customFormatName: change.customFormatName, arrType, score: change.score });
      } else if (change.field === 'minimum_custom_format_score') {
        input.minimumScore = change.value;
      } else if (change.field === 'upgrade_until_score') {
        input.upgradeUntilScore = change.value;
      } else {
        input.upgradeScoreIncrement = change.value;
      }
    }
    editsByProfile.set(name, { input, changes: profileChanges });
  }

  // Precompute parse + patterns once against the current cache (conditions are
  // invariant across the sandbox in Phase-2, so both passes share them).
  const formats = await getAllConditionsForEvaluation(currentCache);
  const parseResults = parserAvailable
    ? await parseWithCacheBatch(releases.map((release) => ({ title: release.title, type: release.type })))
    : new Map();
  const patternMatches = parserAvailable
    ? await matchPatternsBatch(
        releases.map((release) => release.title),
        extractAllPatterns(formats)
      )
    : null;

  const ctx: SimulateScoreContext = {
    arrType,
    releases: releases.map((release) => ({ id: release.id, title: release.title, type: release.type })),
    profileNames: [...pcdProfileNames],
    parseResults,
    patternMatches,
    formats,
  };

  const currentScores = parserAvailable ? await simulateReleaseScores(currentCache, databaseId, ctx) : null;

  const editedProfileNames = [...editsByProfile.keys()];
  const {
    proposedScores,
    configDiff,
    report,
  }: {
    proposedScores: Awaited<ReturnType<typeof simulateReleaseScores>> | null;
    configDiff: EntityConfigDiff[];
    report: SandboxReport;
  } = await withSandboxCache(databaseId, editsByProfile, async (sandboxCache, sandboxReport) => ({
    proposedScores: parserAvailable ? await simulateReleaseScores(sandboxCache, databaseId, ctx) : null,
    configDiff: await buildConfigDiff(currentCache, sandboxCache, arrType, editedProfileNames),
    report: sandboxReport,
  }));

  // Cascade warnings: for each distinct CF that was actually re-scored, how many
  // profiles reference it. Topology is unchanged by score edits, so read from the
  // current cache (cascadeBasis: 'current').
  const cascadeCfNames = new Set<string>();
  for (const change of report.appliedChanges) {
    if (change.kind === 'set_cf_score') cascadeCfNames.add(change.customFormatName);
  }
  const cascade: CascadeWarning[] = [];
  for (const name of cascadeCfNames) {
    try {
      const impact = await getImpact(
        currentCache,
        databaseId,
        { kind: 'custom_format', name },
        { direction: 'dependents', depth: 2, arrType }
      );
      cascade.push({
        nodeKind: 'custom_format',
        name,
        arrType,
        counts: impact.counts,
        byArrType: Object.fromEntries(Object.entries(impact.byArrType).map(([key, edges]) => [key, edges.length])),
        truncated: impact.truncated,
      });
    } catch (err) {
      await logger.warn('Cascade lookup failed during impact simulation', {
        source: SOURCE,
        meta: { name, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const releaseImpacts: ReleaseImpact[] =
    currentScores && proposedScores
      ? currentScores.map((current, releaseIndex) => {
          const proposed = proposedScores[releaseIndex];
          const proposedByName = new Map(proposed.profiles.map((profile) => [profile.profileName, profile]));

          const profiles: ProfileImpact[] = [];
          for (const currentProfile of current.profiles) {
            const proposedProfile = proposedByName.get(currentProfile.profileName);
            if (!proposedProfile) continue;

            const changedCfs: CfContributionDelta[] = [];
            const cfNames = new Set([
              ...currentProfile.matchedCfScores.keys(),
              ...proposedProfile.matchedCfScores.keys(),
            ]);
            for (const cfName of cfNames) {
              const currentScore = currentProfile.matchedCfScores.get(cfName) ?? 0;
              const proposedScore = proposedProfile.matchedCfScores.get(cfName) ?? 0;
              if (currentScore !== proposedScore) {
                changedCfs.push({
                  cfName,
                  matches: true,
                  currentScore,
                  proposedScore,
                  delta: proposedScore - currentScore,
                });
              }
            }

            profiles.push({
              profileName: currentProfile.profileName,
              editable: true,
              currentTotal: currentProfile.totalScore,
              proposedTotal: proposedProfile.totalScore,
              delta: proposedProfile.totalScore - currentProfile.totalScore,
              minimumScore: currentProfile.minimumScore,
              upgradeUntilScore: currentProfile.upgradeUntilScore,
              currentState: resolveThresholdState(
                currentProfile.totalScore,
                currentProfile.minimumScore,
                currentProfile.upgradeUntilScore
              ),
              proposedState: resolveThresholdState(
                proposedProfile.totalScore,
                proposedProfile.minimumScore,
                proposedProfile.upgradeUntilScore
              ),
              changedCfs,
            });
          }

          return { id: current.id, title: current.title, parsed: current.parsed, profiles };
        })
      : [];

  return json({
    parserAvailable,
    cascadeBasis: 'current',
    appliedChanges: report.appliedChanges,
    skippedChanges: [...partitionSkipped, ...report.skippedChanges],
    releaseImpacts,
    configDiff,
    cascade,
  } satisfies SimulateImpactResponse);
};
