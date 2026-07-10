/**
 * Quality-ladder ceiling gating (issue #221).
 *
 * Pure, versioned translation of a Quality Goal's resolution ceiling into an explicit
 * quality-ladder configuration: which `quality_profile_qualities` rows are enabled and which single
 * row carries the cutoff (`upgrade_until`). Like {@link ./policy.ts}, this module holds only logic
 * over injected data — no I/O, no DB, no `$sync` imports. The per-Arr resolution numbers arrive as
 * {@link GoalQualityFact}[] materialized on the server from `quality_api_mappings` + `QUALITIES`, so
 * the engine stays arr-agnostic and the per-Arr behavior emerges from each profile's own quality set.
 *
 * Invariants (see docs/internal/221-quality-ladder-design.md):
 * - **Full coverage / zero removals.** When a ladder change is produced, the returned `orderedItems`
 *   contains EVERY current row in order — mapped rows get a new `enabled`/`upgradeUntil`, all other
 *   rows (unmapped-for-arr, junk, all-junk/all-unmapped groups) are cloned verbatim. The shared
 *   `quality_profile_qualities` row set (no `arr_type` column) must never lose a sibling-arr row.
 * - **Cutoff = `Bluray-<ceiling>`.** Exactly one row carries `upgradeUntil=true`. If that row is not
 *   present+mapped in the current ladder, NO ladder change is produced (`ladderInput = null`) — this
 *   is a valid profile, not an error.
 * - **Fail fast only on genuine ambiguity.** A group whose mapped, non-junk members straddle the
 *   ceiling throws {@link GoalLadderMappingError}; everything else degrades to a no-op.
 */

import type { OrderedItem } from '$shared/pcd/display.ts';
import type { GoalResolutionCeiling } from './types.ts';

/**
 * One quality that EXISTS for the target arr, with its resolution from `QUALITIES[arrType]`.
 * `name` is the exact-case PCD canonical quality name (`quality_api_mappings.quality_name`), never
 * the arr API name — so it matches {@link OrderedItem.name} from the qualities read path.
 */
export interface GoalQualityFact {
  name: string;
  resolution: number;
}

/** One row of the ceiling-derived ladder, for the always-shown preview transparency surface. */
export interface GoalQualityLadderItem {
  name: string;
  type: 'quality' | 'group';
  enabled: boolean;
  upgradeUntil: boolean;
  position: number;
  /** Resolution driving the decision, or null for an unmapped/junk/all-passthrough row. */
  resolution: number | null;
  /** False when the row is not present/derivable for the target arr (left unchanged). */
  mapped: boolean;
}

/** The presentational ladder attached to every {@link GoalPlan} (wire-exposed via `qualityLadder`). */
export interface GoalQualityLadder {
  ceiling: GoalResolutionCeiling;
  /** PCD name carrying `upgrade_until`; null when no ladder change is derivable. */
  cutoff: string | null;
  items: GoalQualityLadderItem[];
  /** True when the profile is also compatible with a sibling arr → the reshape is shared. */
  reshapesSiblingArrs: boolean;
  /** Advisory surfaced in preview + decision log when a shared-ladder change is produced. */
  sharedLadderNote: string | null;
}

/** Thrown only for genuine ambiguity (a group straddling the ceiling); translated to HTTP 422. */
export class GoalLadderMappingError extends Error {
  readonly code = 'straddling_group' as const;
  constructor(message: string) {
    super(message);
    this.name = 'GoalLadderMappingError';
  }
}

/**
 * PCD canonical quality names that are never auto-enabled by a ceiling, regardless of their raw
 * resolution number (pre-release/junk sources). These are canonical names, not per-arr API names, so
 * listing them here does not duplicate the per-arr vocabulary in `$sync/mappings.ts`.
 */
export const JUNK_QUALITIES: ReadonlySet<string> = new Set([
  'Unknown',
  'WORKPRINT',
  'CAM',
  'TELESYNC',
  'TELECINE',
  'DVDSCR',
  'REGIONAL',
  'BR-DISK',
  'Raw-HD'
]);

const CEILING_RESOLUTION: Record<GoalResolutionCeiling, number> = {
  '720p': 720,
  '1080p': 1080,
  '2160p': 2160
};

function cloneItem(item: OrderedItem, overrides: Partial<OrderedItem>): OrderedItem {
  const cloned: OrderedItem = {
    type: item.type,
    name: item.name,
    position: item.position,
    enabled: item.enabled,
    upgradeUntil: item.upgradeUntil,
    ...overrides
  };
  if (item.type === 'group') {
    cloned.members = (item.members ?? []).map((member) => ({ name: member.name }));
  }
  return cloned;
}

/** Resolutions of a group's mapped, non-junk members (empty when the group is all junk/unmapped). */
function groupMemberResolutions(item: OrderedItem, factByName: Map<string, GoalQualityFact>): number[] {
  const resolutions: number[] = [];
  for (const member of item.members ?? []) {
    if (JUNK_QUALITIES.has(member.name)) continue;
    const fact = factByName.get(member.name);
    if (fact) resolutions.push(fact.resolution);
  }
  return resolutions;
}

/**
 * Translate a resolution ceiling into a desired quality ladder for one profile.
 *
 * PURE. Returns `ladderInput = null` for every non-fatal "no ladder derivable" case (no
 * `Bluray-<ceiling>` cutoff row present/mapped; no mapped non-junk quality at/below the ceiling).
 * Throws {@link GoalLadderMappingError} ONLY for a genuinely ambiguous straddling group.
 */
export function buildCeilingLadder(
  ceiling: GoalResolutionCeiling,
  currentLadder: OrderedItem[],
  facts: GoalQualityFact[],
  compatibleWithSiblingArr: boolean
): { ladderInput: { orderedItems: OrderedItem[] } | null; ladder: GoalQualityLadder } {
  const ceilingResolution = CEILING_RESOLUTION[ceiling];
  const factByName = new Map(facts.map((fact) => [fact.name, fact]));
  const cutoffName = `Bluray-${ceiling}`;

  // The cutoff must be a present, mapped, standalone quality row. Its absence means the profile has
  // no derivable ladder for this ceiling — a valid profile, not an error.
  const cutoffRow = currentLadder.find(
    (item) => item.type === 'quality' && item.name === cutoffName && factByName.has(item.name)
  );

  const items: GoalQualityLadderItem[] = [];
  const orderedItems: OrderedItem[] = [];
  let enabledMappedCount = 0;

  for (const item of currentLadder) {
    const isCutoff = cutoffRow !== undefined && item.type === 'quality' && item.name === cutoffName;
    const nextUpgradeUntil = cutoffRow !== undefined ? isCutoff : item.upgradeUntil;

    if (item.type === 'quality') {
      const fact = factByName.get(item.name);
      const isJunk = JUNK_QUALITIES.has(item.name);
      const mapped = fact !== undefined && !isJunk;
      const nextEnabled = mapped ? fact!.resolution > 0 && fact!.resolution <= ceilingResolution : item.enabled;
      if (mapped && nextEnabled) enabledMappedCount += 1;

      items.push({
        name: item.name,
        type: 'quality',
        enabled: nextEnabled,
        upgradeUntil: nextUpgradeUntil,
        position: item.position,
        resolution: fact ? fact.resolution : null,
        mapped
      });
      orderedItems.push(cloneItem(item, { enabled: nextEnabled, upgradeUntil: nextUpgradeUntil }));
      continue;
    }

    // Group: decide from its mapped, non-junk members only.
    const memberResolutions = groupMemberResolutions(item, factByName);
    if (memberResolutions.length === 0) {
      // All junk or all unmapped-for-arr → passthrough verbatim (never fatal).
      items.push({
        name: item.name,
        type: 'group',
        enabled: item.enabled,
        upgradeUntil: nextUpgradeUntil,
        position: item.position,
        resolution: null,
        mapped: false
      });
      orderedItems.push(cloneItem(item, { upgradeUntil: nextUpgradeUntil }));
      continue;
    }

    const maxResolution = Math.max(...memberResolutions);
    const minResolution = Math.min(...memberResolutions);
    if (minResolution <= ceilingResolution && maxResolution > ceilingResolution) {
      throw new GoalLadderMappingError(
        `Quality group "${item.name}" straddles the ${ceiling} ceiling (members span ${minResolution}p–${maxResolution}p); ` +
          'cannot derive an unambiguous enabled state.'
      );
    }
    const nextEnabled = maxResolution <= ceilingResolution;
    if (nextEnabled) enabledMappedCount += 1;
    items.push({
      name: item.name,
      type: 'group',
      enabled: nextEnabled,
      upgradeUntil: nextUpgradeUntil,
      position: item.position,
      resolution: maxResolution,
      mapped: true
    });
    orderedItems.push(cloneItem(item, { enabled: nextEnabled, upgradeUntil: nextUpgradeUntil }));
  }

  const hasLadder = cutoffRow !== undefined && enabledMappedCount > 0;
  const reshapesSiblingArrs = compatibleWithSiblingArr;
  const sharedLadderNote =
    hasLadder && reshapesSiblingArrs
      ? "This profile's quality ladder is shared by every Arr that syncs it; applying this ceiling changes the " +
        'enabled qualities and cutoff for those Arr instances too, not just the target app.'
      : null;

  const ladder: GoalQualityLadder = {
    ceiling,
    cutoff: hasLadder ? cutoffName : null,
    items,
    reshapesSiblingArrs,
    sharedLadderNote
  };

  return { ladderInput: hasLadder ? { orderedItems } : null, ladder };
}
