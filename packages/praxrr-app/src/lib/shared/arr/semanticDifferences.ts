import { type ParityEntity } from './parity.ts';
import { type ArrWorkflowSurface, type ArrAppType } from './capabilities.ts';

// ============================================================================
// CATALOG SCOPE
// ============================================================================

/** A semantic difference belongs to either a parity entity or a workflow surface. */
export type ParityScope = ParityEntity | ArrWorkflowSurface;

// ============================================================================
// CATALOG ENTRY
// ============================================================================

/**
 * One curated, per-`arr_type` fact about same-API-shape/different-domain-semantics
 * divergence. Unlike parity.ts (schema-shape support), these entries are authored
 * prose - the only net-new authored data this module contributes. `apps` names the
 * exact apps the entry applies to; never infer applicability from shared API shape.
 */
export interface ArrSemanticDifference {
  scope: ParityScope;
  apps: ArrAppType[];
  summary: string;
  detail: string;
  suggestion?: string;
  sourceRefs: string[];
}

// ============================================================================
// CATALOG
// ============================================================================

/**
 * Curated semantic-divergence catalog. Each entry's `detail` explains why the
 * divergence exists; `suggestion`, where present, suggests an alternative or
 * mitigation. `sourceRefs` are prose file/symbol anchors for drift audits, not
 * imports - re-verify against the referenced file when editing an entry.
 */
export const ARR_SEMANTIC_DIFFERENCES: ArrSemanticDifference[] = [
  {
    scope: 'quality_definitions',
    apps: ['lidarr'],
    summary: 'Lidarr quality definitions are audio formats, not video resolutions.',
    detail:
      "radarr_quality_definitions and sonarr_quality_definitions carry resolution-based video qualities " +
      "(SDTV, HDTV-720p, Bluray-2160p, ...). lidarr_quality_definitions carry audio formats (MP3-192, FLAC, ...) " +
      "with no resolution axis (resolution: 0). The two are schema-compatible - each app owns a dedicated " +
      "table, so the parity axis reports 'native' for all three - but the values are disjoint: a Lidarr " +
      "quality definition can never represent a video quality tier, and vice versa.",
    suggestion: 'Maintain Lidarr quality definitions independently; do not port Radarr/Sonarr resolution-based tiers.',
    sourceRefs: ['$sync/mappings.ts (QUALITIES)', 'db/migrations/20260216_enforce_native_lidarr_quality_mappings.ts'],
  },
  {
    scope: 'custom_formats',
    apps: ['radarr'],
    summary: '`quality_modifier` custom-format conditions are Radarr-only.',
    detail:
      'The quality_modifier condition type (e.g. REMUX, HYBRID) has no equivalent in the Sonarr or Lidarr APIs; ' +
      'it is unsupported for those apps and skipped during sync rather than translated.',
    suggestion: 'Scope quality_modifier conditions to Radarr; do not expect them to carry over to Sonarr/Lidarr.',
    sourceRefs: ['$sync/customFormats/transformer.ts', '$sync/mappings.ts'],
  },
  {
    scope: 'custom_formats',
    apps: ['sonarr'],
    summary: '`release_type` custom-format conditions are Sonarr-only.',
    detail:
      'release_type (e.g. season-pack detection) is a Sonarr-specific condition type with no Radarr or Lidarr ' +
      'counterpart; other apps ignore or reject it during sync.',
    suggestion: 'Scope release_type conditions to Sonarr; do not expect them to apply on Radarr/Lidarr.',
    sourceRefs: ['$sync/customFormats/transformer.ts', '$sync/mappings.ts'],
  },
  {
    scope: 'custom_formats',
    apps: ['radarr', 'sonarr', 'lidarr'],
    summary: 'Indexer-flag bit values differ per app for the same flag name.',
    detail:
      'The same logical indexer flag (e.g. internal, scene) is encoded with a different bit value per app - ' +
      'internal=32 on Radarr vs 8 on Sonarr/Lidarr; scene=128 on Radarr vs 16 on Sonarr/Lidarr. A custom-format ' +
      "condition authored against one app's raw bit value matches the wrong flag - or nothing - on another app.",
    suggestion: 'Resolve indexer-flag conditions through the per-app mapping table, never a raw bit literal.',
    sourceRefs: ['$sync/mappings.ts (INDEXER_FLAGS)'],
  },
  {
    scope: 'delay_profiles',
    apps: ['radarr', 'sonarr', 'lidarr'],
    summary: 'Delay-profile "default" resolves to a different profile per app.',
    detail:
      'Radarr and Sonarr always write the default delay profile to the fixed id=1. Lidarr has no such fixed id - ' +
      'it resolves the active default at runtime as the untagged profile with the lowest order (falling back to ' +
      "id=1 only when none is found) and merges the existing remote profile's id/order/tags. Applying the same " +
      'PCD delay-profile config can target a different underlying profile on Lidarr than on Radarr/Sonarr.',
    suggestion: 'Verify the resolved Lidarr default delay profile after sync; do not assume id=1 as with Radarr/Sonarr.',
    sourceRefs: ['$sync/delayProfiles/syncer.ts (resolveTargetDelayProfile)'],
  },
  {
    scope: 'metadata_profiles',
    apps: ['lidarr'],
    summary: 'Metadata profiles exist only on Lidarr.',
    detail:
      "Radarr and Sonarr have no metadata-profile concept at all (capabilities.ts sync.metadata_profiles is " +
      'false for both); only Lidarr owns lidarr_metadata_profiles. A metadata-profile PCD entity has no possible ' +
      'target on Radarr/Sonarr - it is unsupported by schema, not merely by value.',
    sourceRefs: ['$shared/arr/capabilities.ts (LIDARR_CAPABILITIES.sync.metadata_profiles)', '$db/queries/arrSync.ts'],
  },
  {
    scope: 'upgrades',
    apps: ['radarr'],
    summary: 'Automated upgrade searches run only on Radarr.',
    detail:
      'The upgrade-search workflow (capabilities.ts workflows.upgrades) is enabled only for Radarr; Sonarr and ' +
      'Lidarr both have upgrades: false and never receive automated upgrade-search jobs, regardless of PCD ' +
      'scoring configuration.',
    suggestion: 'Do not schedule or expect automated upgrade searches for Sonarr- or Lidarr-scoped databases.',
    sourceRefs: ['$shared/arr/capabilities.ts (workflows.upgrades)', '$lib/server/upgrades/processor.ts'],
  },
  {
    scope: 'rename',
    apps: ['radarr', 'sonarr'],
    summary: 'The rename workflow is unsupported on Lidarr.',
    detail:
      'capabilities.ts marks workflows.rename true for Radarr and Sonarr but false for Lidarr; the rename ' +
      'processor has no Lidarr code path. This entry lists the apps that DO support rename - Lidarr is the ' +
      'outlier lacking it.',
    sourceRefs: ['$shared/arr/capabilities.ts (workflows.rename)', '$lib/server/rename/'],
  },
];
