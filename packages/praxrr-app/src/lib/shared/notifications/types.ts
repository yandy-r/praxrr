/**
 * Shared notification types for both backend and frontend
 * Defines all available notification types and their metadata
 */

export interface NotificationType {
  id: string;
  label: string;
  category: string;
  description?: string;
}

/**
 * All available notification types
 */
export const notificationTypes: NotificationType[] = [
  // Backups
  {
    id: 'job.create_backup.success',
    label: 'Backup Created (Success)',
    category: 'Backups',
    description: 'Notification when a backup is created successfully',
  },
  {
    id: 'job.create_backup.failed',
    label: 'Backup Created (Failed)',
    category: 'Backups',
    description: 'Notification when backup creation fails',
  },
  {
    id: 'job.cleanup_backups.success',
    label: 'Backup Cleanup (Success)',
    category: 'Backups',
    description: 'Notification when old backups are cleaned up successfully',
  },
  {
    id: 'job.cleanup_backups.failed',
    label: 'Backup Cleanup (Failed)',
    category: 'Backups',
    description: 'Notification when backup cleanup fails',
  },

  // Logs
  {
    id: 'job.cleanup_logs.success',
    label: 'Log Cleanup (Success)',
    category: 'Logs',
    description: 'Notification when old logs are cleaned up successfully',
  },
  {
    id: 'job.cleanup_logs.failed',
    label: 'Log Cleanup (Failed)',
    category: 'Logs',
    description: 'Notification when log cleanup fails',
  },

  // Database Sync
  {
    id: 'pcd.linked',
    label: 'Database Linked',
    category: 'Databases',
    description: 'Notification when a new database is linked',
  },
  {
    id: 'pcd.unlinked',
    label: 'Database Unlinked',
    category: 'Databases',
    description: 'Notification when a database is removed',
  },
  {
    id: 'pcd.updates_available',
    label: 'Database Updates Available',
    category: 'Databases',
    description: 'Notification when database updates are available but auto-pull is disabled',
  },
  {
    id: 'pcd.sync_success',
    label: 'Database Synced (Success)',
    category: 'Databases',
    description: 'Notification when a database is synced successfully',
  },
  {
    id: 'pcd.sync_failed',
    label: 'Database Sync (Failed)',
    category: 'Databases',
    description: 'Notification when database sync fails',
  },

  // Upgrades
  {
    id: 'upgrade.success',
    label: 'Upgrade Completed (Success)',
    category: 'Upgrades',
    description: 'Notification when all upgrade searches complete successfully',
  },
  {
    id: 'upgrade.partial',
    label: 'Upgrade Completed (Partial)',
    category: 'Upgrades',
    description: 'Notification when some upgrade searches succeed and some fail',
  },
  {
    id: 'upgrade.failed',
    label: 'Upgrade Failed',
    category: 'Upgrades',
    description: 'Notification when all upgrade searches fail',
  },

  // Renames
  {
    id: 'rename.success',
    label: 'Rename Completed (Success)',
    category: 'Renames',
    description: 'Notification when all file renames complete successfully',
  },
  {
    id: 'rename.partial',
    label: 'Rename Completed (Partial)',
    category: 'Renames',
    description: 'Notification when some file renames succeed and some fail',
  },
  {
    id: 'rename.failed',
    label: 'Rename Failed',
    category: 'Renames',
    description: 'Notification when all file renames fail',
  },

  // Drift
  {
    id: 'drift.detected',
    label: 'Drift Detected',
    category: 'Drift',
    description: 'Notification when an Arr instance diverges from its desired configuration',
  },

  // Config Health
  {
    id: 'health.degraded',
    label: 'Config Health Decreased',
    category: 'Config Health',
    description: 'Notification when Config Health records a meaningful decrease for an Arr instance',
  },

  // Sync (Arr push sync — audit trail)
  {
    id: 'sync.failed',
    label: 'Sync Failed',
    category: 'Sync',
    description: 'Notification when an Arr sync run fails entirely',
  },
  {
    id: 'sync.partial',
    label: 'Sync Completed (Partial)',
    category: 'Sync',
    description: 'Notification when an Arr sync run partially fails (some sections synced, some failed)',
  },

  // Canary (blast-radius safety)
  {
    id: 'canary.failed',
    label: 'Canary Failed',
    category: 'Canary',
    description: 'Notification when a canary sync fails and its rollout is aborted before touching remaining instances',
  },
  {
    id: 'canary.promoted',
    label: 'Canary Promoted',
    category: 'Canary',
    description: 'Notification when a canary is promoted and the rollout proceeds to the remaining instances',
  },
];

/**
 * Group notification types by category
 */
export function groupNotificationTypesByCategory(): Record<string, NotificationType[]> {
  return notificationTypes.reduce(
    (acc, type) => {
      if (!acc[type.category]) {
        acc[type.category] = [];
      }
      acc[type.category].push(type);
      return acc;
    },
    {} as Record<string, NotificationType[]>
  );
}

/**
 * Get all notification type IDs
 */
export function getAllNotificationTypeIds(): string[] {
  return notificationTypes.map((type) => type.id);
}

/**
 * Validate if a notification type ID exists
 */
export function isValidNotificationType(typeId: string): boolean {
  return notificationTypes.some((type) => type.id === typeId);
}
