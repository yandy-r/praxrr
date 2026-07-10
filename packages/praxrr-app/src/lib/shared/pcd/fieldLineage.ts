/**
 * Field Lineage — wire types + pure classification for exact per-field provenance.
 *
 * The Resolved Config viewer answers "which source and which exact op last established
 * this resolved field value" without fabricating provenance. This module holds the
 * wire-facing `FieldLineage` shape (mirrored by the OpenAPI `FieldLineage` schema) and
 * the pure, cache-free classifier `explainFieldLineage` plus `foldPendingConflict`.
 *
 * Keep this file wire-safe: no server imports at runtime. The structural helper inputs
 * (`EffectiveCell`, `SchemaDefaultView`) are declared inline so server capture types can
 * satisfy them without a server -> shared dependency cycle.
 */

// ============================================================================
// WIRE TYPES
// ============================================================================

/** The four distinct source layers (AC2). File layers (schema, tweaks) have no opId. */
export type LineageSourceLayer = 'schema' | 'base' | 'tweaks' | 'user';

/** Per-field classification exposed on the wire (AC2 + AC3 + AC4). */
export type LineageSourceKind =
  | 'schema-default' // never explicitly written by any op; value equals the parsed DEFAULT
  | 'base-op'
  | 'tweaks-op'
  | 'user-op'
  | 'ambiguous' // evidence conflicts or is unparseable; makes NO source claim (AC4)
  | 'unavailable'; // no establishing op and no default backs this path (AC4/AC5)

/** Top-level field status. Distinct from `sourceKind` so status is a first-class gate. */
export type LineageFieldStatus = 'resolved' | 'ambiguous' | 'unavailable';

/** Entity-level rollup returned alongside the lineage array. */
export type LineageEntityStatus = 'available' | 'ambiguous' | 'unavailable';

/** Identity of a FILE-layer op (schema/tweaks), which has no `pcd_ops` row / opId. */
export interface LineageOpRef {
  filename: string;
  order: number;
}

/** One record per serializer-emitted Portable leaf path. */
export interface FieldLineage {
  /** Bracketed nested path, byte-identical to `diffToFieldChanges` (e.g. `conditions["HDR"].negate`). */
  fieldPath: string;
  /** Required gate. Non-`resolved` rows make NO source claim. */
  status: LineageFieldStatus;
  /** null unless `status === 'resolved'`. */
  sourceLayer: LineageSourceLayer | null;
  /** Always present; `ambiguous`/`unavailable` when `status !== 'resolved'`. */
  sourceKind: LineageSourceKind;
  /** DB ops (base/user) only; null for file layers and schema-default. */
  opId: number | null;
  /** FILE ops (schema/tweaks) only; null for DB ops and schema-default. */
  opRef: LineageOpRef | null;
  /** true iff a column list explicitly named this column (AC3). */
  explicit: boolean;
  /** Display-only signal; NEVER an input to classification. Present when comparable. */
  valueEqualsDefault?: boolean;
}

// ============================================================================
// STRUCTURAL CLASSIFIER INPUTS (satisfied by server capture types)
// ============================================================================

/**
 * The surviving explicit writer for a `(table, rowKey, column)` cell after value-guard
 * status folding (skipped/error writers already removed by the caller). `ambiguous` is
 * true when the surviving establishing op is `conflicted`/`conflicted_pending`.
 */
export interface EffectiveCell {
  readonly sourceLayer: LineageSourceLayer;
  readonly opId: number | null;
  readonly opRef: LineageOpRef | null;
  readonly ambiguous: boolean;
}

/** Minimal view of a parsed schema-default entry needed to classify an implicit value. */
export interface SchemaDefaultView {
  readonly hasDefault: boolean;
  readonly schemaFile: string;
}

export interface ExplainFieldLineageInput {
  readonly fieldPath: string;
  /** The surviving explicit writer, or null when no op ever named this column. */
  readonly effectiveCell: EffectiveCell | null;
  /** Parsed schema default for the backing column, or undefined when none is known. */
  readonly schemaDefault: SchemaDefaultView | undefined;
  /**
   * Whether the resolved value equals the parsed default literal. `undefined` when not
   * comparable (e.g. `CURRENT_TIMESTAMP` default, or no default). NEVER used to classify
   * an explicit cell — only to decide implicit `schema-default` vs `ambiguous`.
   */
  readonly valueMatchesDefault: boolean | undefined;
}

// ============================================================================
// PURE CLASSIFICATION
// ============================================================================

function sourceKindForLayer(layer: LineageSourceLayer): LineageSourceKind {
  switch (layer) {
    case 'schema':
      return 'schema-default';
    case 'base':
      return 'base-op';
    case 'tweaks':
      return 'tweaks-op';
    case 'user':
      return 'user-op';
  }
}

function ambiguousLineage(fieldPath: string, explicit: boolean, valueEqualsDefault?: boolean): FieldLineage {
  return {
    fieldPath,
    status: 'ambiguous',
    sourceLayer: null,
    sourceKind: 'ambiguous',
    opId: null,
    opRef: null,
    explicit,
    ...(valueEqualsDefault === undefined ? {} : { valueEqualsDefault }),
  };
}

function unavailableLineage(fieldPath: string): FieldLineage {
  return {
    fieldPath,
    status: 'unavailable',
    sourceLayer: null,
    sourceKind: 'unavailable',
    opId: null,
    opRef: null,
    explicit: false,
  };
}

/**
 * Classify one resolved field's lineage from already-folded evidence (§5 + §6 of the design).
 *
 * Rules:
 * - An explicit surviving writer -> `${layer}-op`, `explicit: true`. This holds EVEN when the
 *   written value equals the default (AC3). A conflicted/pending surviving writer -> `ambiguous`.
 * - No explicit writer + a known default: value == default -> `schema-default` (implicit);
 *   value != default -> `ambiguous` (an unmodeled write path we refuse to attribute) (AC4/AC7).
 * - No explicit writer + no default -> `unavailable`.
 *
 * `schema-default` is derived only from absence of ANY explicit write across all four layers plus
 * a positive value==default check — NEVER from absence of a user override (AC7).
 */
export function explainFieldLineage(input: ExplainFieldLineageInput): FieldLineage {
  const { fieldPath, effectiveCell, schemaDefault, valueMatchesDefault } = input;

  if (effectiveCell) {
    if (effectiveCell.ambiguous) {
      return ambiguousLineage(fieldPath, true, valueMatchesDefault);
    }
    return {
      fieldPath,
      status: 'resolved',
      sourceLayer: effectiveCell.sourceLayer,
      sourceKind: sourceKindForLayer(effectiveCell.sourceLayer),
      opId: effectiveCell.opId,
      opRef: effectiveCell.opRef,
      explicit: true,
      ...(valueMatchesDefault === undefined ? {} : { valueEqualsDefault: valueMatchesDefault }),
    };
  }

  if (schemaDefault?.hasDefault) {
    if (valueMatchesDefault === true) {
      return {
        fieldPath,
        status: 'resolved',
        sourceLayer: 'schema',
        sourceKind: 'schema-default',
        opId: null,
        opRef: { filename: schemaDefault.schemaFile, order: 0 },
        explicit: false,
        valueEqualsDefault: true,
      };
    }
    // Never explicitly written, yet value differs from the parsed default -> an unmodeled
    // write path (trigger / INSERT..SELECT / parse gap). Refuse to claim schema-default.
    return ambiguousLineage(fieldPath, false, valueMatchesDefault ?? false);
  }

  return unavailableLineage(fieldPath);
}

/**
 * Business Rule 6: an entity with a pending value-guard conflict must never present an
 * unambiguous resolved value. When `hasPendingConflict` is true, force EVERY field to
 * `ambiguous` and the entity status to `ambiguous`.
 *
 * Otherwise the entity status is `unavailable` when there are no fields, else `available`.
 */
export function foldPendingConflict(
  fields: FieldLineage[],
  hasPendingConflict: boolean
): { lineage: FieldLineage[]; lineageStatus: LineageEntityStatus } {
  if (hasPendingConflict) {
    return {
      lineage: fields.map((field) => ambiguousLineage(field.fieldPath, field.explicit, field.valueEqualsDefault)),
      lineageStatus: 'ambiguous',
    };
  }

  return { lineage: fields, lineageStatus: fields.length === 0 ? 'unavailable' : 'available' };
}
