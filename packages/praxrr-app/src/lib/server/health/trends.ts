/**
 * Canonical Config Health trend projection and read service (issue #226).
 *
 * Historical rows are persisted evidence: this module never recomputes scores, bands, criteria, or
 * profile identity. The pure projector preserves query order; the small service owns instance
 * validation, the exact cap sentinel, and current retention context.
 */

import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSettingsQueries, type ConfigHealthSettings } from '$db/queries/configHealthSettings.ts';
import {
  CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
  ConfigHealthTrendEvidenceLimitError,
  configHealthSnapshotsQueries,
  type ConfigHealthTrendProfileNameOptions,
  type ConfigHealthTrendSearchOptions,
  type ConfigHealthTrendSnapshotDetail,
} from '$db/queries/configHealthSnapshots.ts';
import {
  CONFIG_HEALTH_ENGINE_VERSION,
  type CriterionResult,
  type HealthArrType,
  type HealthBand,
} from '$shared/health/index.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { ConfigHealthTrendFilters } from './trendFilters.ts';

export const MAX_CONFIG_HEALTH_TREND_POINTS = 10_000;
const TREND_QUERY_LIMIT = MAX_CONFIG_HEALTH_TREND_POINTS + 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ConfigHealthTrendPointState = 'measured' | 'unknown' | 'profile-missing' | 'not-recorded';
export type ConfigHealthTrendCriterionState = 'measured' | 'not-evaluated' | 'not-recorded';

export interface ConfigHealthTrendInstance {
  readonly id: number;
  readonly name: string;
  readonly arrType: HealthArrType;
}

export interface ConfigHealthTrendNormalizedFilter {
  readonly from: string | null;
  readonly to: string;
  readonly profile: string | null;
}

export interface ConfigHealthTrendRetention {
  readonly days: number;
  readonly maxEntries: number;
  readonly ageCutoffAt: string;
  readonly oldestAvailableAt: string | null;
  readonly newestAvailableAt: string | null;
}

export interface ConfigHealthTrendCounts {
  readonly points: number;
  readonly measured: number;
  readonly unknown: number;
  readonly missing: number;
}

export interface ConfigHealthTrendEngineBoundary {
  readonly engineVersion: string;
  readonly startsAt: string;
  readonly pointIndex: number;
}

export interface ConfigHealthTrendCriterion {
  readonly id: string;
  readonly label: string;
  readonly state: ConfigHealthTrendCriterionState;
  readonly score: number | null;
  readonly weight: number | null;
  readonly contribution: number | null;
}

export interface ConfigHealthTrendPoint {
  readonly snapshotId: number;
  readonly generatedAt: string;
  readonly engineVersion: string;
  readonly state: ConfigHealthTrendPointState;
  readonly score: number | null;
  readonly band: HealthBand | null;
  readonly criteria: readonly ConfigHealthTrendCriterion[];
}

export interface ConfigHealthTrendResult {
  readonly instance: ConfigHealthTrendInstance;
  readonly currentEngineVersion: string;
  readonly normalizedFilter: ConfigHealthTrendNormalizedFilter;
  readonly retention: ConfigHealthTrendRetention;
  readonly availableProfiles: readonly string[];
  readonly counts: ConfigHealthTrendCounts;
  readonly engineBoundaries: readonly ConfigHealthTrendEngineBoundary[];
  readonly points: readonly ConfigHealthTrendPoint[];
}

type TrendSettings = Pick<ConfigHealthSettings, 'retention_days' | 'retention_max_entries'>;
type TrendInstanceRecord = {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly enabled: number;
};

export interface BuildConfigHealthTrendResultInput {
  readonly instance: ConfigHealthTrendInstance;
  readonly filters: ConfigHealthTrendFilters;
  readonly snapshots: readonly ConfigHealthTrendSnapshotDetail[];
  readonly availableProfiles?: readonly string[];
  readonly settings: TrendSettings;
  readonly currentEngineVersion: string;
  readonly nowIso: string;
}

export interface ConfigHealthTrendServiceDependencies {
  readonly getInstance: (instanceId: number) => TrendInstanceRecord | undefined;
  readonly getSettings: () => TrendSettings;
  readonly searchTrend: (
    instanceId: number,
    options: ConfigHealthTrendSearchOptions
  ) => ConfigHealthTrendSnapshotDetail[];
  readonly listProfileNames: (
    instanceId: number,
    arrType: HealthArrType,
    options: ConfigHealthTrendProfileNameOptions
  ) => string[];
  readonly hasArrTypeMismatch: (instanceId: number, arrType: HealthArrType) => boolean;
  readonly now: () => Date | number;
  readonly currentEngineVersion: string;
}

/** A domain read failure that routes map without exposing storage details. */
export class ConfigHealthTrendServiceError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 422
  ) {
    super(message);
    this.name = 'ConfigHealthTrendServiceError';
  }
}

const DEFAULT_DEPENDENCIES: ConfigHealthTrendServiceDependencies = {
  getInstance: (instanceId) => arrInstancesQueries.getById(instanceId),
  getSettings: () => configHealthSettingsQueries.get(),
  searchTrend: (instanceId, options) => configHealthSnapshotsQueries.searchTrend(instanceId, options),
  listProfileNames: (instanceId, arrType, options) =>
    configHealthSnapshotsQueries.listTrendProfileNames(instanceId, arrType, options),
  hasArrTypeMismatch: (instanceId, arrType) =>
    configHealthSnapshotsQueries.hasTrendArrTypeMismatch(instanceId, arrType),
  now: () => Date.now(),
  currentEngineVersion: CONFIG_HEALTH_ENGINE_VERSION,
};

function isHealthBand(value: unknown): value is HealthBand {
  return value === 'healthy' || value === 'attention' || value === 'needs-review' || value === 'unknown';
}

function isIntegerInRange(value: unknown, minimum: number, maximum = Number.POSITIVE_INFINITY): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isPortableScore(value: unknown): value is number {
  return isIntegerInRange(value, 0, 100);
}

function isIdentifiableCriterion(value: unknown): value is CriterionResult {
  if (!value || typeof value !== 'object') return false;
  const criterion = value as Partial<CriterionResult>;
  return typeof criterion.id === 'string' && typeof criterion.label === 'string';
}

function hasUsableCriteria(snapshot: ConfigHealthTrendSnapshotDetail): boolean {
  return snapshot.criteriaScoresValid && snapshot.criteriaScores.every(isIdentifiableCriterion);
}

function hasUsableProfiles(snapshot: ConfigHealthTrendSnapshotDetail): boolean {
  return (
    snapshot.profileScoresValid &&
    snapshot.profileScores.every(
      (profile) =>
        typeof profile?.name === 'string' &&
        profile.name.length > 0 &&
        isPortableScore(profile.score) &&
        isHealthBand(profile.band)
    )
  );
}

function projectCriterion(criterion: CriterionResult): ConfigHealthTrendCriterion {
  if (
    (criterion.score !== null && !isPortableScore(criterion.score)) ||
    !isIntegerInRange(criterion.weight, 0) ||
    !Number.isSafeInteger(criterion.contribution)
  ) {
    return {
      id: criterion.id,
      label: criterion.label,
      state: 'not-recorded',
      score: null,
      weight: null,
      contribution: null,
    };
  }

  if (criterion.score === null) {
    return {
      id: criterion.id,
      label: criterion.label,
      state: 'not-evaluated',
      score: null,
      weight: criterion.weight,
      contribution: null,
    };
  }

  return {
    id: criterion.id,
    label: criterion.label,
    state: 'measured',
    score: criterion.score,
    weight: criterion.weight,
    contribution: criterion.contribution,
  };
}

function unavailablePoint(
  snapshot: ConfigHealthTrendSnapshotDetail,
  state: 'profile-missing' | 'not-recorded'
): ConfigHealthTrendPoint {
  return {
    snapshotId: snapshot.id,
    generatedAt: snapshot.generatedAt,
    engineVersion: snapshot.engineVersion,
    state,
    score: null,
    band: null,
    criteria: [],
  };
}

function scoredPoint(
  snapshot: ConfigHealthTrendSnapshotDetail,
  score: number,
  band: HealthBand,
  criteria: readonly ConfigHealthTrendCriterion[]
): ConfigHealthTrendPoint {
  return {
    snapshotId: snapshot.id,
    generatedAt: snapshot.generatedAt,
    engineVersion: snapshot.engineVersion,
    state: band === 'unknown' ? 'unknown' : 'measured',
    score: band === 'unknown' ? null : score,
    band,
    criteria,
  };
}

function projectPoint(snapshot: ConfigHealthTrendSnapshotDetail, profile: string | undefined): ConfigHealthTrendPoint {
  if (profile !== undefined) {
    if (!hasUsableProfiles(snapshot)) return unavailablePoint(snapshot, 'not-recorded');
    const storedProfile = snapshot.profileScores.find((candidate) => candidate.name === profile);
    if (!storedProfile) return unavailablePoint(snapshot, 'profile-missing');
    return scoredPoint(snapshot, storedProfile.score, storedProfile.band, []);
  }

  if (!hasUsableCriteria(snapshot) || !isHealthBand(snapshot.band) || !isPortableScore(snapshot.overallScore)) {
    return unavailablePoint(snapshot, 'not-recorded');
  }

  return scoredPoint(snapshot, snapshot.overallScore, snapshot.band, snapshot.criteriaScores.map(projectCriterion));
}

function profileOptions(snapshots: readonly ConfigHealthTrendSnapshotDetail[]): string[] {
  const names = new Set<string>();
  for (const snapshot of snapshots) {
    if (!hasUsableProfiles(snapshot)) continue;
    for (const profile of snapshot.profileScores) names.add(profile.name);
  }
  return [...names].sort().slice(0, MAX_CONFIG_HEALTH_TREND_POINTS);
}

function engineBoundaries(points: readonly ConfigHealthTrendPoint[]): ConfigHealthTrendEngineBoundary[] {
  const boundaries: ConfigHealthTrendEngineBoundary[] = [];
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    if (pointIndex === 0 || point.engineVersion !== points[pointIndex - 1].engineVersion) {
      boundaries.push({
        engineVersion: point.engineVersion,
        startsAt: point.generatedAt,
        pointIndex,
      });
    }
  }
  return boundaries;
}

function captureIso(value: Date | number): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Config Health trend clock returned an invalid time');
  return date.toISOString();
}

/** Project already ordered persisted rows into the canonical historical result without I/O. */
export function buildConfigHealthTrendResult(input: BuildConfigHealthTrendResultInput): ConfigHealthTrendResult {
  const points = input.snapshots.map((snapshot) => projectPoint(snapshot, input.filters.profile));
  const measured = points.filter((point) => point.state === 'measured').length;
  const unknown = points.filter((point) => point.state === 'unknown').length;
  const missing = points.length - measured - unknown;
  const oldestAvailableAt = points[0]?.generatedAt ?? null;
  const newestAvailableAt = points.at(-1)?.generatedAt ?? null;
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(nowMs)) throw new Error('Config Health trend nowIso is invalid');

  return {
    instance: { ...input.instance },
    currentEngineVersion: input.currentEngineVersion,
    normalizedFilter: {
      from: input.filters.from ?? null,
      to: input.filters.to,
      profile: input.filters.profile ?? null,
    },
    retention: {
      days: input.settings.retention_days,
      maxEntries: input.settings.retention_max_entries,
      ageCutoffAt: new Date(nowMs - input.settings.retention_days * DAY_MS).toISOString(),
      oldestAvailableAt,
      newestAvailableAt,
    },
    availableProfiles: [...(input.availableProfiles ?? profileOptions(input.snapshots))]
      .sort()
      .slice(0, MAX_CONFIG_HEALTH_TREND_POINTS),
    counts: { points: points.length, measured, unknown, missing },
    engineBoundaries: engineBoundaries(points),
    points,
  };
}

/** Read and project one active, explicitly typed Arr instance's bounded trend history. */
export function readConfigHealthTrend(
  instanceId: number,
  filters: ConfigHealthTrendFilters,
  dependencies: ConfigHealthTrendServiceDependencies = DEFAULT_DEPENDENCIES
): ConfigHealthTrendResult {
  const instance = dependencies.getInstance(instanceId);
  if (!instance || !isSyncPreviewArrType(instance.type) || !instance.enabled) {
    throw new ConfigHealthTrendServiceError('Instance not found or not sync-capable', 404);
  }
  if (dependencies.hasArrTypeMismatch(instanceId, instance.type)) {
    throw new ConfigHealthTrendServiceError('Instance not found or not sync-capable', 404);
  }

  let snapshots: ConfigHealthTrendSnapshotDetail[];
  try {
    snapshots = dependencies.searchTrend(instanceId, {
      from: filters.from,
      to: filters.to,
      limit: TREND_QUERY_LIMIT,
      evidenceBudget: CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
    });
  } catch (error) {
    if (error instanceof ConfigHealthTrendEvidenceLimitError) {
      throw new ConfigHealthTrendServiceError(error.message, 422);
    }
    throw error;
  }
  if (snapshots.length > MAX_CONFIG_HEALTH_TREND_POINTS) {
    throw new ConfigHealthTrendServiceError('Too many Config Health trend points; narrow the requested range', 422);
  }
  if (snapshots.some((snapshot) => snapshot.arrType !== instance.type)) {
    throw new ConfigHealthTrendServiceError('Instance not found or not sync-capable', 404);
  }

  const settings = dependencies.getSettings();
  let availableProfiles: string[];
  try {
    availableProfiles = dependencies.listProfileNames(instanceId, instance.type, {
      limit: MAX_CONFIG_HEALTH_TREND_POINTS,
      snapshotLimit: MAX_CONFIG_HEALTH_TREND_POINTS,
      evidenceBudget: CONFIG_HEALTH_TREND_EVIDENCE_BUDGET,
    });
  } catch (error) {
    if (error instanceof ConfigHealthTrendEvidenceLimitError) {
      throw new ConfigHealthTrendServiceError(error.message, 422);
    }
    throw error;
  }
  if (dependencies.hasArrTypeMismatch(instanceId, instance.type)) {
    throw new ConfigHealthTrendServiceError('Instance not found or not sync-capable', 404);
  }
  return buildConfigHealthTrendResult({
    instance: { id: instance.id, name: instance.name, arrType: instance.type },
    filters,
    snapshots,
    availableProfiles,
    settings,
    currentEngineVersion: dependencies.currentEngineVersion,
    nowIso: captureIso(dependencies.now()),
  });
}
