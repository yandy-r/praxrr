/**
 * Home dashboard (`/`) contract shared by the server loader and the client page (YAN-589).
 *
 * Every section is independently optional: a failing or unavailable source degrades to `null`
 * (or an empty list) so the page always renders.
 */

/** Arr types that support sync/drift/health (mirrors `SyncPreviewArrType`). */
export type DashboardArrType = 'radarr' | 'sonarr' | 'lidarr';

export type DashboardHealthBand = 'healthy' | 'attention' | 'needs-review' | 'unknown';

export type DashboardDriftStatus = 'in-sync' | 'drifted' | 'unreachable' | 'unauthorized' | 'error' | 'never-checked';

export type DashboardDriftSuppression = 'none' | 'acknowledged' | 'snoozed' | 'partially_acknowledged';

export type DashboardSyncStatus = 'success' | 'partial' | 'failed' | 'skipped';

export type DashboardShieldBand = 'hardened' | 'guarded' | 'exposed' | 'unknown';

/** Latest stored Config Health snapshot for an instance (never recomputed live on `/`). */
export interface DashboardInstanceHealth {
  score: number;
  band: DashboardHealthBand;
  generatedAt: string;
}

export interface DashboardInstanceDrift {
  status: DashboardDriftStatus;
  /** Total drifted + missing + unmanaged + prune entity changes from the last check. */
  changeCount: number;
  suppression: DashboardDriftSuppression;
  checkedAt: string | null;
}

export interface DashboardInstanceLastSync {
  historyId: number;
  status: DashboardSyncStatus;
  startedAt: string;
  finishedAt: string | null;
}

/** One card per enabled, sync-capable Arr instance. */
export interface DashboardInstanceCard {
  id: number;
  name: string;
  arrType: DashboardArrType;
  health: DashboardInstanceHealth | null;
  drift: DashboardInstanceDrift;
  lastSync: DashboardInstanceLastSync | null;
  /** True when drift/health/sync suggest the user should look at this instance. */
  needsAttention: boolean;
  links: {
    instance: string; // /arr/{id}
    previewSync: string; // /arr/{id}/sync
    drift: string; // /drift/{id}
    health: string; // /config-health/{id}
    syncHistory: string; // /sync-history?instanceId={id}
  };
}

export interface DashboardRecentSync {
  historyId: number;
  instanceId: number | null;
  instanceName: string;
  arrType: DashboardArrType;
  status: DashboardSyncStatus;
  startedAt: string;
  finishedAt: string | null;
  href: string; // /sync-history/{historyId}
}

export interface DashboardCanaryRollout {
  id: number;
  arrType: DashboardArrType;
  status: 'canary_running' | 'awaiting_confirmation' | 'rolling_out';
  canaryInstanceName: string;
  startedAt: string;
  href: string; // /canary/{id}
}

export interface DashboardDatabaseConflicts {
  databaseId: number;
  databaseName: string;
  count: number;
  href: string; // /databases/{id}/conflicts
}

export interface DashboardDriftTotals {
  instances: number;
  inSync: number;
  drifted: number;
  unreachable: number;
  unauthorized: number;
  error: number;
  neverChecked: number;
}

/**
 * Data sources that can fail independently. A failed source degrades its section (empty/null/zero)
 * and is listed in `HomeDashboardData.degraded`. Parser unavailability is a real result
 * (`parser.available === false`), not a degradation, so `parser` is intentionally absent.
 */
export type DashboardSource =
  'instances' | 'drift' | 'health' | 'lastSync' | 'recentSyncs' | 'conflicts' | 'canary' | 'security';

/**
 * Server-computed attention counts, using the same predicates as the per-card `needsAttention`
 * flag and the nav badges, so the summary, the cards and the badges cannot disagree.
 */
export interface DashboardAttention {
  /** Instances with a degraded drift status (drifted/unreachable/unauthorized/error), not acknowledged/snoozed. */
  driftInstances: number;
  /** Instances whose latest stored health band is `attention` or `needs-review`. */
  healthInstances: number;
  /** Instances whose latest sync was `failed` or `partial`. */
  failedSyncInstances: number;
}

export interface HomeDashboardData {
  generatedAt: string;
  /** Sources that failed and were replaced by empty/null/zero values (deduplicated). */
  degraded: DashboardSource[];
  attention: DashboardAttention;
  instances: DashboardInstanceCard[];
  drift: DashboardDriftTotals;
  /** Databases with at least one conflicted op; `total` sums them. */
  conflicts: { total: number; databases: DashboardDatabaseConflicts[] };
  /** Non-terminal canary rollouts only. */
  canary: DashboardCanaryRollout[];
  /** Most recent sync-history rows (newest first, up to 5). */
  recentSyncs: DashboardRecentSync[];
  /** `null` when the posture could not be computed. */
  security: { score: number; band: DashboardShieldBand } | null;
  parser: { available: boolean };
  /** Number of linked PCD databases (drives the empty state). */
  databaseCount: number;
}
