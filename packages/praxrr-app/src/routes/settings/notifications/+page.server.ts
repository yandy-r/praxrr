import type { Actions, RequestEvent } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { notificationServicesQueries } from '$db/queries/notificationServices.ts';
import { notificationHistoryQueries } from '$db/queries/notificationHistory.ts';
import { parseUTC } from '$shared/utils/dates.ts';
import { notificationManager } from '$notifications/NotificationManager.ts';
import { notifications } from '$notifications/definitions/index.ts';
import type { Notification, NotificationContext, NotificationSeverity } from '$notifications/types.ts';

/** Browser-safe service summary: `config` holds secrets and never leaves the server. */
interface NotificationServiceSummary {
  id: string;
  name: string;
  service_type: string;
  enabled: number;
  enabled_types: string;
  created_at: string;
  updated_at: string;
  successCount: number;
  failedCount: number;
  successRate: number;
}

export const load = () => {
  const services = notificationServicesQueries.getAll();

  // Get stats for each service
  const servicesWithStats: NotificationServiceSummary[] = services.map((service) => {
    const stats = notificationHistoryQueries.getStats(service.id);
    return {
      id: service.id,
      name: service.name,
      service_type: service.service_type,
      enabled: service.enabled,
      enabled_types: service.enabled_types,
      created_at: service.created_at,
      updated_at: service.updated_at,
      successCount: stats.success,
      failedCount: stats.failed,
      successRate: stats.successRate,
    };
  });

  // Get recent notification history (last 50)
  const history = notificationHistoryQueries.getRecent(50);

  return {
    services: servicesWithStats,
    history,
  };
};

export const actions: Actions = {
  toggleEnabled: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const id = formData.get('id') as string;
    const enabled = formData.get('enabled') === 'true';

    if (!id) {
      return fail(400, { error: 'Service ID is required' });
    }

    try {
      const success = notificationServicesQueries.update(id, { enabled });

      if (!success) {
        return fail(400, { error: 'Failed to update service' });
      }

      await logger.info(`Notification service ${enabled ? 'enabled' : 'disabled'}`, {
        source: 'settings/notifications',
        meta: { serviceId: id, enabled },
      });

      return { success: true };
    } catch (err) {
      await logger.error('Failed to toggle notification service', {
        source: 'settings/notifications',
        meta: { serviceId: id, error: err },
      });
      return fail(500, { error: 'Failed to update service' });
    }
  },

  delete: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const id = formData.get('id') as string;

    if (!id) {
      return fail(400, { error: 'Service ID is required' });
    }

    try {
      const success = notificationServicesQueries.delete(id);

      if (!success) {
        return fail(400, { error: 'Failed to delete service' });
      }

      await logger.info('Notification service deleted', {
        source: 'settings/notifications',
        meta: { serviceId: id },
      });

      return { success: true };
    } catch (err) {
      await logger.error('Failed to delete notification service', {
        source: 'settings/notifications',
        meta: { serviceId: id, error: err },
      });
      return fail(500, { error: 'Failed to delete service' });
    }
  },

  testNotification: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const id = formData.get('id') as string;

    if (!id) {
      return fail(400, { error: 'Service ID is required' });
    }

    const service = notificationServicesQueries.getById(id);
    if (!service) {
      return fail(404, { error: 'Service not found' });
    }

    // Bypasses enabled/enabled_types filters; single attempt, not recorded in history.
    const outcome = await notificationManager.sendToService(service, notifications.test().build(), {
      maxAttempts: 1,
      record: false,
    });

    if (!outcome.success) {
      return fail(502, { error: `Test failed: ${outcome.error ?? 'Unknown error'}` });
    }

    return { success: true };
  },

  resend: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const historyId = Number(formData.get('id'));

    if (!Number.isInteger(historyId) || historyId <= 0) {
      return fail(400, { error: 'A valid notification history ID is required' });
    }

    const row = notificationHistoryQueries.getById(historyId);
    if (!row) {
      return fail(404, { error: 'Notification not found' });
    }
    if (row.status !== 'failed') {
      return fail(400, { error: 'Only failed notifications can be resent' });
    }

    const service = notificationServicesQueries.getById(row.service_id);
    if (!service) {
      return fail(404, { error: 'The notification service no longer exists' });
    }

    // `sent_at` is SQLite UTC ("YYYY-MM-DD HH:MM:SS"); keep the original event time on resend.
    const sentAt = parseUTC(row.sent_at);
    const notification: Notification = {
      type: row.notification_type,
      generic: { title: row.title, message: row.message },
      ...parseHistoryMetadata(row.metadata),
      ...(sentAt && !Number.isNaN(sentAt.getTime()) ? { occurredAt: sentAt.toISOString() } : {}),
    };

    // Records a new history row with its own attempt count.
    const outcome = await notificationManager.sendToService(service, notification);

    if (!outcome.success) {
      return fail(502, { error: `Resend failed: ${outcome.error ?? 'Unknown error'}` });
    }

    return { success: true };
  },
};

const SEVERITIES: readonly NotificationSeverity[] = ['info', 'success', 'warning', 'error'];

/** Recover severity/context recorded by the manager; ignore malformed or legacy metadata. */
function parseHistoryMetadata(metadata: string | null): Pick<Notification, 'severity' | 'context'> {
  if (!metadata) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};

  const { severity, context } = parsed as { severity?: unknown; context?: unknown };
  const result: Pick<Notification, 'severity' | 'context'> = {};
  if (typeof severity === 'string' && (SEVERITIES as readonly string[]).includes(severity)) {
    result.severity = severity as NotificationSeverity;
  }
  if (context && typeof context === 'object') {
    const { instanceId, instanceName, arrType } = context as Record<string, unknown>;
    const ctx: NotificationContext = {};
    if (typeof instanceId === 'number') ctx.instanceId = instanceId;
    if (typeof instanceName === 'string') ctx.instanceName = instanceName;
    if (typeof arrType === 'string') ctx.arrType = arrType;
    if (Object.keys(ctx).length > 0) result.context = ctx;
  }
  return result;
}
