/**
 * Config Health Scoring — pure engine contracts (issue #22).
 *
 * Pure, versioned contracts for the config-health scoring engine. This module holds only types,
 * enumerations, and the single version constant — no logic, no I/O, no runtime/DB imports (the sole
 * exception is a type-only import of {@link NarrationLine}, the shape suggestions render as). It is
 * therefore safe to import from client and server alike, mirroring the `$shared/goals` and
 * `$shared/narration` precedents.
 *
 * The engine turns fully-materialized facts about one Arr instance (drift status, per-profile
 * completeness/coherence/compatibility signals) into a deterministic 0–100 {@link HealthReport}. It
 * is read-only: unlike goals it emits no scoring input and never becomes a parallel scoring system.
 */

import type { NarrationLine } from '$shared/narration/index.ts';

/**
 * Stamped onto every {@link HealthReport} and persisted snapshot. Bump whenever the criteria set,
 * the band thresholds, the per-criterion score formulas, or the rollup math change, so a client can
 * detect that a stored snapshot was produced by a different engine generation. Declared here ONCE.
 *
 * Bumped `1 -> 2` for issue #225: the `trash_alignment` per-criterion formula changed from a
 * constant `null` stub to a real, evidence-based scorer.
 */
export const CONFIG_HEALTH_ENGINE_VERSION = '2';

/** Arr apps the engine scores. Matches `SyncPreviewArrType`; the gatherer narrows the loose column. */
export type HealthArrType = 'radarr' | 'sonarr' | 'lidarr';

/**
 * Closed, versioned set of scoring criteria. Adding/removing/renaming a member is a breaking change —
 * bump {@link CONFIG_HEALTH_ENGINE_VERSION}. `trash_alignment` is registered but disabled in Phase 1.
 */
export type CriterionId = 'completeness' | 'drift' | 'coherence' | 'compatibility' | 'trash_alignment';

/** Every criterion id, in stable display order. */
export const CRITERION_IDS: readonly CriterionId[] = [
  'completeness',
  'drift',
  'coherence',
  'compatibility',
  'trash_alignment',
] as const;

/** A criterion sub-score in `[0, 100]`, or `null` when it cannot be evaluated (skipped, NOT scored 0). */
export type SubScore = number | null;

/** Health band derived from the 0–100 rollup. `unknown` means every enabled criterion was skipped. */
export type HealthBand = 'healthy' | 'attention' | 'needs-review' | 'unknown';

/** Static catalog metadata for one criterion, served by the settings endpoint so the client hardcodes nothing. */
export interface CriterionMeta {
  readonly id: CriterionId;
  readonly label: string;
  readonly description: string;
}

/** Per-criterion configuration from the settings singleton: whether it participates, and its relative weight. */
export interface CriterionConfig {
  readonly id: CriterionId;
  readonly enabled: boolean;
  /** Relative weight (>= 0); normalized across the enabled+scored criteria in the rollup. */
  readonly weight: number;
}

/** What a criterion emits for one scope: a sub-score, machine-facing facts, and non-judgmental suggestions. */
export interface CriterionResult {
  readonly id: CriterionId;
  readonly label: string;
  /** `null` => "not evaluated" (skipped, excluded from the weighted mean — never treated as 0). */
  readonly score: SubScore;
  /** The relative weight this criterion carried (0 when disabled/absent). */
  readonly weight: number;
  /** Integer points this criterion contributed to the scope's 0–100 total. Contributions sum EXACTLY to the total. */
  readonly contribution: number;
  /** Machine-facing bullet facts (counts etc.) for the detail surface. */
  readonly detail: readonly string[];
  /** Remediation lines; tone capped at `warning` (health informs, never shames). */
  readonly suggestions: readonly NarrationLine[];
}

/** Profile-independent facts about one custom format's effective score for the scoped arr_type. */
export interface HealthCfScore {
  readonly name: string;
  /** Effective score, or `null` when the custom format is unassigned for this arr_type. */
  readonly score: number | null;
}

/** The three quality-profile thresholds; `null` fields mean "no upgrade target configured". */
export interface HealthThresholds {
  readonly minimumScore: number;
  readonly upgradeUntilScore: number | null;
  readonly upgradeScoreIncrement: number | null;
}

/** One quality profile's already-read facts. Materialized by the gatherer; the engine touches no DB. */
export interface ProfileFacts {
  readonly name: string;
  readonly arrType: HealthArrType;
  /**
   * From `computeCompatibleProfileNames` (enabled-quality mapping) — NEVER an `arr_type='all'` fold.
   * `null` when compatibility could not be determined (unbuilt cache / read error); the compatibility
   * criterion then SKIPS this profile (null) rather than scoring a real "incompatible" value.
   */
  readonly compatible: boolean | null;
  readonly enabledQualityCount: number;
  readonly hasCutoff: boolean;
  /** Count of custom formats with a non-null effective score for this arr_type. */
  readonly assignedCfCount: number;
  /** Custom-format population for this arr_type (the completeness denominator ceiling). */
  readonly totalCfCount: number;
  /** Recommended custom formats to assign; Phase 1 == totalCfCount (no curated TRaSH set yet). */
  readonly recommendedCfCount: number;
  /** `null` when the profile's scoring row could not be read (coherence then skips, not scores 0). */
  readonly thresholds: HealthThresholds | null;
  readonly cfScores: readonly HealthCfScore[];
}

/** The drift signal for this instance, sourced from `driftStatusQueries.getById` (no recompute). */
export interface DriftFacts {
  readonly status: 'in-sync' | 'drifted' | 'unreachable' | 'unauthorized' | 'error' | 'never-checked';
  readonly reason: string | null;
  readonly drifted: number;
  readonly missing: number;
  /** Unmanaged (extra-on-Arr) entities — informational only; never lowers the drift sub-score. */
  readonly unmanaged: number;
  readonly checkedAt: string | null;
  /** Freshest successful content diff; `null` => counts are not from a fresh check (drift then skips). */
  readonly contentCheckedAt: string | null;
}

/** Fully-materialized engine input. Nothing here is read lazily — the engine performs no I/O. */
export interface HealthInputs {
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: HealthArrType;
  readonly detectedVersion: string | null;
  /** Whether `detectedVersion` resolves to a supported tier; `null` when undetected/unknown. */
  readonly versionSupported: boolean | null;
  readonly drift: DriftFacts;
  readonly profiles: readonly ProfileFacts[];
  /**
   * Instance-level TRaSH reference set for `trash_alignment`: DISTINCT, original-case names of the
   * instance's OWN opted-in TRaSH `customFormats` selections (local app-DB read, arr-matched, NO
   * remote fetch). Instance-level like {@link drift}, NOT on {@link ProfileFacts}. `null` when
   * unmeasurable — arr not TRaSH-supported (lidarr), no opted-in selections, or a read error. The
   * `trash_alignment` criterion treats both `null` AND `[]` as unmeasurable (skip) so its
   * `100 * aligned / |R|` is divide-by-zero-safe regardless of which constructor built these inputs.
   */
  readonly trashRecommendedCfNames: readonly string[] | null;
  /** Per-criterion enable/weight config from settings (drives which criteria the engine runs). */
  readonly criteria: readonly CriterionConfig[];
  /** ISO-8601 UTC timestamp passed IN — the engine never calls `Date.now()`/`new Date()`. */
  readonly nowIso: string;
}

/** Scope selector: the whole instance, or one named quality profile. */
export type HealthScope = { readonly kind: 'instance' } | { readonly kind: 'profile'; readonly profileName: string };

/** The pure contract every criterion implements. Order-invariant, no I/O, no `Date`/`Math.random`. */
export interface Criterion {
  readonly id: CriterionId;
  readonly label: string;
  score(inputs: HealthInputs, scope: HealthScope, config: CriterionConfig): CriterionResult;
}

/** A scored unit (instance-wide or one profile): the rollup number, its band, and the breakdown. */
export interface ScoredUnit {
  readonly score: number;
  readonly band: HealthBand;
  readonly criteria: readonly CriterionResult[];
  /** Flattened, de-duped, severity-sorted suggestions across all criteria in this scope. */
  readonly suggestions: readonly NarrationLine[];
}

/** One profile's scored unit, carrying its name. */
export interface ProfileHealth extends ScoredUnit {
  readonly name: string;
}

/** The engine's deterministic output for one instance. Identical input yields deep-equal output. */
export interface HealthReport {
  readonly engineVersion: string;
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: HealthArrType;
  /** === `inputs.nowIso`. */
  readonly generatedAt: string;
  readonly overall: ScoredUnit;
  readonly profiles: readonly ProfileHealth[];
}
