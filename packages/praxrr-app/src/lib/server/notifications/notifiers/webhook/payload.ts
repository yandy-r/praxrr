/**
 * Generic webhook payload, version 1.
 * Documented as `NotificationWebhookPayload` in docs/api/v1/schemas/notifications.yaml and the
 * OpenAPI `webhooks.notification` entry; covered by tests/notifications/webhookContract.test.ts.
 */

import type { Notification, NotificationSeverity } from '../../types.ts';
import { renderText, resolveSeverity } from '../../content.ts';

export const WEBHOOK_PAYLOAD_VERSION = 1;

export interface NotificationWebhookPayload {
  version: typeof WEBHOOK_PAYLOAD_VERSION;
  /** Unique delivery id (UUID v4), stable across retries of the same request. */
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  instanceId: number | null;
  instanceName: string | null;
  arrType: string | null;
  /** ISO 8601 timestamp of when the event occurred. */
  occurredAt: string;
}

export function buildWebhookPayload(notification: Notification): NotificationWebhookPayload {
  const { title, message } = renderText(notification);
  const context = notification.context;
  return {
    version: WEBHOOK_PAYLOAD_VERSION,
    id: crypto.randomUUID(),
    type: notification.type,
    severity: resolveSeverity(notification),
    title,
    message,
    instanceId: context?.instanceId ?? null,
    instanceName: context?.instanceName ?? null,
    arrType: context?.arrType ?? null,
    occurredAt: notification.occurredAt ?? new Date().toISOString(),
  };
}
