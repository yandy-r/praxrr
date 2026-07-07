/**
 * Resolved Config Types
 *
 * Shared type surface for the read-only `pcd/resolved/*` service: which entity types
 * exist, whether they are arr-agnostic or per-arr-app, which cache "layer" a read
 * targets, and the reader-function shape the dispatch tables in readers.ts are built
 * from.
 */

import type { PCDCache } from '$pcd/index.ts';
import type {
  PortableCustomFormat,
  PortableDelayProfile,
  PortableLidarrMediaSettings,
  PortableLidarrMetadataProfile,
  PortableLidarrNaming,
  PortableLidarrQualityDefinitions,
  PortableMediaSettings,
  PortableQualityDefinitions,
  PortableQualityProfile,
  PortableRadarrNaming,
  PortableRegularExpression,
  PortableSonarrNaming,
} from '$shared/pcd/portable.ts';

// ============================================================================
// ENTITY TYPES
// ============================================================================

/** Entity types with a single shared shape regardless of arr_type. */
export type ArrAgnosticEntityType = 'delayProfile' | 'regularExpression' | 'customFormat' | 'qualityProfile';

/** Entity types with a distinct cache table + serializer per arr_type. */
export type PerArrEntityType = 'naming' | 'mediaSettings' | 'qualityDefinitions' | 'lidarrMetadataProfile';

/** All resolved-config entity types the readers dispatch table understands. */
export type ResolvedEntityType = ArrAgnosticEntityType | PerArrEntityType;

// ============================================================================
// LAYERS
// ============================================================================

/** Which PCD op layer(s) a resolved read is scoped to. */
export type ResolvedLayer = 'base' | 'user' | 'resolved';

// ============================================================================
// READER FUNCTIONS
// ============================================================================

/** Union of every Portable* payload shape a resolved-config reader can return. */
export type ResolvedEntityPayload =
  | PortableDelayProfile
  | PortableRegularExpression
  | PortableCustomFormat
  | PortableQualityProfile
  | PortableRadarrNaming
  | PortableSonarrNaming
  | PortableLidarrNaming
  | PortableMediaSettings
  | PortableLidarrMediaSettings
  | PortableQualityDefinitions
  | PortableLidarrQualityDefinitions
  | PortableLidarrMetadataProfile;

/** Shape shared by every `serialize*` function in `pcd/entities/serialize.ts`. */
export type ResolvedReaderFn = (cache: PCDCache, name: string) => Promise<ResolvedEntityPayload>;
