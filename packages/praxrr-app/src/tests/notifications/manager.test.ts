import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { notificationHistoryQueries } from '$db/queries/notificationHistory.ts';
import { notificationServicesQueries } from '$db/queries/notificationServices.ts';
import { NotificationManager } from '$notifications/NotificationManager.ts';
import { DiscordNotifier } from '$notifications/notifiers/discord/DiscordNotifier.ts';
import { type DiscordConfig, type Notification, NotificationTypes, type DeliveryResult } from '$notifications/types.ts';
import { deliveryTiming, NotificationDeliveryError } from '$notifications/base/delivery.ts';
import { notifications } from '$notifications/definitions/index.ts';
import type { UpgradeJobLog } from '$lib/server/upgrades/types.ts';
import type { RenameJobLog } from '$lib/server/rename/types.ts';
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

  DiscordNotifier.prototype.notify = function (notification: Notification): Promise<DeliveryResult> {
    const notifier = this as unknown as { config: DiscordConfig };
    sends.push({
      webhookUrl: notifier.config.webhook_url,
      type: notification.type,
    });
    return Promise.resolve({ attempts: 1 });
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
    assertEquals(history[0].attempts, 1);
  } finally {
    DiscordNotifier.prototype.notify = originalNotify;
  }
});

/**
 * Replace fetch with a recorder returning `respond(callIndex)`, and make retry sleeps instant.
 */
async function withStubbedFetch(
  respond: (call: number) => Response,
  fn: (calls: Array<{ url: string; body: string }>) => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalSleep = deliveryTiming.sleep;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' });
    return Promise.resolve(respond(calls.length));
  };
  deliveryTiming.sleep = () => Promise.resolve();
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
    deliveryTiming.sleep = originalSleep;
  }
}

const SECRET_WEBHOOK = 'https://discord.com/api/webhooks/123/super-secret-token';

function createDiscordService(id: string, enabledTypes: string[]): void {
  assert(
    notificationServicesQueries.create({
      id,
      name: id,
      serviceType: 'discord',
      enabled: true,
      config: { webhook_url: SECRET_WEBHOOK, username: 'Bot' },
      enabledTypes,
    })
  );
}

migratedTest('failed Discord delivery records attempts and a secret-masked error in history', async () => {
  createDiscordService('failing-discord', [NotificationTypes.SYNC_FAILED]);

  await withStubbedFetch(
    () => new Response(`upstream broke for ${SECRET_WEBHOOK}`, { status: 500, statusText: 'Internal Server Error' }),
    async (calls) => {
      await new NotificationManager().notify({
        type: NotificationTypes.SYNC_FAILED,
        generic: { title: 'Sync failed', message: 'boom' },
        context: { instanceId: 7, instanceName: 'Radarr 4K', arrType: 'radarr' },
      });

      assertEquals(calls.length, 3);
    }
  );

  const history = notificationHistoryQueries.getByType(NotificationTypes.SYNC_FAILED);
  assertEquals(history.length, 1);
  assertEquals(history[0].status, 'failed');
  assertEquals(history[0].attempts, 3);
  assertExists(history[0].error);
  assert(history[0].error.includes('HTTP 500'));
  assert(!history[0].error.includes('super-secret-token'), 'history error must not contain the webhook token');
  assertEquals(JSON.parse(history[0].metadata ?? '{}'), {
    severity: 'error',
    context: { instanceId: 7, instanceName: 'Radarr 4K', arrType: 'radarr' },
  });
  assertEquals(notificationHistoryQueries.getById(history[0].id)?.attempts, 3);
});

migratedTest('sendToService with record:false returns the masked outcome without writing history', async () => {
  createDiscordService('test-discord', []);
  const service = notificationServicesQueries.getById('test-discord');
  assertExists(service);

  await withStubbedFetch(
    () => new Response(`bad hook ${SECRET_WEBHOOK}`, { status: 400, statusText: 'Bad Request' }),
    async (calls) => {
      const outcome = await new NotificationManager().sendToService(service, notifications.test().build(), {
        maxAttempts: 1,
        record: false,
      });

      assertEquals(calls.length, 1);
      assertEquals(outcome.success, false);
      assertEquals(outcome.attempts, 1);
      assertExists(outcome.error);
      assert(!outcome.error.includes('super-secret-token'));
    }
  );

  assertEquals(notificationHistoryQueries.getByServiceId('test-discord').length, 0);
});

migratedTest('Discord delivery fills embed author from service config and records success', async () => {
  createDiscordService('ok-discord', ['test']);

  await withStubbedFetch(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      await new NotificationManager().notify(notifications.test().build());

      assertEquals(calls.length, 1);
      assertEquals(calls[0].url, SECRET_WEBHOOK);
      const body = JSON.parse(calls[0].body);
      assertEquals(body.username, 'Bot');
      assertEquals(body.embeds[0].author, { name: 'Bot' });
    }
  );

  const history = notificationHistoryQueries.getByServiceId('ok-discord');
  assertEquals(history.length, 1);
  assertEquals(history[0].status, 'success');
  assertEquals(history[0].attempts, 1);
});

Deno.test('Discord partial failure reports the highest attempt count across chunks', async () => {
  const notifier = new DiscordNotifier({ webhook_url: SECRET_WEBHOOK });
  const statuses = [503, 503, 200, 400];

  await withStubbedFetch(
    (call) => new Response(null, { status: statuses[call - 1] ?? 500 }),
    async (calls) => {
      const error = await assertRejects(
        () =>
          notifier.notify({
            type: 'test',
            discord: { embeds: [{ title: 'chunk 1' }, { title: 'chunk 2' }] },
          }),
        NotificationDeliveryError
      );
      assertEquals(calls.length, 4);
      assertEquals(error.attempts, 3);
      assertEquals(error.status, 400);
    }
  );
});

function makeUpgradeLog(): UpgradeJobLog {
  return {
    id: 'upgrade-log',
    configId: 1,
    instanceId: 5,
    instanceName: 'Radarr Main',
    startedAt: '2026-10-20T10:00:00.000Z',
    completedAt: '2026-10-20T10:01:00.000Z',
    status: 'success',
    config: { schedule: 60, filterMode: 'round_robin', selectedFilter: 'f', dryRun: false },
    library: { totalItems: 10, fetchedFromCache: false, fetchDurationMs: 5 },
    filter: {
      id: 'f',
      name: 'Filter',
      rules: { type: 'group', match: 'all', children: [] },
      matchedCount: 3,
      afterCooldown: 3,
      dryRunExcluded: 0,
    },
    selection: { method: 'random', requestedCount: 1, actualCount: 0, items: [] },
    results: { searchesTriggered: 0, successful: 0, failed: 0, errors: [] },
  } as unknown as UpgradeJobLog;
}

migratedTest('upgrade and rename definitions route through the manager with instance context', async () => {
  createDiscordService('jobs-discord', ['upgrade.success', 'rename.success']);

  const renameLog = {
    id: 'rename-log',
    instanceId: 9,
    instanceName: 'Sonarr Main',
    instanceType: 'sonarr',
    startedAt: '2026-10-20T10:00:00.000Z',
    completedAt: '2026-10-20T10:01:00.000Z',
    status: 'success',
    config: { dryRun: false, renameFolders: false, ignoreTag: null, manual: false },
    library: { totalItems: 1, fetchDurationMs: 1 },
    filtering: { afterIgnoreTag: 1, skippedByTag: 0 },
    results: {
      filesNeedingRename: 1,
      filesRenamed: 1,
      foldersRenamed: 0,
      commandsTriggered: 1,
      commandsCompleted: 1,
      commandsFailed: 0,
      errors: [],
    },
    renamedItems: [],
  } as unknown as RenameJobLog;

  await withStubbedFetch(
    () => new Response(null, { status: 204 }),
    async (calls) => {
      await notifications.upgrade({ log: makeUpgradeLog() }).send();
      await notifications.rename({ log: renameLog }).send();
      assertEquals(calls.length, 2);
    }
  );

  const history = notificationHistoryQueries.getByServiceId('jobs-discord');
  const contexts = history.map((row) => [row.notification_type, JSON.parse(row.metadata ?? '{}').context]);
  assertEquals(
    contexts.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ['rename.success', { instanceId: 9, instanceName: 'Sonarr Main', arrType: 'sonarr' }],
      ['upgrade.success', { instanceId: 5, instanceName: 'Radarr Main', arrType: 'radarr' }],
    ]
  );
});
