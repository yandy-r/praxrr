/**
 * Core notification types and interfaces
 */

import type { NotificationProviderType } from '$shared/notifications/providers.ts';
import type { DiscordEmbed } from './notifiers/discord/embed.ts';
import type { WebhookConfig } from './notifiers/webhook/provider.ts';
import type { NtfyConfig } from './notifiers/ntfy/provider.ts';
import type { GotifyConfig } from './notifiers/gotify/provider.ts';
import type { PushoverConfig } from './notifiers/pushover/provider.ts';
import type { TelegramConfig } from './notifiers/telegram/provider.ts';
import type { SlackConfig } from './notifiers/slack/provider.ts';
import type { AppriseConfig } from './notifiers/apprise/provider.ts';

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

  // Config Health
  HEALTH_DEGRADED: 'health.degraded',

  // Sync (Arr push sync — audit trail)
  SYNC_FAILED: 'sync.failed',
  SYNC_PARTIAL: 'sync.partial',

  // Canary (blast-radius safety)
  CANARY_FAILED: 'canary.failed',
  CANARY_PROMOTED: 'canary.promoted',
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

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Optional event context (which Arr instance the event concerns)
 */
export interface NotificationContext {
  instanceId?: number;
  instanceName?: string;
  arrType?: string;
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
  /** Severity override; otherwise derived from `type` by `resolveSeverity` */
  severity?: NotificationSeverity;
  context?: NotificationContext;
  /** ISO timestamp; stamped by the builder at build()/send() */
  occurredAt?: string;
}

/**
 * Outcome of a successful delivery
 */
export interface DeliveryResult {
  /** Highest attempt number reached by any request in the delivery (1 = first-try success) */
  attempts: number;
}

export interface DeliveryOptions {
  maxAttempts?: number;
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
export type NotificationServiceConfig =
  | DiscordConfig
  | WebhookConfig
  | NtfyConfig
  | GotifyConfig
  | PushoverConfig
  | TelegramConfig
  | SlackConfig
  | AppriseConfig;

/**
 * Service types supported
 */
export type NotificationServiceType = NotificationProviderType;
