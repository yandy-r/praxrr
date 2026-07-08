/**
 * Dependency Graph — Reverse-dependency reference readers (DRY source)
 *
 * The single definition of the "who references this entity" enumeration queries that were
 * previously inlined across three op-generating handlers. Each returns the EXACT row shape
 * those handlers need for their value-guarded DELETE ops, so op generation stays byte-
 * identical after the handlers switch to consuming these readers (guarded by
 * `tests/pcd/graph/references.test.ts`). The dependency-graph E1/E2 reverse edges
 * (`edges.ts`) reuse the same readers and map the rows to `GraphEdge`.
 *
 * Consumers:
 *  - `customFormats/delete.ts`            -> getCustomFormatDependentScores (ordered)
 *  - `customFormats/general/update.ts`    -> getCustomFormatDependentScores (UNORDERED)
 *  - `regularExpressions/delete.ts`       -> getRegularExpressionDependentConditions
 *  - `graph/edges.ts` (E1/E2 reverse)     -> both
 */

import type { PCDCache } from '$pcd/database/cache.ts';

// ============================================================================
// E1: custom format <- quality profile scores
// ============================================================================

/** Orderable columns for the custom-format dependent-scores enumeration. */
export type CustomFormatDependentScoreOrderColumn = 'quality_profile_name' | 'custom_format_name' | 'arr_type';

export interface CustomFormatDependentScoreOptions {
  /**
   * Opt-in ORDER BY columns. `customFormats/delete.ts` passes
   * `['quality_profile_name', 'arr_type']`; `customFormats/general/update.ts` passes
   * NOTHING (its op write order follows Map insertion order — hard-coding an order here
   * would drift its generated ops).
   */
  orderBy?: readonly CustomFormatDependentScoreOrderColumn[];
}

/**
 * Every `quality_profile_custom_formats` row scoring `customFormatName`, across all
 * arr_types (`'all'` kept distinct). Selects the value-guard columns (`score`) the delete
 * handler needs.
 */
export function getCustomFormatDependentScores(
  cache: PCDCache,
  customFormatName: string,
  options: CustomFormatDependentScoreOptions = {}
) {
  let query = cache.kb
    .selectFrom('quality_profile_custom_formats')
    .select(['quality_profile_name', 'custom_format_name', 'arr_type', 'score'])
    .where('custom_format_name', '=', customFormatName);

  for (const column of options.orderBy ?? []) {
    query = query.orderBy(column);
  }

  return query.execute();
}

export type CustomFormatDependentScoreRow = Awaited<ReturnType<typeof getCustomFormatDependentScores>>[number];

// ============================================================================
// E2: regular expression <- custom format conditions
// ============================================================================

/**
 * Every custom-format condition that references `regularExpressionName` via
 * `condition_patterns`, joined to its parent `custom_format_conditions` row for the
 * value-guard columns (`type`, `arr_type`, `negate`, `required`) the delete handler needs.
 * `arr_type` is sourced from the parent condition (`condition_patterns` has none). Ordered
 * deterministically by `(custom_format_name, condition_name)` — the same order
 * `regularExpressions/delete.ts` relied on.
 */
export function getRegularExpressionDependentConditions(cache: PCDCache, regularExpressionName: string) {
  return cache.kb
    .selectFrom('condition_patterns as cp')
    .innerJoin('custom_format_conditions as cfc', (join) =>
      join.onRef('cfc.custom_format_name', '=', 'cp.custom_format_name').onRef('cfc.name', '=', 'cp.condition_name')
    )
    .select(['cp.custom_format_name', 'cp.condition_name', 'cfc.type', 'cfc.arr_type', 'cfc.negate', 'cfc.required'])
    .where('cp.regular_expression_name', '=', regularExpressionName)
    .orderBy('cp.custom_format_name')
    .orderBy('cp.condition_name')
    .execute();
}

export type RegularExpressionDependentConditionRow = Awaited<
  ReturnType<typeof getRegularExpressionDependentConditions>
>[number];
