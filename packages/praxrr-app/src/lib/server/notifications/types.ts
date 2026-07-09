/**
 * Core notification types and interfaces
 */

import type { DiscordEmbed } from './notifiers/discord/embed.ts';

/**
 * Type-safe notification type constants
 */
export const NotificationTypes = {
  // Jobs (dynamic - constructed with job name)
  jobSuccess: (jobName: string) => `job.${jobName}.success` as const,
  jobFailed: (jobName: string) => `job.${jobName}.failed` as const,

  // PCD / Databases
  PCD_LINKED: 'pcd.linked',
  PCD_UNLINKED: 'pcd.unlinked',
  PCD_UPDATES_AVAILABLE: 'pcd.updates_available',
  PCD_SYNC_SUCCESS: 'pcd.sync_success',
  PCD_SYNC_FAILED: 'pcd.sync_failed',

  // Upgrades
  UPGRADE_SUCCESS: 'upgrade.success',
  UPGRADE_PARTIAL: 'upgrade.partial',
  UPGRADE_FAILED: 'upgrade.failed',

  // Renames
  RENAME_SUCCESS: 'rename.success',
  RENAME_PARTIAL: 'rename.partial',
  RENAME_FAILED: 'rename.failed',

  // Drift
  DRIFT_DETECTED: 'drift.detected',

  // Sync (Arr push sync — audit trail)
  SYNC_FAILED: 'sync.failed',
  SYNC_PARTIAL: 'sync.partial',
} as const;

/**
 * Generic notification content (works for all services)
 */
export interface GenericNotification {
  title: string;
  message: string;
}

/**
 * Discord-specific notification content
 */
export interface DiscordNotification {
  embeds: DiscordEmbed[];
}

/**
 * Notification payload sent to services
 */
export interface Notification {
  type: string;
  /** Generic content - used by services without specific payload */
  generic?: GenericNotification;
  /** Discord-specific content - used if present, otherwise falls back to generic */
  discord?: DiscordNotification;
}

/**
 * Result of a notification attempt
 */
export interface NotificationResult {
  success: boolean;
  error?: string;
}

/**
 * Configuration for Discord notifications
 */
export interface DiscordConfig {
  webhook_url: string;
  username?: string;
  avatar_url?: string;
  enable_mentions?: boolean;
}
/**
 * Union type for all notification service configs
 */
export type NotificationServiceConfig = DiscordConfig;

/**
 * Service types supported
 */
export type NotificationServiceType = 'discord';
