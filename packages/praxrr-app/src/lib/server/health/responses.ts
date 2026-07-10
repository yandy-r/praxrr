/**
 * Config Health wire mappers (issue #22).
 *
 * Translate internal engine/query types (which use `readonly` arrays) into plain, mutable wire
 * objects that `satisfies components['schemas'][...]` at the route boundary. These interfaces are
 * the source of truth the OpenAPI `config-health.yaml` schemas mirror — keep them in lockstep.
 */

import type { NarrationLine, NarrationTone } from '$shared/narration/index.ts';
import type {
  CriterionConfig,
  CriterionMeta,
  CriterionResult,
  HealthArrType,
  HealthBand,
  HealthReport,
  ScoredUnit,
} from '$shared/health/index.ts';
import { CONFIG_HEALTH_ENGINE_VERSION, CRITERION_CATALOG } from '$shared/health/index.ts';
import type { ConfigHealthSettings } from '$db/queries/configHealthSettings.ts';
import type { ConfigHealthTrendResult } from './trends.ts';

// --- wire shapes (mutable; mirror the OpenAPI schemas) ----------------------------------------

export interface WireSuggestion {
  headline: string;
  detail: string[];
  tone: NarrationTone;
  templateVersion: string;
}

export interface WireCriterion {
  id: string;
  label: string;
  score: number | null;
  weight: number;
  contribution: number;
  detail: string[];
  suggestions: WireSuggestion[];
}

export interface WireScoredUnit {
  score: number;
  band: HealthBand;
  criteria: WireCriterion[];
  suggestions: WireSuggestion[];
}

export interface WireProfileHealth extends WireScoredUnit {
  name: string;
}

export interface ConfigHealthInstanceSummary {
  instanceId: number;
  instanceName: string;
  arrType: HealthArrType;
  score: number;
  band: HealthBand;
  generatedAt: string;
}

export interface ConfigHealthTotals {
  instances: number;
  healthy: number;
  attention: number;
  needsReview: number;
  unknown: number;
  averageScore: number | null;
}

export interface ConfigHealthSettingsSnapshot {
  enabled: boolean;
  intervalMinutes: number;
}

export interface ConfigHealthSummaryResponse {
  engineVersion: string;
  generatedAt: string;
  totals: ConfigHealthTotals;
  settings: ConfigHealthSettingsSnapshot;
  instances: ConfigHealthInstanceSummary[];
}

export interface ConfigHealthDetailResponse {
  instanceId: number;
  instanceName: string;
  arrType: HealthArrType;
  engineVersion: string;
  generatedAt: string;
  overall: WireScoredUnit;
  profiles: WireProfileHealth[];
}

export interface ConfigHealthTrendInstance {
  id: number;
  name: string;
  arrType: HealthArrType;
}

export interface ConfigHealthTrendFilter {
  from: string | null;
  to: string;
  profile: string | null;
}

export interface ConfigHealthTrendRetention {
  days: number;
  maxEntries: number;
  ageCutoffAt: string;
  oldestAvailableAt: string | null;
  newestAvailableAt: string | null;
}

export interface ConfigHealthTrendCounts {
  points: number;
  measured: number;
  unknown: number;
  missing: number;
}

export interface ConfigHealthTrendEngineBoundary {
  engineVersion: string;
  startsAt: string;
  pointIndex: number;
}

export interface ConfigHealthTrendCriterion {
  id: string;
  label: string;
  state: 'measured' | 'not-evaluated' | 'not-recorded';
  score: number | null;
  weight: number | null;
  contribution: number | null;
}

export interface ConfigHealthTrendPoint {
  snapshotId: number;
  generatedAt: string;
  engineVersion: string;
  state: 'measured' | 'unknown' | 'profile-missing' | 'not-recorded';
  score: number | null;
  band: HealthBand | null;
  criteria: ConfigHealthTrendCriterion[];
}

export interface ConfigHealthTrendsResponse {
  instance: ConfigHealthTrendInstance;
  currentEngineVersion: string;
  normalizedFilter: ConfigHealthTrendFilter;
  retention: ConfigHealthTrendRetention;
  availableProfiles: string[];
  counts: ConfigHealthTrendCounts;
  engineBoundaries: ConfigHealthTrendEngineBoundary[];
  points: ConfigHealthTrendPoint[];
}

export interface ConfigHealthSettingsResponse {
  engineVersion: string;
  enabled: boolean;
  intervalMinutes: number;
  retentionDays: number;
  retentionMaxEntries: number;
  criteria: CriterionConfig[];
  catalog: CriterionMeta[];
}

// --- mappers ----------------------------------------------------------------------------------

function toWireSuggestion(line: NarrationLine): WireSuggestion {
  return { headline: line.headline, detail: [...line.detail], tone: line.tone, templateVersion: line.templateVersion };
}

function toWireCriterion(criterion: CriterionResult): WireCriterion {
  return {
    id: criterion.id,
    label: criterion.label,
    score: criterion.score,
    weight: criterion.weight,
    contribution: criterion.contribution,
    detail: [...criterion.detail],
    suggestions: criterion.suggestions.map(toWireSuggestion),
  };
}

function toWireUnit(unit: ScoredUnit): WireScoredUnit {
  return {
    score: unit.score,
    band: unit.band,
    criteria: unit.criteria.map(toWireCriterion),
    suggestions: unit.suggestions.map(toWireSuggestion),
  };
}

/** One instance's full report → the detail response. */
export function toDetailResponse(report: HealthReport): ConfigHealthDetailResponse {
  return {
    instanceId: report.instanceId,
    instanceName: report.instanceName,
    arrType: report.arrType,
    engineVersion: report.engineVersion,
    generatedAt: report.generatedAt,
    overall: toWireUnit(report.overall),
    profiles: report.profiles.map((profile) => ({ name: profile.name, ...toWireUnit(profile) })),
  };
}

/** A fleet of reports + settings → the summary response (light per-instance rows + totals). */
export function toSummaryResponse(
  reports: readonly HealthReport[],
  settings: ConfigHealthSettings,
  generatedAt: string
): ConfigHealthSummaryResponse {
  const instances: ConfigHealthInstanceSummary[] = reports.map((report) => ({
    instanceId: report.instanceId,
    instanceName: report.instanceName,
    arrType: report.arrType,
    score: report.overall.score,
    band: report.overall.band,
    generatedAt: report.generatedAt,
  }));

  const scored = instances.filter((instance) => instance.band !== 'unknown');
  const averageScore =
    scored.length > 0 ? Math.round(scored.reduce((sum, instance) => sum + instance.score, 0) / scored.length) : null;

  const totals: ConfigHealthTotals = {
    instances: instances.length,
    healthy: instances.filter((i) => i.band === 'healthy').length,
    attention: instances.filter((i) => i.band === 'attention').length,
    needsReview: instances.filter((i) => i.band === 'needs-review').length,
    unknown: instances.filter((i) => i.band === 'unknown').length,
    averageScore,
  };

  return {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    generatedAt,
    totals,
    settings: { enabled: settings.enabled === 1, intervalMinutes: settings.interval_minutes },
    instances,
  };
}

/** Canonical historical result → a plain mutable OpenAPI-aligned response. */
export function toTrendsResponse(result: ConfigHealthTrendResult): ConfigHealthTrendsResponse {
  return {
    instance: { ...result.instance },
    currentEngineVersion: result.currentEngineVersion,
    normalizedFilter: { ...result.normalizedFilter },
    retention: { ...result.retention },
    availableProfiles: [...result.availableProfiles],
    counts: { ...result.counts },
    engineBoundaries: result.engineBoundaries.map((boundary) => ({ ...boundary })),
    points: result.points.map((point) => ({
      ...point,
      criteria: point.criteria.map((criterion) => ({ ...criterion })),
    })),
  };
}

/** Settings row → the settings response (adds the engine version + static criterion catalog). */
export function toSettingsResponse(settings: ConfigHealthSettings): ConfigHealthSettingsResponse {
  return {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    enabled: settings.enabled === 1,
    intervalMinutes: settings.interval_minutes,
    retentionDays: settings.retention_days,
    retentionMaxEntries: settings.retention_max_entries,
    criteria: settings.criteria.map((criterion) => ({ ...criterion })),
    catalog: CRITERION_CATALOG.map((meta) => ({ ...meta })),
  };
}
