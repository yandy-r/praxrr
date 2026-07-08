/**
 * Pure, client-safe Arr version-compatibility resolver.
 *
 * Layers a version dimension on top of the static per-app capability matrix in
 * `capabilities.ts` (which is NOT modified). Given an `arr_type` and a detected
 * application version, it classifies a coarse support tier and resolves each
 * feature to `available | degraded | unavailable` — the base capability acting
 * as a hard floor (a base-false feature can never be upgraded by version).
 *
 * The version axis is authored DATA (`ARR_SUPPORT_RANGES`), mirroring the
 * `parity.ts` shape: authored const + pure predicate + compile-time
 * non-regression check. No per-`(arr_type, version)` client subclasses exist —
 * every current Arr app still serves `/api/v3/`, so the adapter seam is the
 * existing `arr_type` client factory plus this data table.
 *
 * Imports only `$shared` modules so it is safe in server and client bundles.
 */
import {
  ARR_SYNC_SURFACES,
  ARR_WORKFLOW_SURFACES,
  type ArrAppType,
  type ArrFeature,
  isArrAppType,
  supportsFeature,
} from './capabilities.ts';
import { compareArrVersionToBoundary, parseArrVersion } from './version.ts';

// ============================================================================
// TIERS & RESULT TYPES
// ============================================================================

/** Coarse support tier for a detected `(arr_type, version)` pair. */
export type ArrSupportTier = 'supported' | 'degraded' | 'unsupported' | 'unknown';

/** Structured reason codes layered on the coarse tier (drive UI messaging). */
export type ArrCompatibilityWarningCode =
  | 'not_detected'
  | 'unparseable'
  | 'unknown_arr_type'
  | 'below_minimum'
  | 'below_recommended'
  | 'eol'
  | 'untested_newer'
  | 'untested_major';

export interface ArrCompatibilityWarning {
  code: ArrCompatibilityWarningCode;
  message: string;
  docsHref?: string;
}

/** Resolved availability of a single feature under a detected version. */
export type FeatureAvailabilityStatus = 'available' | 'degraded' | 'unavailable';

export interface ArrFeatureAvailability {
  feature: ArrFeature;
  status: FeatureAvailabilityStatus;
  reason: string;
}

/**
 * Authored per-app version policy. All boundaries are `major.minor.patch.build`
 * strings. `breakingAtOrAbove` is intentionally UNDEFINED for every app today —
 * it is the clean seam for a future breaking major (e.g. a re-pathed Sonarr v5)
 * without pre-inventing a cutoff that does not exist.
 */
export interface ArrSupportRange {
  /** `v < this` → `unsupported` (below_minimum). */
  minimumSupported: string;
  /** `v < this` → `degraded` (below_recommended). */
  minimumRecommended?: string;
  /** `v > this` → still `supported`, with an `untested_newer` info warning. */
  latestTested: string;
  /** `v <= this` → `degraded` (eol / migration advisory). */
  eolBelow?: string;
  /** `v >= this` → `unsupported` (untested_major). UNDEFINED today. */
  breakingAtOrAbove?: string;
  /** Features gated to `degraded` only when the tier is `degraded`. */
  degradedFeatures?: ArrFeature[];
  /** Extra advisory copy surfaced with an `eol` warning. */
  eolNote?: string;
  /** Docs link surfaced with warnings. */
  docsHref?: string;
}

/** Full resolved compatibility for an `(arr_type, version)` pair. */
export interface ArrCompatibilityResult {
  /** Echoed input; may be a value outside `ArrAppType` (e.g. `chaptarr`). */
  arrType: string;
  detectedVersion: string | null;
  tier: ArrSupportTier;
  features: ArrFeatureAvailability[];
  /** Features whose resolved status is `unavailable`. */
  disabledFeatures: ArrFeature[];
  warnings: ArrCompatibilityWarning[];
  /** Present only when `arrType` is a known `ArrAppType`. */
  range?: ArrSupportRange;
}

// ============================================================================
// AUTHORED DATA (the only hand-maintained policy layer)
// ============================================================================

/**
 * Conservative seed ranges. Boundary values are maintainer policy (flagged in
 * the design's open questions) — tune without code changes; the resolver is
 * data-driven. Every `breakingAtOrAbove` is deliberately undefined.
 */
export const ARR_SUPPORT_RANGES: Record<ArrAppType, ArrSupportRange> = {
  radarr: {
    minimumSupported: '4.0.0.0',
    minimumRecommended: '5.0.0.0',
    latestTested: '5.14.0.9383',
    docsHref: 'https://wiki.servarr.com/radarr',
  },
  sonarr: {
    minimumSupported: '3.0.0.0',
    minimumRecommended: '4.0.0.0',
    latestTested: '4.0.15.2941',
    docsHref: 'https://wiki.servarr.com/sonarr',
  },
  lidarr: {
    minimumSupported: '2.0.0.0',
    latestTested: '2.9.6.4552',
    docsHref: 'https://wiki.servarr.com/lidarr',
  },
};

/** All feature surfaces, workflow then sync, in declared order. */
export const ARR_FEATURES: readonly ArrFeature[] = [...ARR_WORKFLOW_SURFACES, ...ARR_SYNC_SURFACES];

const SYNC_SURFACE_SET: ReadonlySet<string> = new Set(ARR_SYNC_SURFACES);

/**
 * Compile-time-pinned golden verdicts (mirrors `PARITY_NON_REGRESSION_CHECK`).
 * The runtime resolver is asserted against this table in the resolver tests, so
 * a boundary edit that silently reclassifies a pinned version fails the suite.
 */
export const ARR_SUPPORT_NON_REGRESSION_CHECK = {
  'radarr@5.14.0.9383': 'supported',
  'radarr@5.0.0.0': 'supported',
  'radarr@4.7.5.0': 'degraded',
  'radarr@3.2.2.0': 'unsupported',
  'sonarr@4.0.15.2941': 'supported',
  'sonarr@3.0.10.0': 'degraded',
  'sonarr@2.0.0.0': 'unsupported',
  'lidarr@2.9.6.4552': 'supported',
  'lidarr@2.0.0.0': 'supported',
  'lidarr@1.9.9.9': 'unsupported',
} as const satisfies Record<string, ArrSupportTier>;

// ============================================================================
// WARNINGS
// ============================================================================

const WARNING_MESSAGES: Record<ArrCompatibilityWarningCode, string> = {
  not_detected: 'Application version has not been detected yet.',
  unparseable: 'Reported application version could not be understood.',
  unknown_arr_type: 'Version compatibility is not tracked for this application type.',
  below_minimum: 'This version is below the minimum supported release; sync features may fail.',
  below_recommended: 'This version is older than the recommended release; consider upgrading.',
  eol: 'This version has reached end of support; plan a migration to a supported release.',
  untested_newer: 'This version is newer than the latest tested release; behavior is assumed compatible.',
  untested_major: 'This major version has known or expected breaking API changes and is not supported.',
};

function buildWarning(code: ArrCompatibilityWarningCode, range?: ArrSupportRange): ArrCompatibilityWarning {
  const base = WARNING_MESSAGES[code];
  const message = code === 'eol' && range?.eolNote ? `${base} ${range.eolNote}` : base;
  return range?.docsHref ? { code, message, docsHref: range.docsHref } : { code, message };
}

// ============================================================================
// CLASSIFICATION
// ============================================================================

interface Classification {
  tier: ArrSupportTier;
  warnings: ArrCompatibilityWarning[];
}

/**
 * Classify a raw version against an explicit range. Exported so every branch
 * (eol, breaking, below-recommended, untested-newer) is unit-testable with
 * synthetic ranges, independent of the authored seed values.
 *
 * Order: breaking → below-minimum → eol → below-recommended → untested-newer →
 * supported. Fail-soft: an unparseable/absent version yields the `unknown` tier.
 */
export function classifyArrVersion(range: ArrSupportRange, rawVersion: string | null | undefined): Classification {
  const parsed = parseArrVersion(rawVersion);
  if (!parsed) {
    const code: ArrCompatibilityWarningCode =
      rawVersion == null || rawVersion.trim() === '' ? 'not_detected' : 'unparseable';
    return { tier: 'unknown', warnings: [buildWarning(code, range)] };
  }

  if (range.breakingAtOrAbove) {
    const cmp = compareArrVersionToBoundary(parsed, range.breakingAtOrAbove);
    if (cmp !== null && cmp >= 0) return { tier: 'unsupported', warnings: [buildWarning('untested_major', range)] };
  }

  const belowMinimum = compareArrVersionToBoundary(parsed, range.minimumSupported);
  if (belowMinimum !== null && belowMinimum < 0) {
    return { tier: 'unsupported', warnings: [buildWarning('below_minimum', range)] };
  }

  if (range.eolBelow) {
    const cmp = compareArrVersionToBoundary(parsed, range.eolBelow);
    if (cmp !== null && cmp <= 0) return { tier: 'degraded', warnings: [buildWarning('eol', range)] };
  }

  if (range.minimumRecommended) {
    const cmp = compareArrVersionToBoundary(parsed, range.minimumRecommended);
    if (cmp !== null && cmp < 0) return { tier: 'degraded', warnings: [buildWarning('below_recommended', range)] };
  }

  const newerThanTested = compareArrVersionToBoundary(parsed, range.latestTested);
  if (newerThanTested !== null && newerThanTested > 0) {
    return { tier: 'supported', warnings: [buildWarning('untested_newer', range)] };
  }

  return { tier: 'supported', warnings: [] };
}

// ============================================================================
// FEATURE RESOLUTION (base capability is a hard floor)
// ============================================================================

function resolveFeatureAtTier(
  arrType: ArrAppType,
  feature: ArrFeature,
  tier: ArrSupportTier,
  range: ArrSupportRange
): ArrFeatureAvailability {
  if (!supportsFeature(arrType, feature)) {
    return { feature, status: 'unavailable', reason: 'base_unsupported' };
  }

  switch (tier) {
    case 'supported':
      return { feature, status: 'available', reason: 'supported' };
    case 'degraded':
      return range.degradedFeatures?.includes(feature)
        ? { feature, status: 'degraded', reason: 'version_degraded' }
        : { feature, status: 'available', reason: 'supported' };
    case 'unsupported':
      // Sync surfaces are write-heavy → withheld; workflow reads stay usable but flagged.
      return SYNC_SURFACE_SET.has(feature)
        ? { feature, status: 'unavailable', reason: 'version_unsupported' }
        : { feature, status: 'degraded', reason: 'version_unsupported' };
    case 'unknown':
      // Optimistic passthrough: every current app serves /api/v3/, so an
      // undetected version must never withhold or degrade an otherwise-supported
      // feature. Uncertainty is surfaced at the tier/warning level instead.
      return { feature, status: 'available', reason: 'version_unknown' };
  }
}

/**
 * Resolve a single feature's availability. Safe for any string `arrType`: a
 * value outside `ArrAppType` passes through as `available` (its capability model
 * is unknown, so we never block it).
 */
export function resolveArrCapability(
  arrType: string,
  feature: ArrFeature,
  rawVersion: string | null | undefined
): ArrFeatureAvailability {
  if (!isArrAppType(arrType)) {
    return { feature, status: 'available', reason: 'unknown_arr_type' };
  }
  const range = ARR_SUPPORT_RANGES[arrType];
  const { tier } = classifyArrVersion(range, rawVersion);
  return resolveFeatureAtTier(arrType, feature, tier, range);
}

/**
 * Resolve full compatibility for an `(arr_type, version)` pair. A value outside
 * `ArrAppType` yields the `unknown` tier with an `unknown_arr_type` warning and
 * no feature verdicts (its capability model is not tracked).
 */
export function resolveArrCompatibility(
  arrType: string,
  rawVersion: string | null | undefined
): ArrCompatibilityResult {
  const detectedVersion = rawVersion && rawVersion.trim() !== '' ? rawVersion : null;

  if (!isArrAppType(arrType)) {
    return {
      arrType,
      detectedVersion,
      tier: 'unknown',
      features: [],
      disabledFeatures: [],
      warnings: [buildWarning('unknown_arr_type')],
    };
  }

  const range = ARR_SUPPORT_RANGES[arrType];
  const { tier, warnings } = classifyArrVersion(range, rawVersion);
  const features = ARR_FEATURES.map((feature) => resolveFeatureAtTier(arrType, feature, tier, range));
  const disabledFeatures = features.filter((entry) => entry.status === 'unavailable').map((entry) => entry.feature);

  return { arrType, detectedVersion, tier, features, disabledFeatures, warnings, range };
}

// ============================================================================
// STATIC MATRIX (published feature × version compatibility, requirement #4)
// ============================================================================

const ALL_TIERS: readonly ArrSupportTier[] = ['supported', 'degraded', 'unsupported', 'unknown'];

export interface VersionSupportedFeature {
  feature: ArrFeature;
  tiers: Record<ArrSupportTier, FeatureAvailabilityStatus>;
}

export interface ArrVersionCompatibility {
  arrType: ArrAppType;
  range: ArrSupportRange;
  features: VersionSupportedFeature[];
}

export interface VersionCompatibilityMatrix {
  apps: ArrVersionCompatibility[];
}

/**
 * Build the static feature × version-tier compatibility matrix across all known
 * Arr apps. Pure and deterministic — the API route caches a single instance.
 */
export function buildVersionCompatibilityMatrix(): VersionCompatibilityMatrix {
  const apps = (Object.keys(ARR_SUPPORT_RANGES) as ArrAppType[]).map((arrType) => {
    const range = ARR_SUPPORT_RANGES[arrType];
    const features = ARR_FEATURES.map((feature) => {
      const tiers = Object.fromEntries(
        ALL_TIERS.map((tier) => [tier, resolveFeatureAtTier(arrType, feature, tier, range).status])
      ) as Record<ArrSupportTier, FeatureAvailabilityStatus>;
      return { feature, tiers };
    });
    return { arrType, range, features };
  });

  return { apps };
}
