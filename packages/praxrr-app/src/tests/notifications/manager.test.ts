import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { notificationHistoryQueries } from '$db/queries/notificationHistory.ts';
import { notificationServicesQueries } from '$db/queries/notificationServices.ts';
import { NotificationManager } from '$notifications/NotificationManager.ts';
import { DiscordNotifier } from '$notifications/notifiers/discord/DiscordNotifier.ts';
import { type DiscordConfig, type Notification, NotificationTypes } from '$notifications/types.ts';
import {
  groupNotificationTypesByCategory,
  isValidNotificationType,
  notificationTypes,
} from '$shared/notifications/types.ts';

/**
 * Point the db singleton at a scratch SQLite file, run the full migration chain, invoke the test,
 * and restore the original database location afterward.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/notification-manager-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

migratedTest('health.degraded catalog entry supports lookup, grouping, and validation', () => {
  assertEquals(NotificationTypes.HEALTH_DEGRADED, 'health.degraded');

  const catalogEntry = notificationTypes.find((type) => type.id === NotificationTypes.HEALTH_DEGRADED);
  assertExists(catalogEntry);
  assertEquals(catalogEntry, {
    id: 'health.degraded',
    label: 'Config Health Decreased',
    category: 'Config Health',
    description: 'Notification when Config Health records a meaningful decrease for an Arr instance',
  });

  const grouped = groupNotificationTypesByCategory();
  assertEquals(grouped['Config Health'], [catalogEntry]);
  assert(isValidNotificationType(NotificationTypes.HEALTH_DEGRADED));
  assertEquals(isValidNotificationType('health.decreased'), false);
});

migratedTest('notification manager routes health.degraded only to enabled subscribed services', async () => {
  const disabledSubscribedUrl = 'https://discord.com/api/webhooks/disabled-subscribed';
  const enabledUnsubscribedUrl = 'https://discord.com/api/webhooks/enabled-unsubscribed';
  const enabledSubscribedUrl = 'https://discord.com/api/webhooks/enabled-subscribed';

  assert(
    notificationServicesQueries.create({
      id: 'disabled-subscribed',
      name: 'Disabled subscribed',
      serviceType: 'discord',
      enabled: false,
      config: { webhook_url: disabledSubscribedUrl },
      enabledTypes: [NotificationTypes.HEALTH_DEGRADED],
    })
  );
  assert(
    notificationServicesQueries.create({
      id: 'enabled-unsubscribed',
      name: 'Enabled unsubscribed',
      serviceType: 'discord',
      enabled: true,
      config: { webhook_url: enabledUnsubscribedUrl },
      enabledTypes: [NotificationTypes.DRIFT_DETECTED],
    })
  );
  assert(
    notificationServicesQueries.create({
      id: 'enabled-subscribed',
      name: 'Enabled subscribed',
      serviceType: 'discord',
      enabled: true,
      config: { webhook_url: enabledSubscribedUrl },
      enabledTypes: [NotificationTypes.HEALTH_DEGRADED],
    })
  );

  const originalNotify = DiscordNotifier.prototype.notify;
  const sends: Array<{ webhookUrl: string; type: string }> = [];

  DiscordNotifier.prototype.notify = function (notification: Notification): Promise<void> {
    const notifier = this as unknown as { config: DiscordConfig };
    sends.push({
      webhookUrl: notifier.config.webhook_url,
      type: notification.type,
    });
    return Promise.resolve();
  };

  try {
    await new NotificationManager().notify({
      type: NotificationTypes.HEALTH_DEGRADED,
      generic: {
        title: 'Config Health Decreased',
        message: 'Radarr A changed from healthy 90 to attention 84.',
      },
    });

    assertEquals(sends, [
      {
        webhookUrl: enabledSubscribedUrl,
        type: NotificationTypes.HEALTH_DEGRADED,
      },
    ]);

    const history = notificationHistoryQueries.getByType(NotificationTypes.HEALTH_DEGRADED);
    assertEquals(history.length, 1);
    assertEquals(history[0].service_id, 'enabled-subscribed');
    assertEquals(history[0].status, 'success');
  } finally {
    DiscordNotifier.prototype.notify = originalNotify;
  }
});
