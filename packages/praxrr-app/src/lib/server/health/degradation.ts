/**
 * Pure Config Health degradation policy and notification projection.
 *
 * This module deliberately performs no database, clock, logging, or network I/O. Callers pass two
 * adjacent persisted snapshots; the result is a complete, validated event or a fail-closed outcome.
 */

import { CRITERION_IDS, type CriterionId, type HealthArrType, type HealthBand } from '$shared/health/types.ts';
import { Colors, type DiscordEmbed, type EmbedField } from '../notifications/notifiers/discord/embed.ts';

export const HEALTH_DEGRADATION_MIN_SCORE_DROP = 5;

export const HEALTH_DEGRADATION_EMBED_TITLE_LIMIT = 256;
export const HEALTH_DEGRADATION_EMBED_FIELD_NAME_LIMIT = 256;
export const HEALTH_DEGRADATION_EMBED_FIELD_VALUE_LIMIT = 1_024;
export const HEALTH_DEGRADATION_EMBED_MAX_FIELDS = 25;
export const HEALTH_DEGRADATION_MAX_CONTRIBUTORS = 3;
export const HEALTH_DEGRADATION_EMBED_TEXT_BUDGET = 5_500;

const EVENT_TYPE = 'health.degraded' as const;
const SIGNATURE_VERSION = 'health-degraded:v1' as const;
const ELLIPSIS = '…';
const MEASURABLE_BANDS = ['healthy', 'attention', 'needs-review'] as const;
const ARR_TYPES = ['radarr', 'sonarr', 'lidarr'] as const;
const BAND_RANK: Readonly<Record<MeasurableHealthBand, number>> = {
  healthy: 0,
  attention: 1,
  'needs-review': 2,
};

export type MeasurableHealthBand = Exclude<HealthBand, 'unknown'>;

/** The persisted subset consumed by the pure policy. */
export interface HealthDegradationCriterionSnapshot {
  readonly id: string;
  readonly label: string;
  readonly score: number | null;
  readonly weight: number;
  readonly contribution: number;
  readonly detail: readonly string[];
  readonly suggestions: readonly { readonly headline: string }[];
}

/** Structurally compatible with ConfigHealthSnapshotDetail without importing the DB layer. */
export interface HealthDegradationSnapshot {
  readonly id: number;
  readonly arrInstanceId: number | null;
  readonly instanceName: string;
  readonly arrType: string;
  readonly engineVersion: string;
  readonly overallScore: number;
  readonly band: string;
  readonly criteriaScores: readonly HealthDegradationCriterionSnapshot[];
  readonly generatedAt: string;
}

export interface HealthDegradedCriterionContext {
  readonly id: CriterionId;
  readonly label: string;
  readonly previousScore: number | null;
  readonly currentScore: number;
  /** Positive when this criterion declined; null for current-context fallback evidence. */
  readonly scoreDrop: number | null;
  readonly contributionDrop: number | null;
  readonly kind: 'contributor' | 'current-context';
  readonly suggestion: string | null;
}

export interface HealthDegradedEvent {
  readonly type: typeof EVENT_TYPE;
  readonly signature: string;
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: HealthArrType;
  readonly engineVersion: string;
  readonly previousSnapshotId: number;
  readonly currentSnapshotId: number;
  readonly previousScore: number;
  readonly currentScore: number;
  readonly previousBand: MeasurableHealthBand;
  readonly currentBand: MeasurableHealthBand;
  /** Previous minus current. A band transition remains authoritative if inconsistent legacy data makes this negative. */
  readonly pointDrop: number;
  readonly kind: 'band' | 'score';
  readonly contributors: readonly HealthDegradedCriterionContext[];
  readonly generatedAt: string;
  readonly detailsPath: string;
}

export type HealthDegradationIncomparableReason =
  | 'no-baseline'
  | 'invalid-identity'
  | 'different-instance'
  | 'different-arr-type'
  | 'invalid-engine-version'
  | 'different-engine-version'
  | 'unknown-or-invalid-band'
  | 'invalid-score'
  | 'invalid-criteria'
  | 'changed-scoring-basis'
  | 'invalid-snapshot-metadata';

export type HealthDegradationAssessment =
  | {
      readonly kind: 'incomparable';
      readonly reason: HealthDegradationIncomparableReason;
    }
  | { readonly kind: 'quiet' }
  | { readonly kind: 'recovery'; readonly pointGain: number }
  | { readonly kind: 'degradation'; readonly event: HealthDegradedEvent };

export interface HealthDegradedNotificationProjection {
  readonly title: string;
  readonly message: string;
  readonly embed: DiscordEmbed;
}

interface ValidCriterion extends HealthDegradationCriterionSnapshot {
  readonly id: CriterionId;
}

interface ValidSnapshot extends HealthDegradationSnapshot {
  readonly arrInstanceId: number;
  readonly arrType: HealthArrType;
  readonly band: MeasurableHealthBand;
  readonly criteriaScores: readonly ValidCriterion[];
}

function isFiniteIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isArrType(value: unknown): value is HealthArrType {
  return typeof value === 'string' && (ARR_TYPES as readonly string[]).includes(value);
}

function isMeasurableBand(value: unknown): value is MeasurableHealthBand {
  return typeof value === 'string' && (MEASURABLE_BANDS as readonly string[]).includes(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function validateCriteria(value: unknown): readonly ValidCriterion[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const seen = new Set<CriterionId>();
  const criteria: ValidCriterion[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const criterion = candidate as Record<string, unknown>;
    if (typeof criterion.id !== 'string' || !(CRITERION_IDS as readonly string[]).includes(criterion.id)) {
      return undefined;
    }
    const id = criterion.id as CriterionId;
    if (seen.has(id)) return undefined;
    seen.add(id);

    if (typeof criterion.label !== 'string') return undefined;
    if (criterion.score !== null && !isFiniteIntegerInRange(criterion.score, 0, 100)) return undefined;
    if (typeof criterion.weight !== 'number' || !Number.isFinite(criterion.weight) || criterion.weight < 0) {
      return undefined;
    }
    if (!isFiniteIntegerInRange(criterion.contribution, 0, 100)) {
      return undefined;
    }
    if (!Array.isArray(criterion.detail) || !criterion.detail.every((line) => typeof line === 'string'))
      return undefined;
    if (
      !Array.isArray(criterion.suggestions) ||
      !criterion.suggestions.every(
        (suggestion) =>
          suggestion !== null &&
          typeof suggestion === 'object' &&
          typeof (suggestion as Record<string, unknown>).headline === 'string'
      )
    ) {
      return undefined;
    }

    criteria.push(candidate as ValidCriterion);
  }

  if (!criteria.some((criterion) => criterion.score !== null)) return undefined;
  return criteria;
}

function validateSnapshot(snapshot: HealthDegradationSnapshot): ValidSnapshot | HealthDegradationIncomparableReason {
  if (
    !isFiniteIntegerInRange(snapshot.id, 1, Number.MAX_SAFE_INTEGER) ||
    !isFiniteIntegerInRange(snapshot.arrInstanceId, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return 'invalid-identity';
  }
  if (!isArrType(snapshot.arrType)) return 'different-arr-type';
  if (typeof snapshot.engineVersion !== 'string' || snapshot.engineVersion.trim().length === 0) {
    return 'invalid-engine-version';
  }
  if (!isMeasurableBand(snapshot.band)) return 'unknown-or-invalid-band';
  if (!isFiniteIntegerInRange(snapshot.overallScore, 0, 100)) {
    return 'invalid-score';
  }
  if (typeof snapshot.instanceName !== 'string' || !isIsoTimestamp(snapshot.generatedAt)) {
    return 'invalid-snapshot-metadata';
  }
  const criteria = validateCriteria(snapshot.criteriaScores);
  if (!criteria) return 'invalid-criteria';
  return { ...snapshot, criteriaScores: criteria } as ValidSnapshot;
}

function criterionMap(criteria: readonly ValidCriterion[]): ReadonlyMap<CriterionId, ValidCriterion> {
  return new Map(criteria.map((criterion) => [criterion.id, criterion]));
}

function hasSameScoringBasis(previous: ValidSnapshot, current: ValidSnapshot): boolean {
  const previousById = criterionMap(previous.criteriaScores);
  const currentById = criterionMap(current.criteriaScores);
  if (previousById.size !== currentById.size) return false;

  for (const id of CRITERION_IDS) {
    const before = previousById.get(id);
    const after = currentById.get(id);
    if (Boolean(before) !== Boolean(after)) return false;
    if (!before || !after) continue;
    if (before.weight !== after.weight) return false;
    if ((before.score === null) !== (after.score === null)) return false;
  }
  return true;
}

function criterionOrder(id: CriterionId): number {
  return CRITERION_IDS.indexOf(id);
}

function firstSuggestion(criterion: ValidCriterion): string | null {
  const headline = criterion.suggestions[0]?.headline;
  return typeof headline === 'string' && headline.length > 0 ? headline : null;
}

function selectContributorContext(
  previous: ValidSnapshot,
  current: ValidSnapshot
): readonly HealthDegradedCriterionContext[] {
  const previousById = criterionMap(previous.criteriaScores);
  const declined = current.criteriaScores
    .flatMap((after): HealthDegradedCriterionContext[] => {
      const before = previousById.get(after.id);
      if (
        before?.score === null ||
        before?.score === undefined ||
        after.score === null ||
        after.score >= before.score
      ) {
        return [];
      }
      return [
        {
          id: after.id,
          label: after.label,
          previousScore: before.score,
          currentScore: after.score,
          scoreDrop: before.score - after.score,
          contributionDrop: before.contribution - after.contribution,
          kind: 'contributor',
          suggestion: firstSuggestion(after),
        },
      ];
    })
    .sort(
      (left, right) =>
        (right.scoreDrop ?? 0) - (left.scoreDrop ?? 0) ||
        (right.contributionDrop ?? 0) - (left.contributionDrop ?? 0) ||
        criterionOrder(left.id) - criterionOrder(right.id)
    );

  if (declined.length > 0) {
    return declined.slice(0, HEALTH_DEGRADATION_MAX_CONTRIBUTORS);
  }

  const measurable = current.criteriaScores
    .filter((criterion): criterion is ValidCriterion & { readonly score: number } => criterion.score !== null)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.contribution - right.contribution ||
        criterionOrder(left.id) - criterionOrder(right.id)
    );
  const fallback = measurable.find((criterion) => firstSuggestion(criterion) !== null) ?? measurable[0];
  if (!fallback) return [];
  const before = previousById.get(fallback.id);
  return [
    {
      id: fallback.id,
      label: fallback.label,
      previousScore: before?.score ?? null,
      currentScore: fallback.score,
      scoreDrop: null,
      contributionDrop: null,
      kind: 'current-context',
      suggestion: firstSuggestion(fallback),
    },
  ];
}

function canonicalCriteria(snapshot: ValidSnapshot): readonly (readonly [CriterionId, number | null])[] {
  const byId = criterionMap(snapshot.criteriaScores);
  return CRITERION_IDS.flatMap((id) => {
    const criterion = byId.get(id);
    return criterion ? ([[criterion.id, criterion.score]] as const) : [];
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Build the exact versioned current-state signature used by the durable claim. */
export async function buildHealthDegradationSignature(snapshot: HealthDegradationSnapshot): Promise<string> {
  const valid = validateSnapshot(snapshot);
  if (typeof valid === 'string') {
    throw new TypeError(`Cannot sign invalid health snapshot: ${valid}`);
  }
  const canonical = JSON.stringify([
    SIGNATURE_VERSION,
    valid.arrInstanceId,
    valid.engineVersion,
    valid.band,
    valid.overallScore,
    canonicalCriteria(valid),
  ]);
  return sha256Hex(canonical);
}

/** Compare one adjacent persisted pair. Invalid or ambiguous evidence always fails closed. */
export async function assessHealthDegradation(
  previous: HealthDegradationSnapshot | undefined,
  current: HealthDegradationSnapshot
): Promise<HealthDegradationAssessment> {
  if (!previous) return { kind: 'incomparable', reason: 'no-baseline' };

  const validPrevious = validateSnapshot(previous);
  if (typeof validPrevious === 'string') {
    return { kind: 'incomparable', reason: validPrevious };
  }
  const validCurrent = validateSnapshot(current);
  if (typeof validCurrent === 'string') {
    return { kind: 'incomparable', reason: validCurrent };
  }

  if (validPrevious.arrInstanceId !== validCurrent.arrInstanceId) {
    return { kind: 'incomparable', reason: 'different-instance' };
  }
  if (validPrevious.arrType !== validCurrent.arrType) {
    return { kind: 'incomparable', reason: 'different-arr-type' };
  }
  if (validPrevious.engineVersion !== validCurrent.engineVersion) {
    return { kind: 'incomparable', reason: 'different-engine-version' };
  }
  if (!hasSameScoringBasis(validPrevious, validCurrent)) {
    return { kind: 'incomparable', reason: 'changed-scoring-basis' };
  }

  const previousRank = BAND_RANK[validPrevious.band];
  const currentRank = BAND_RANK[validCurrent.band];
  const pointDrop = validPrevious.overallScore - validCurrent.overallScore;
  const pointGain = -pointDrop;

  const worseBand = currentRank > previousRank;
  const sameBandDegradation = currentRank === previousRank && pointDrop >= HEALTH_DEGRADATION_MIN_SCORE_DROP;
  if (worseBand || sameBandDegradation) {
    const signature = await buildHealthDegradationSignature(validCurrent);
    return {
      kind: 'degradation',
      event: {
        type: EVENT_TYPE,
        signature,
        instanceId: validCurrent.arrInstanceId,
        instanceName: validCurrent.instanceName,
        arrType: validCurrent.arrType,
        engineVersion: validCurrent.engineVersion,
        previousSnapshotId: validPrevious.id,
        currentSnapshotId: validCurrent.id,
        previousScore: validPrevious.overallScore,
        currentScore: validCurrent.overallScore,
        previousBand: validPrevious.band,
        currentBand: validCurrent.band,
        pointDrop,
        kind: worseBand ? 'band' : 'score',
        contributors: selectContributorContext(validPrevious, validCurrent),
        generatedAt: validCurrent.generatedAt,
        detailsPath: `/config-health/${validCurrent.arrInstanceId}`,
      },
    };
  }

  const betterBand = currentRank < previousRank;
  const sameBandRecovery = currentRank === previousRank && pointGain >= HEALTH_DEGRADATION_MIN_SCORE_DROP;
  if (betterBand || sameBandRecovery) return { kind: 'recovery', pointGain };
  return { kind: 'quiet' };
}

function redactUnsafeDisplayText(value: string): string {
  return value
    .replace(/\b(?:https?|ftp):\/\/[^\s]+/giu, '[link removed]')
    .replace(/\bwww\.[^\s]+/giu, '[link removed]')
    .replace(/\bsk-[a-z0-9_-]{16,}\b/giu, '[secret removed]')
    .replace(/\b[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/giu, '[secret removed]')
    .replace(/\b[a-f0-9]{32,}\b/giu, '[secret removed]')
    .replace(/\b(api[_-]?key|token|secret|authorization|password)\s*[=:]\s*\S+/giu, '$1=[secret removed]');
}

function sanitizeDiscordText(value: string): string {
  const normalized = redactUnsafeDisplayText(value).replace(/\r\n?/g, '\n');
  const withoutControls = Array.from(normalized, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isC0OrC1 = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    const isBidiControl =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069);
    if (isC0OrC1) return character === '\n' ? ' ' : '';
    return isBidiControl ? '' : character;
  }).join('');
  return withoutControls.replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&');
}

function truncateVisible(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let result = '';
  for (const character of value) {
    if (result.length + character.length > limit - ELLIPSIS.length) break;
    result += character;
  }
  return `${result}${ELLIPSIS}`;
}

function boundedDiscordText(value: string, limit: number, fallback = '—'): string {
  const safe = sanitizeDiscordText(value).trim();
  return truncateVisible(safe || fallback, limit);
}

function bandLabel(band: MeasurableHealthBand): string {
  if (band === 'healthy') return 'Healthy';
  if (band === 'attention') return 'Attention';
  return 'Needs review';
}

function appLabel(arrType: HealthArrType): string {
  if (arrType === 'radarr') return 'Radarr';
  if (arrType === 'sonarr') return 'Sonarr';
  return 'Lidarr';
}

function signedScoreChange(event: HealthDegradedEvent): string {
  const change = event.currentScore - event.previousScore;
  return `${change > 0 ? '+' : ''}${change} point${Math.abs(change) === 1 ? '' : 's'}`;
}

function contributorLine(context: HealthDegradedCriterionContext): string {
  const label = context.label || 'Criterion';
  if (context.kind === 'current-context') {
    const suggestion = context.suggestion ? ` — ${context.suggestion}` : '';
    return `• ${label}: ${context.currentScore}/100 current context${suggestion}`;
  }
  const suggestion = context.suggestion ? ` — ${context.suggestion}` : '';
  return `• ${label}: ${context.previousScore}→${context.currentScore} (−${context.scoreDrop})${suggestion}`;
}

function embedTextLength(embed: DiscordEmbed): number {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0)
  );
}

function fitEmbedBudget(embed: DiscordEmbed): DiscordEmbed {
  if (embedTextLength(embed) <= HEALTH_DEGRADATION_EMBED_TEXT_BUDGET) {
    return embed;
  }
  const fields = [...(embed.fields ?? [])];
  for (
    let index = fields.length - 1;
    index >= 0 && embedTextLength({ ...embed, fields }) > HEALTH_DEGRADATION_EMBED_TEXT_BUDGET;
    index--
  ) {
    const over = embedTextLength({ ...embed, fields }) - HEALTH_DEGRADATION_EMBED_TEXT_BUDGET;
    const field = fields[index];
    fields[index] = {
      ...field,
      value: truncateVisible(field.value, Math.max(1, field.value.length - over)),
    };
  }
  return { ...embed, fields };
}

/** Project validated event data into bounded generic content and one sanitized warning embed. */
export function buildHealthDegradedNotification(event: HealthDegradedEvent): HealthDegradedNotificationProjection {
  const app = appLabel(event.arrType);
  const title = boundedDiscordText(
    `Config health decreased on ${event.instanceName || 'Arr instance'}`,
    HEALTH_DEGRADATION_EMBED_TITLE_LIMIT
  );
  const previous = `${event.previousScore}/100 · ${bandLabel(event.previousBand)}`;
  const current = `${event.currentScore}/100 · ${bandLabel(event.currentBand)}`;
  const change = `${signedScoreChange(event)} · ${event.kind === 'band' ? 'worse band' : 'score decrease'}`;

  const context = event.contributors.length
    ? event.contributors.slice(0, HEALTH_DEGRADATION_MAX_CONTRIBUTORS).map(contributorLine).join('\n')
    : 'No single criterion change was identified.';
  const contextName = event.contributors[0]?.kind === 'current-context' ? 'Current context' : 'Contributors';
  const fields: EmbedField[] = [
    { name: 'Previous', value: previous, inline: true },
    { name: 'Current', value: current, inline: true },
    { name: 'Change', value: change, inline: false },
    { name: 'App', value: app, inline: true },
    { name: contextName, value: context, inline: false },
    { name: 'Observed', value: event.generatedAt, inline: false },
    { name: 'Details', value: event.detailsPath, inline: false },
  ]
    .slice(0, HEALTH_DEGRADATION_EMBED_MAX_FIELDS)
    .map((field) => ({
      ...field,
      name: boundedDiscordText(field.name, HEALTH_DEGRADATION_EMBED_FIELD_NAME_LIMIT),
      value: boundedDiscordText(field.value, HEALTH_DEGRADATION_EMBED_FIELD_VALUE_LIMIT),
    }));

  const embed = fitEmbedBudget({
    title,
    color: Colors.WARNING,
    timestamp: event.generatedAt,
    fields,
    footer: { text: 'Praxrr Config Health' },
  });

  const topContext = event.contributors[0];
  const contextSummary = topContext
    ? topContext.kind === 'contributor'
      ? ` Largest contributor: ${topContext.label || 'criterion'} ${topContext.previousScore}→${topContext.currentScore}.`
      : ` Current context: ${topContext.label || 'criterion'} ${topContext.currentScore}/100.`
    : ' No single criterion change was identified.';
  const message = boundedDiscordText(
    `${event.instanceName || 'Arr instance'} (${app}) changed from ${previous} to ${current}; ${signedScoreChange(
      event
    )}.${contextSummary} Review ${event.detailsPath}.`,
    HEALTH_DEGRADATION_EMBED_FIELD_VALUE_LIMIT
  );

  return { title, message, embed };
}
