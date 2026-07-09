/**
 * Versioned phrasing registry for the narration engine (issue #21).
 *
 * This is the single place features register human-readable wording. Everything here is a
 * pure function or constant. Labels are keyed by explicit `arrType` with a literal/structural
 * fallback so an unmapped entity/field degrades to its raw name — never a borrowed sibling-Arr
 * label (see the repo's cross-Arr semantic policy).
 */

import type { FieldChange, SyncPreviewArrType, SyncPreviewSection } from '$sync/preview/types.ts';
import type { DriftCategory, DriftReason } from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';

/** Verb describing how a single field diverged. */
export function resolveFieldVerb(type: FieldChange['type']): string {
  switch (type) {
    case 'added':
      return 'set';
    case 'changed':
      return 'changed';
    case 'removed':
      return 'cleared';
  }
}

/** Pluralized "N field(s) differ(s)" phrase for entity update headlines. */
export function resolveFieldCountPhrase(count: number): string {
  return count === 1 ? '1 field differs' : `${count} fields differ`;
}

/**
 * Friendly per-Arr entity label. Checked Arr-specific-first, then the shared map, then the raw
 * `entityType`. The Arr-specific layer is empty today but keeps the seam open so a future
 * divergent term is added under its own Arr without touching the others.
 */
const COMMON_ENTITY_LABELS: Readonly<Record<string, string>> = {
  customFormat: 'Custom Format',
  qualityProfile: 'Quality Profile',
  qualityDefinition: 'Quality Definition',
  delayProfile: 'Delay Profile',
  metadataProfile: 'Metadata Profile',
  naming: 'Naming Configuration',
  mediaSettings: 'Media Management Settings',
};

const ARR_ENTITY_LABELS: Partial<Record<SyncPreviewArrType, Readonly<Record<string, string>>>> = {};

export function resolveEntityLabel(arrType: SyncPreviewArrType, entityType: string): string {
  return ARR_ENTITY_LABELS[arrType]?.[entityType] ?? COMMON_ENTITY_LABELS[entityType] ?? entityType;
}

/**
 * Friendly per-Arr field label, keyed `(arrType, entityType, section, field)`. Unmapped fields
 * degrade to the RAW field name (structural fallback) so narration is always correct-but-plain
 * and never borrows a sibling-Arr label.
 */
const COMMON_FIELD_LABELS: Readonly<Record<string, string>> = {
  cutoff: 'Cutoff quality',
  minFormatScore: 'Minimum custom format score',
  cutoffFormatScore: 'Upgrade-until custom format score',
  minUpgradeFormatScore: 'Minimum upgrade custom format score',
  name: 'Name',
  score: 'Score',
};

const ARR_FIELD_LABELS: Partial<Record<SyncPreviewArrType, Readonly<Record<string, string>>>> = {};

export function resolveFieldLabel(
  arrType: SyncPreviewArrType,
  entityType: string,
  section: SyncPreviewSection | null,
  field: string
): string {
  void entityType;
  void section;
  return ARR_FIELD_LABELS[arrType]?.[field] ?? COMMON_FIELD_LABELS[field] ?? field;
}

/** State clause describing a drift category, used to frame a drift entity headline. */
export function resolveDriftCategoryPhrase(category: DriftCategory): string {
  switch (category) {
    case 'drift':
      return 'has drifted from the resolved config';
    case 'missing':
      return 'is missing on this instance';
    case 'unmanaged':
      return 'exists on this instance but is not managed by Praxrr';
  }
}

const REASON_SENTENCE: Readonly<Record<DriftReason, string>> = {
  unreachable: 'Praxrr could not reach this instance; the host appears to be down or unreachable.',
  timeout: 'The instance did not respond in time.',
  unauthorized: "Praxrr's API key was rejected by this instance; authentication failed.",
  invalid_response: 'The instance returned a response Praxrr could not understand.',
  not_configured: 'This instance is not configured for drift checks.',
  cache_not_ready: 'The PCD cache is not ready yet, so drift could not be computed.',
  rate_limited: 'The instance rate-limited the request; Praxrr will retry later.',
  error: 'An unexpected error occurred while checking this instance.',
};

const STATUS_SENTENCE: Readonly<Record<DriftSummaryStatus, string>> = {
  'in-sync': 'This instance matches the resolved PCD configuration.',
  'never-checked': 'This instance has not been checked for drift yet.',
  drifted: 'This instance has drifted from the resolved configuration.',
  unreachable: 'Praxrr could not reach this instance.',
  unauthorized: "Praxrr's API key was rejected by this instance.",
  error: 'An unexpected error occurred while checking this instance.',
};

/**
 * Full-sentence failure/state explanation. A specific `reason` (when present) always wins over
 * the coarser `status`, so the eight sanitized drift reasons each get a distinct sentence and a
 * null reason falls back to a safe, status-derived sentence.
 */
export function resolveReasonExplanation(status: DriftSummaryStatus, reason: DriftReason | null): string {
  if (reason !== null) return REASON_SENTENCE[reason];
  return STATUS_SENTENCE[status];
}
