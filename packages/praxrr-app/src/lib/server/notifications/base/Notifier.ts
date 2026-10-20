import type { DeliveryOptions, DeliveryResult, Notification } from '../types.ts';

/**
 * Interface every notification provider implementation follows
 */
export interface Notifier {
  /**
   * Deliver a notification.
   * @throws {NotificationDeliveryError} on failure (message already masked of secrets)
   */
  notify(notification: Notification, options?: DeliveryOptions): Promise<DeliveryResult>;

  /**
   * Get the service name for logging purposes
   */
  getName(): string;
}
