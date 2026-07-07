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
