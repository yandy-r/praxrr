import type { components } from '$api/v1.d.ts';

/**
 * Shared field-change display helpers for the Resolved Config Viewer panels
 * (ResolvedStatePanel, LiveDiffPanel, CrossInstanceGrid) -- single source of truth for
 * the field-change glyph/label/color legend and the raw-value formatter used in every
 * diff table across the three panels.
 */

type FieldChangeType = components['schemas']['SyncPreviewFieldChangeType'];

/** Glyph/label/text-color legend for a `FieldChange`'s `type` (added/changed/removed). */
export const FIELD_META: Record<FieldChangeType, { glyph: string; label: string; textClass: string }> = {
  added: { glyph: '+', label: 'Added', textClass: 'text-emerald-700 dark:text-emerald-300' },
  changed: { glyph: '~', label: 'Changed', textClass: 'text-amber-700 dark:text-amber-300' },
  removed: { glyph: '-', label: 'Removed', textClass: 'text-red-700 dark:text-red-300' },
};

/** Renders a field's raw value for diff tables -- primitives inline, everything else as pretty JSON. */
export function formatFieldValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

type FieldLineage = components['schemas']['FieldLineage'];
type LineageSourceKind = FieldLineage['sourceKind'];
type BadgeVariant = 'neutral' | 'info' | 'warning' | 'accent';

/** Badge label/variant legend for a field's lineage `sourceKind` (issue #231). */
export const LINEAGE_META: Record<LineageSourceKind, { label: string; variant: BadgeVariant }> = {
  'schema-default': { label: 'Schema default', variant: 'neutral' },
  'base-op': { label: 'Base op', variant: 'neutral' },
  'tweaks-op': { label: 'Tweaks op', variant: 'info' },
  'user-op': { label: 'User op', variant: 'accent' },
  ambiguous: { label: 'Ambiguous', variant: 'warning' },
  unavailable: { label: 'Unavailable', variant: 'neutral' },
};

/**
 * Presentation model for one field's lineage badge: the source label/variant, whether the
 * value was explicitly written (vs an implicit default), and a human tooltip identifying the
 * establishing op (opId for DB ops, filename for file-layer ops).
 */
export function formatLineage(lineage: FieldLineage): {
  label: string;
  variant: BadgeVariant;
  explicit: boolean;
  detail: string;
} {
  const meta = LINEAGE_META[lineage.sourceKind];
  let detail: string;
  if (lineage.status !== 'resolved') {
    detail =
      lineage.sourceKind === 'ambiguous'
        ? 'Provenance is ambiguous (conflicted, pending, or unparsable evidence).'
        : 'No establishing op or default backs this value.';
  } else if (lineage.sourceKind === 'schema-default') {
    detail = 'Implicit database default (no op set this field).';
  } else if (lineage.opId !== null && lineage.opId !== undefined) {
    detail = `Established by ${lineage.sourceLayer} op #${lineage.opId}${lineage.explicit ? '' : ' (implicit)'}.`;
  } else if (lineage.opRef) {
    detail = `Established by ${lineage.sourceLayer} op ${lineage.opRef.filename}.`;
  } else {
    detail = `Established by the ${lineage.sourceLayer} layer.`;
  }
  return { label: meta.label, variant: meta.variant, explicit: lineage.explicit, detail };
}
