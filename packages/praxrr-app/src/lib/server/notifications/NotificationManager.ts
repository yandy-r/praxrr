import { logger } from '$logger/logger.ts';
import { notificationServicesQueries, type NotificationService } from '$db/queries/notificationServices.ts';
import { notificationHistoryQueries } from '$db/queries/notificationHistory.ts';
import type { Notification } from './types.ts';
import { maskSecrets, NotificationDeliveryError } from './base/delivery.ts';
import { resolveSeverity } from './content.ts';
import { getProvider } from './registry.ts';

export interface ServiceDeliveryOutcome {
  success: boolean;
  attempts: number;
  /** Already masked of the provider's secret values */
  error?: string;
}

/**
 * Central notification manager
 * Orchestrates sending notifications to all enabled services through the provider registry
 */
export class NotificationManager {
  /**
   * Send a notification to all enabled services that have this notification type enabled
   * Fire-and-forget: Does not throw errors, failures are logged and recorded in history
   */
  async notify(notification: Notification): Promise<void> {
    try {
      const relevantServices = notificationServicesQueries.getAllEnabled().filter((service) => {
        try {
          const enabledTypes = JSON.parse(service.enabled_types) as unknown;
          return Array.isArray(enabledTypes) && enabledTypes.includes(notification.type);
        } catch {
          return false;
        }
      });

      if (relevantServices.length === 0) {
        return;
      }

      await Promise.allSettled(relevantServices.map((service) => this.sendToService(service, notification)));
    } catch (error) {
      await logger.error('Error in notification manager', {
        source: 'NotificationManager',
        meta: {
          error: error instanceof Error ? error.message : String(error),
          type: notification.type,
        },
      });
    }
  }

  /**
   * Deliver a notification to one service (no enabled/subscription filtering).
   * Never throws; errors are masked with the provider's secret values before being logged,
   * recorded (unless `record: false`) or returned.
   */
  async sendToService(
    service: NotificationService,
    notification: Notification,
    options?: { maxAttempts?: number; record?: boolean }
  ): Promise<ServiceDeliveryOutcome> {
    const outcome = await this.deliver(service, notification, options?.maxAttempts);

    if (outcome.success) {
      await logger.debug('Notification sent', {
        source: 'NotificationManager',
        meta: { serviceId: service.id, serviceType: service.service_type, type: notification.type },
      });
    } else {
      await logger.error('Failed to send notification to service', {
        source: 'NotificationManager',
        meta: {
          serviceId: service.id,
          serviceType: service.service_type,
          type: notification.type,
          attempts: outcome.attempts,
          error: outcome.error,
        },
      });
    }

    if (options?.record !== false) {
      try {
        notificationHistoryQueries.create({
          serviceId: service.id,
          notificationType: notification.type,
          title: notification.generic?.title ?? 'Notification',
          message: notification.generic?.message ?? '',
          metadata: { severity: resolveSeverity(notification), context: notification.context ?? null },
          status: outcome.success ? 'success' : 'failed',
          error: outcome.error,
          attempts: outcome.attempts,
        });
      } catch (error) {
        await logger.error('Failed to record notification history', {
          source: 'NotificationManager',
          meta: {
            serviceId: service.id,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return outcome;
  }

  private async deliver(
    service: NotificationService,
    notification: Notification,
    maxAttempts: number | undefined
  ): Promise<ServiceDeliveryOutcome> {
    const provider = getProvider(service.service_type);
    if (!provider) {
      return { success: false, attempts: 0, error: `Unknown service type: ${service.service_type}` };
    }

    let config: Record<string, unknown>;
    try {
      const parsed = JSON.parse(service.config) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      config = parsed as Record<string, unknown>;
    } catch {
      // Never echo the config: it holds secrets.
      return { success: false, attempts: 0, error: 'Invalid notification service config' };
    }

    let secrets: string[] = [];
    try {
      secrets = provider.secretValues(config);
      const result = await provider.create(config).notify(notification, { maxAttempts });
      return { success: true, attempts: result.attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        attempts: error instanceof NotificationDeliveryError ? error.attempts : 1,
        error: maskSecrets(message, secrets),
      };
    }
  }
}

/**
 * Singleton instance
 */
export const notificationManager = new NotificationManager();
