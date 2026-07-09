/**
 * Transparent Automation Engine — pure narration engine (issue #21).
 *
 * Turns the decision records the sync-preview and drift engines have ALREADY computed into
 * leveled, human-readable {@link NarrationLine}s. This module performs no I/O, no fetching, no
 * re-diffing, and no re-tallying — it only renders inputs it is handed. Drift narration
 * delegates to the single {@link narrateEntityChange} core so the field-level phrasing has one
 * source of truth; a drift category only reframes the headline and sets the tone.
 */

import type { EntityChange, SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';
import type { DriftCategory, DriftCounts, DriftEntityChange, DriftReason } from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';
import { NARRATION_TEMPLATE_VERSION } from './types.ts';
import type { NarrationLevel, NarrationLine, NarrationTone } from './types.ts';
import {
  resolveDriftCategoryPhrase,
  resolveEntityLabel,
  resolveFieldCountPhrase,
  resolveFieldLabel,
  resolveFieldVerb,
  resolveReasonExplanation,
} from './templates.ts';

const DRIFT_CATEGORY_TONE: Readonly<Record<DriftCategory, NarrationTone>> = {
  drift: 'warning',
  missing: 'warning',
  unmanaged: 'neutral',
};

/**
 * Severity ranking for a narration tone (higher = more severe), the single source of truth for
 * ordering lines most-severe-first. Shared so every consumer — config-health suggestions,
 * security-posture top actions — ranks tones identically.
 */
export const TONE_SEVERITY: Readonly<Record<NarrationTone, number>> = {
  neutral: 0,
  info: 1,
  warning: 2,
  danger: 3,
};

const STATUS_TONE: Readonly<Record<DriftSummaryStatus, NarrationTone>> = {
  'in-sync': 'neutral',
  'never-checked': 'neutral',
  drifted: 'warning',
  unreachable: 'warning',
  unauthorized: 'danger',
  error: 'danger',
};

function pluralEntities(count: number): string {
  return count === 1 ? 'entity' : 'entities';
}

function joinClauses(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * The single reusable core: narrate one entity change as a sync decision. Summary yields the
 * headline with empty detail; verbose adds one detail line per field, but only for `update`
 * (create/delete carry no field diffs and `unchanged` collapses — the "don't over-explain"
 * rule). `section` is passed separately because {@link EntityChange} does not carry it.
 */
export function narrateEntityChange(
  change: EntityChange,
  arrType: SyncPreviewArrType,
  section: SyncPreviewSection | null,
  level: NarrationLevel
): NarrationLine {
  const label = resolveEntityLabel(arrType, change.entityType);
  let headline: string;
  let tone: NarrationTone;

  switch (change.action) {
    case 'create':
      headline = `Add ${label} "${change.name}".`;
      tone = 'info';
      break;
    case 'delete':
      headline = `Remove ${label} "${change.name}".`;
      tone = 'info';
      break;
    case 'unchanged':
      headline = `${label} "${change.name}" already matches the resolved config.`;
      tone = 'neutral';
      break;
    case 'update':
      headline = `Update ${label} "${change.name}" (${resolveFieldCountPhrase(change.fields.length)}).`;
      tone = 'info';
      break;
  }

  const detail =
    level === 'verbose' && change.action === 'update'
      ? change.fields.map(
          (field) =>
            `${resolveFieldLabel(arrType, change.entityType, section, field.field)} ${resolveFieldVerb(field.type)}.`
        )
      : [];

  return { headline, detail, tone, templateVersion: NARRATION_TEMPLATE_VERSION };
}

/**
 * Narrate a drift entity. Normalizes the {@link DriftEntityChange} (which is an entity change
 * plus `section` and `category`) and delegates to {@link narrateEntityChange} for the field
 * detail lines, then reframes the headline for the drift category and applies the category tone.
 */
export function narrateDriftEntity(
  change: DriftEntityChange,
  arrType: SyncPreviewArrType,
  level: NarrationLevel
): NarrationLine {
  const core: EntityChange = {
    entityType: change.entityType,
    name: change.name,
    action: change.action,
    remoteId: change.remoteId,
    fields: change.fields,
  };
  const base = narrateEntityChange(core, arrType, change.section, level);
  const label = resolveEntityLabel(arrType, change.entityType);
  const categoryPhrase = resolveDriftCategoryPhrase(change.category);
  const headline =
    change.category === 'drift'
      ? `${label} "${change.name}" ${categoryPhrase} (${resolveFieldCountPhrase(change.fields.length)}).`
      : `${label} "${change.name}" ${categoryPhrase}.`;

  return {
    headline,
    detail: base.detail,
    tone: DRIFT_CATEGORY_TONE[change.category],
    templateVersion: NARRATION_TEMPLATE_VERSION,
  };
}

/**
 * Narrate a drift instance's status/reason as a user-facing failure or state sentence — the
 * "failure reasons in user-facing language" half of the issue's acceptance criteria. Verbose
 * adds a "what happens next" line for recoverable failures.
 */
export function narrateDriftReason(
  status: DriftSummaryStatus,
  reason: DriftReason | null,
  level: NarrationLevel
): NarrationLine {
  const headline = resolveReasonExplanation(status, reason);
  const isFailure = status === 'unreachable' || status === 'unauthorized' || status === 'error';
  const detail = level === 'verbose' && isFailure ? ['Praxrr will retry on the next scheduled drift check.'] : [];

  return { headline, detail, tone: STATUS_TONE[status], templateVersion: NARRATION_TEMPLATE_VERSION };
}

/**
 * Narrate the per-category drift rollup as a single headline. Reads {@link DriftCounts}
 * verbatim — it never re-tallies the change arrays. Verbose adds a definitional line per
 * non-zero category so the rollup teaches what each category means.
 */
export function narrateDriftCounts(
  counts: DriftCounts,
  status: DriftSummaryStatus,
  level: NarrationLevel
): NarrationLine {
  if (status === 'never-checked') {
    return {
      headline: 'This instance has not been checked for drift yet.',
      detail: [],
      tone: 'neutral',
      templateVersion: NARRATION_TEMPLATE_VERSION,
    };
  }

  if (status === 'unreachable' || status === 'unauthorized' || status === 'error') {
    return {
      headline: 'Drift could not be determined because the last check did not complete.',
      detail: [],
      tone: STATUS_TONE[status],
      templateVersion: NARRATION_TEMPLATE_VERSION,
    };
  }

  const { drifted, missing, unmanaged } = counts;
  if (drifted === 0 && missing === 0 && unmanaged === 0) {
    return {
      headline: 'No drift detected — this instance matches the resolved configuration.',
      detail: [],
      tone: 'neutral',
      templateVersion: NARRATION_TEMPLATE_VERSION,
    };
  }

  const parts: string[] = [];
  if (drifted > 0) parts.push(`${drifted} drifted`);
  if (missing > 0) parts.push(`${missing} missing`);
  if (unmanaged > 0) parts.push(`${unmanaged} unmanaged`);

  const detail: string[] = [];
  if (level === 'verbose') {
    if (drifted > 0) detail.push(`${drifted} managed ${pluralEntities(drifted)} drifted from the resolved config.`);
    if (missing > 0) detail.push(`${missing} managed ${pluralEntities(missing)} not present on the instance.`);
    if (unmanaged > 0)
      detail.push(`${unmanaged} unmanaged ${pluralEntities(unmanaged)} present on the instance (info only).`);
  }

  return {
    headline: `Praxrr found ${joinClauses(parts)}.`,
    detail,
    tone: drifted > 0 || missing > 0 ? 'warning' : 'neutral',
    templateVersion: NARRATION_TEMPLATE_VERSION,
  };
}
