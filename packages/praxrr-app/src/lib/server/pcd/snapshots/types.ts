/**
 * PCD Snapshot Types
 * Type definitions for the PCD state snapshot system
 */

// ============================================================================
// ENUM TYPES
// ============================================================================

/**
 * Whether a snapshot was created automatically or by the user
 */
export type SnapshotType = 'auto' | 'manual';

/**
 * What event triggered the snapshot creation
 * - pull: before a PCD repository pull/refresh
 * - sync: before an Arr instance sync
 * - manual: user-initiated via API
 */
export type SnapshotTrigger = 'pull' | 'sync' | 'manual';

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating an automatic (pre-risk) snapshot
 */
export interface CreateAutoSnapshotInput {
  /** The database instance to snapshot */
  databaseId: number;
  /** The event trigger (auto snapshots exclude 'manual') */
  trigger: Exclude<SnapshotTrigger, 'manual'>;
  /** Optional target Arr instance IDs for sync context */
  targetInstanceIds?: number[] | null;
}

/**
 * Input for creating a manual snapshot via API
 */
export interface CreateManualSnapshotInput {
  /** The database instance to snapshot */
  databaseId: number;
  /** Optional user-provided description */
  description?: string;
}

// ============================================================================
// DB ROW TYPE (snake_case)
// ============================================================================

/**
 * Raw database row shape for the pcd_snapshots table
 */
export interface PcdSnapshotRow {
  id: number;
  database_id: number;
  type: SnapshotType;
  trigger: SnapshotTrigger;
  description: string | null;
  ops_sequence_max_id: number;
  ops_count_base: number;
  ops_count_user: number;
  cache_state_hash: string | null;
  target_instance_ids: string | null;
  created_at: string;
}

// ============================================================================
// API RESPONSE TYPES (camelCase)
// ============================================================================

/**
 * CamelCase API response shape for a single snapshot
 */
export interface PcdSnapshotDetail {
  id: number;
  databaseId: number;
  type: SnapshotType;
  trigger: SnapshotTrigger;
  description: string | null;
  opsSequenceMaxId: number;
  opsCountBase: number;
  opsCountUser: number;
  cacheStateHash: string | null;
  /** Parsed from JSON string in DB */
  targetInstanceIds: number[] | null;
  createdAt: string;
}

/**
 * Extended snapshot detail with computed restore context fields
 */
export interface PcdSnapshotFullDetail extends PcdSnapshotDetail {
  /** Number of ops written after this snapshot was taken */
  opsWrittenSince: number;
  /**
   * Whether this snapshot can theoretically be restored.
   * Restore support is intentionally disabled in this milestone; this remains
   * false for all snapshots.
   */
  isRestorable: boolean;
}

/**
 * Paginated list response for snapshots
 */
export interface PcdSnapshotListResponse {
  snapshots: PcdSnapshotDetail[];
  total: number;
}

// ============================================================================
// QUERY OPTION TYPES
// ============================================================================

/**
 * Options for filtering and paginating snapshot list queries
 */
export interface PcdSnapshotListOptions {
  /** Filter by snapshot type */
  type?: SnapshotType;
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip */
  offset?: number;
}
