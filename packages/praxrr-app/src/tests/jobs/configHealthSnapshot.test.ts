import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthNotificationStateQueries } from '$db/queries/configHealthNotificationState.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { configHealthSnapshotsQueries } from '$db/queries/configHealthSnapshots.ts';
import { notificationHistoryQueries } from '$db/queries/notificationHistory.ts';
import { notificationServicesQueries } from '$db/queries/notificationServices.ts';
// Side-effect import registers the 'config-health.snapshot' handler.
import { configHealthSnapshotHandlerDeps, snapshotInstance } from '$jobs/handlers/configHealthSnapshot.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobHandler, JobQueueRecord } from '$jobs/queueTypes.ts';
import { assessHealthDegradation, type HealthDegradedEvent } from '$lib/server/health/degradation.ts';
import { notificationManager } from '$lib/server/notifications/NotificationManager.ts';
import { DiscordNotifier } from '$lib/server/notifications/notifiers/discord/DiscordNotifier.ts';
import { NotificationTypes } from '$lib/server/notifications/types.ts';
import {
  CONFIG_HEALTH_ENGINE_VERSION,
  type CriterionResult,
  type HealthArrType,
  type HealthBand,
  type HealthReport,
} from '$shared/health/index.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path and run the full
 * migration chain (so config_health_settings / arr_instances exist), then tear down. Mirrors
 * syncHistoryCleanup.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/config-health-snapshot-${crypto.randomUUID()}`;
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

function getHandler(): JobHandler {
  const handler = jobQueueRegistry.get('config-health.snapshot');
  assertExists(handler, 'config-health.snapshot handler should be registered');
  return handler;
}

/** Build a `config-health.snapshot` job record; source drives scheduled vs manual recurrence. */
function createSnapshotJob(overrides: Partial<JobQueueRecord> = {}): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 2100,
    jobType: 'config-health.snapshot',
    status: 'running',
    runAt: now,
    payload: {},
    source: 'schedule',
    dedupeKey: 'config-health.snapshot',
    cooldownUntil: null,
    attempts: 1,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedInstance(arrType: HealthArrType): number {
  return arrInstancesQueries.create({
    name: `${arrType}-${crypto.randomUUID()}`,
    type: arrType,
    url: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
}

function criterion(score: number | null, overrides: Partial<CriterionResult> = {}): CriterionResult {
  return {
    id: 'completeness',
    label: 'Completeness',
    score,
    weight: 100,
    contribution: score ?? 0,
    detail: [],
    suggestions: [],
    ...overrides,
  };
}

function makeReport(
  instanceId: number,
  arrType: HealthArrType,
  score: number,
  band: HealthBand,
  overrides: Partial<HealthReport> = {}
): HealthReport {
  return {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    instanceId,
    instanceName: `${arrType}-instance`,
    arrType,
    generatedAt: '2026-07-18T12:00:00.000Z',
    overall: {
      score,
      band,
      criteria: [criterion(score)],
      suggestions: [],
    },
    profiles: [],
    ...overrides,
  };
}

async function persistReport(report: HealthReport, events: HealthDegradedEvent[] = []): Promise<void> {
  await snapshotInstance(report.instanceId, {
    scoreInstance: async () => report,
    sendHealthDegraded: async (event) => {
      events.push(event);
    },
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Deferred resolver was not initialized');
  };
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

// ============================================================================
// Registration
// ============================================================================

Deno.test('config-health.snapshot handler is registered in the queue registry', () => {
  assertExists(jobQueueRegistry.get('config-health.snapshot'), 'config-health.snapshot handler should be registered');
});

// ============================================================================
// No sync-capable instances -> skipped
// ============================================================================

migratedTest('config-health.snapshot returns skipped and reschedules when scheduled with no instances', async () => {
  const handler = getHandler();

  const result = await handler(createSnapshotJob({ source: 'schedule' }));

  assertEquals(result.status, 'skipped');
  assertExists(result.output);
  assertStringIncludes(result.output, 'No sync-capable instances');
  assertExists(result.rescheduleAt, 'a scheduled sweep must reschedule even with nothing to snapshot');

  // A scheduled empty sweep is recorded as a completed run.
  assertExists(configHealthSettingsQueries.get().last_run_at);
});

migratedTest(
  'config-health.snapshot returns skipped without rescheduling on a manual run with no instances',
  async () => {
    const handler = getHandler();

    const result = await handler(createSnapshotJob({ source: 'manual' }));

    assertEquals(result.status, 'skipped');
    assertEquals(result.rescheduleAt, undefined, 'manual runs must not self-perpetuate');
  }
);

// ============================================================================
// Disabled settings -> cancelled
// ============================================================================

migratedTest('config-health.snapshot returns cancelled when scoring is disabled', async () => {
  const handler = getHandler();
  configHealthSettingsQueries.update({ enabled: false });

  const result = await handler(createSnapshotJob({ source: 'schedule' }));
  assertEquals(result.status, 'cancelled');
  assertExists(result.output);
  assertStringIncludes(result.output, 'disabled');
});

// ============================================================================
// Persisted degradation notification convergence
// ============================================================================

migratedTest('snapshotInstance establishes a quiet baseline and persists before worse-band dispatch', async () => {
  const instanceId = seedInstance('radarr');
  const events: HealthDegradedEvent[] = [];

  await persistReport(makeReport(instanceId, 'radarr', 86, 'healthy'), events);
  assertEquals(events, []);
  assertEquals(configHealthSnapshotsQueries.getTrend(instanceId).length, 1);

  const current = makeReport(instanceId, 'radarr', 84, 'attention', {
    generatedAt: '2026-07-18T13:00:00.000Z',
  });
  await snapshotInstance(instanceId, {
    scoreInstance: async () => current,
    sendHealthDegraded: async (event) => {
      const persisted = configHealthSnapshotsQueries.getTrend(instanceId);
      assertEquals(persisted.length, 2, 'dispatch must observe the current persisted row');
      assertEquals(persisted.at(-1)?.id, event.currentSnapshotId);
      events.push(event);
    },
  });

  assertEquals(events.length, 1);
  assertEquals(events[0].kind, 'band');
  assertEquals(events[0].previousScore, 86);
  assertEquals(events[0].currentScore, 84);
  assertEquals(events[0].previousSnapshotId, configHealthSnapshotsQueries.getTrend(instanceId)[0].id);
  assertExists(configHealthNotificationStateQueries.get(instanceId));
});

migratedTest('snapshotInstance emits at exactly five points and keeps smaller or improving edges quiet', async () => {
  const instanceId = seedInstance('sonarr');
  const events: HealthDegradedEvent[] = [];

  await persistReport(makeReport(instanceId, 'sonarr', 79, 'attention'), events);
  await persistReport(
    makeReport(instanceId, 'sonarr', 74, 'attention', {
      generatedAt: '2026-07-18T13:00:00.000Z',
    }),
    events
  );
  await persistReport(
    makeReport(instanceId, 'sonarr', 70, 'attention', {
      generatedAt: '2026-07-18T14:00:00.000Z',
    }),
    events
  );
  await persistReport(
    makeReport(instanceId, 'sonarr', 74, 'attention', {
      generatedAt: '2026-07-18T15:00:00.000Z',
    }),
    events
  );

  assertEquals(events.length, 1);
  assertEquals(events[0].kind, 'score');
  assertEquals(events[0].pointDrop, 5);
  assertEquals(configHealthSnapshotsQueries.getTrend(instanceId).length, 4);
});

migratedTest(
  'snapshotInstance preserves state through unknown, malformed, cross-engine, and changed-basis edges',
  async () => {
    const scenarios: Array<{
      name: string;
      current: (instanceId: number) => HealthReport;
    }> = [
      {
        name: 'unknown',
        current: (instanceId) => makeReport(instanceId, 'radarr', 0, 'unknown'),
      },
      {
        name: 'malformed',
        current: (instanceId) =>
          makeReport(instanceId, 'radarr', 70, 'attention', {
            overall: {
              score: 70,
              band: 'attention',
              criteria: [criterion(70), criterion(60)],
              suggestions: [],
            },
          }),
      },
      {
        name: 'cross-engine',
        current: (instanceId) =>
          makeReport(instanceId, 'radarr', 70, 'attention', {
            engineVersion: '2',
          }),
      },
      {
        name: 'changed-basis',
        current: (instanceId) =>
          makeReport(instanceId, 'radarr', 70, 'attention', {
            overall: {
              score: 70,
              band: 'attention',
              criteria: [criterion(70, { weight: 50, contribution: 35 })],
              suggestions: [],
            },
          }),
      },
    ];

    for (const scenario of scenarios) {
      const instanceId = seedInstance('radarr');
      const events: HealthDegradedEvent[] = [];
      await persistReport(makeReport(instanceId, 'radarr', 79, 'attention'), events);
      const baselineSnapshotId = configHealthSnapshotsQueries.getTrend(instanceId).at(-1)?.id;
      assertExists(baselineSnapshotId);
      configHealthNotificationStateQueries.claim(
        instanceId,
        baselineSnapshotId,
        `existing-${scenario.name}`,
        '2026-07-18T11:00:00.000Z'
      );
      await persistReport(
        {
          ...scenario.current(instanceId),
          generatedAt: '2026-07-18T13:00:00.000Z',
        },
        events
      );

      assertEquals(events, [], `${scenario.name} evidence must stay quiet`);
      assertEquals(
        configHealthNotificationStateQueries.get(instanceId)?.notifiedSignature,
        `existing-${scenario.name}`,
        `${scenario.name} evidence must preserve degraded state`
      );
    }
  }
);

migratedTest(
  'snapshotInstance emits each continued worsening state once and suppresses an unchanged repeat',
  async () => {
    const instanceId = seedInstance('lidarr');
    const events: HealthDegradedEvent[] = [];

    await persistReport(makeReport(instanceId, 'lidarr', 79, 'attention'), events);
    await persistReport(
      makeReport(instanceId, 'lidarr', 74, 'attention', {
        generatedAt: '2026-07-18T13:00:00.000Z',
      }),
      events
    );
    await persistReport(
      makeReport(instanceId, 'lidarr', 69, 'attention', {
        generatedAt: '2026-07-18T14:00:00.000Z',
      }),
      events
    );
    await persistReport(
      makeReport(instanceId, 'lidarr', 69, 'attention', {
        generatedAt: '2026-07-18T15:00:00.000Z',
      }),
      events
    );

    assertEquals(events.length, 2);
    assertEquals(
      events.map((event) => event.currentScore),
      [74, 69]
    );
    assertEquals(new Set(events.map((event) => event.signature)).size, 2);
  }
);

migratedTest('snapshotInstance overlapping identical regressions produce one claimed event', async () => {
  const instanceId = seedInstance('radarr');
  const events: HealthDegradedEvent[] = [];
  await persistReport(makeReport(instanceId, 'radarr', 79, 'attention'), events);

  const current = makeReport(instanceId, 'radarr', 74, 'attention', {
    generatedAt: '2026-07-18T13:00:00.000Z',
  });
  const deps = {
    scoreInstance: async () => current,
    sendHealthDegraded: async (event: HealthDegradedEvent) => {
      events.push(event);
    },
  };
  await Promise.all([snapshotInstance(instanceId, deps), snapshotInstance(instanceId, deps)]);

  assertEquals(configHealthSnapshotsQueries.getTrend(instanceId).length, 3);
  assertEquals(events.length, 1);
  assertEquals(configHealthNotificationStateQueries.get(instanceId)?.notifiedSignature, events[0].signature);
});

migratedTest('newer recovery tombstone rejects an older degradation that finishes late', async () => {
  const instanceId = seedInstance('radarr');
  const events: HealthDegradedEvent[] = [];
  await persistReport(makeReport(instanceId, 'radarr', 79, 'attention'), events);

  const assessmentReady = deferred();
  const releaseOlder = deferred();
  const older = snapshotInstance(instanceId, {
    scoreInstance: async () =>
      makeReport(instanceId, 'radarr', 74, 'attention', {
        generatedAt: '2026-07-18T13:00:00.000Z',
      }),
    assessHealthDegradation: async (previous, current) => {
      const assessment = await assessHealthDegradation(previous, current);
      assessmentReady.resolve();
      await releaseOlder.promise;
      return assessment;
    },
    sendHealthDegraded: async (event) => {
      events.push(event);
    },
  });

  await assessmentReady.promise;
  await snapshotInstance(instanceId, {
    scoreInstance: async () =>
      makeReport(instanceId, 'radarr', 79, 'attention', {
        generatedAt: '2026-07-18T14:00:00.000Z',
      }),
    sendHealthDegraded: async (event) => {
      events.push(event);
    },
  });
  releaseOlder.resolve();
  await older;

  const newestSnapshotId = configHealthSnapshotsQueries.getTrend(instanceId).at(-1)?.id;
  const state = configHealthNotificationStateQueries.get(instanceId);
  assertExists(newestSnapshotId);
  assertExists(state);
  assertEquals(events, []);
  assertEquals(state.lastSnapshotId, newestSnapshotId);
  assertEquals(state.notifiedSignature, null);
});

migratedTest('newer degradation rejects a distinct older degradation that finishes late', async () => {
  const instanceId = seedInstance('sonarr');
  const events: HealthDegradedEvent[] = [];
  await persistReport(makeReport(instanceId, 'sonarr', 84, 'attention'), events);

  const assessmentReady = deferred();
  const releaseOlder = deferred();
  const older = snapshotInstance(instanceId, {
    scoreInstance: async () =>
      makeReport(instanceId, 'sonarr', 79, 'attention', {
        generatedAt: '2026-07-18T13:00:00.000Z',
      }),
    assessHealthDegradation: async (previous, current) => {
      const assessment = await assessHealthDegradation(previous, current);
      assessmentReady.resolve();
      await releaseOlder.promise;
      return assessment;
    },
    sendHealthDegraded: async (event) => {
      events.push(event);
    },
  });

  await assessmentReady.promise;
  await snapshotInstance(instanceId, {
    scoreInstance: async () =>
      makeReport(instanceId, 'sonarr', 74, 'attention', {
        generatedAt: '2026-07-18T14:00:00.000Z',
      }),
    sendHealthDegraded: async (event) => {
      events.push(event);
    },
  });
  releaseOlder.resolve();
  await older;

  const newestSnapshotId = configHealthSnapshotsQueries.getTrend(instanceId).at(-1)?.id;
  const state = configHealthNotificationStateQueries.get(instanceId);
  assertExists(newestSnapshotId);
  assertExists(state);
  assertEquals(
    events.map((event) => event.currentScore),
    [74]
  );
  assertEquals(state.lastSnapshotId, newestSnapshotId);
  assertEquals(state.notifiedSignature, events[0].signature);
});

migratedTest('snapshotInstance preserves explicit Radarr, Sonarr, and Lidarr event payloads', async () => {
  const events: HealthDegradedEvent[] = [];

  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const instanceId = seedInstance(arrType);
    await persistReport(makeReport(instanceId, arrType, 79, 'attention'), events);
    await persistReport(
      makeReport(instanceId, arrType, 74, 'attention', {
        generatedAt: '2026-07-18T13:00:00.000Z',
      }),
      events
    );
  }

  assertEquals(
    events.map((event) => event.arrType),
    ['radarr', 'sonarr', 'lidarr']
  );
  for (const event of events) {
    assertEquals(event.detailsPath, `/config-health/${event.instanceId}`);
  }
});

migratedTest('snapshotInstance claims safely with zero notification subscribers', async () => {
  const instanceId = seedInstance('sonarr');
  await persistReport(makeReport(instanceId, 'sonarr', 79, 'attention'));

  const current = makeReport(instanceId, 'sonarr', 74, 'attention', {
    generatedAt: '2026-07-18T13:00:00.000Z',
  });
  await snapshotInstance(instanceId, { scoreInstance: async () => current });

  assertEquals(configHealthSnapshotsQueries.getTrend(instanceId).length, 2);
  assertExists(configHealthNotificationStateQueries.get(instanceId));
});

migratedTest('snapshotInstance contains state and dispatch failures after persistence without retrying', async () => {
  const stateFailureInstance = seedInstance('radarr');
  await persistReport(makeReport(stateFailureInstance, 'radarr', 79, 'attention'));
  const originalClaim = configHealthNotificationStateQueries.claim;
  try {
    configHealthNotificationStateQueries.claim = () => {
      throw new Error('state unavailable');
    };
    await persistReport(
      makeReport(stateFailureInstance, 'radarr', 74, 'attention', {
        generatedAt: '2026-07-18T13:00:00.000Z',
      })
    );
  } finally {
    configHealthNotificationStateQueries.claim = originalClaim;
  }
  assertEquals(configHealthSnapshotsQueries.getTrend(stateFailureInstance).length, 2);
  assertEquals(configHealthNotificationStateQueries.get(stateFailureInstance), undefined);

  const dispatchFailureInstance = seedInstance('sonarr');
  const dispatchAttempts: HealthDegradedEvent[] = [];
  await persistReport(makeReport(dispatchFailureInstance, 'sonarr', 79, 'attention'));
  const degraded = makeReport(dispatchFailureInstance, 'sonarr', 74, 'attention', {
    generatedAt: '2026-07-18T13:00:00.000Z',
  });
  await snapshotInstance(dispatchFailureInstance, {
    scoreInstance: async () => degraded,
    sendHealthDegraded: async (event) => {
      dispatchAttempts.push(event);
      throw new Error('provider unavailable');
    },
  });
  await persistReport(
    makeReport(dispatchFailureInstance, 'sonarr', 74, 'attention', {
      generatedAt: '2026-07-18T14:00:00.000Z',
    }),
    dispatchAttempts
  );

  assertEquals(configHealthSnapshotsQueries.getTrend(dispatchFailureInstance).length, 3);
  assertEquals(dispatchAttempts.length, 1, 'a failed claimed attempt is not retried');
  assertExists(configHealthNotificationStateQueries.get(dispatchFailureInstance));
});

migratedTest('snapshotInstance contains production notification manager failures after claim', async () => {
  const instanceId = seedInstance('lidarr');
  await persistReport(makeReport(instanceId, 'lidarr', 79, 'attention'));
  const originalNotify = notificationManager.notify;

  try {
    notificationManager.notify = () => Promise.reject(new Error('manager failed'));
    await snapshotInstance(instanceId, {
      scoreInstance: async () =>
        makeReport(instanceId, 'lidarr', 74, 'attention', {
          generatedAt: '2026-07-18T13:00:00.000Z',
        }),
    });
  } finally {
    notificationManager.notify = originalNotify;
  }

  assertEquals(configHealthSnapshotsQueries.getTrend(instanceId).length, 2);
  assertExists(configHealthNotificationStateQueries.get(instanceId));
});

migratedTest('snapshotInstance isolates real notification-history failure after provider delivery', async () => {
  const instanceId = seedInstance('radarr');
  await persistReport(makeReport(instanceId, 'radarr', 79, 'attention'));
  notificationServicesQueries.create({
    id: 'health-history-failure',
    name: 'Health history failure',
    serviceType: 'discord',
    enabled: true,
    config: { webhook_url: 'https://discord.com/api/webhooks/history-failure' },
    enabledTypes: [NotificationTypes.HEALTH_DEGRADED],
  });

  const originalNotify = DiscordNotifier.prototype.notify;
  const originalHistoryCreate = notificationHistoryQueries.create;
  let providerCalls = 0;
  try {
    DiscordNotifier.prototype.notify = () => {
      providerCalls++;
      return Promise.resolve();
    };
    notificationHistoryQueries.create = () => {
      throw new Error('history unavailable');
    };

    await snapshotInstance(instanceId, {
      scoreInstance: async () =>
        makeReport(instanceId, 'radarr', 74, 'attention', {
          generatedAt: '2026-07-18T13:00:00.000Z',
        }),
    });
  } finally {
    DiscordNotifier.prototype.notify = originalNotify;
    notificationHistoryQueries.create = originalHistoryCreate;
  }

  assertEquals(providerCalls, 1);
  assertEquals(configHealthSnapshotsQueries.getTrend(instanceId).length, 2);
  const state = configHealthNotificationStateQueries.get(instanceId);
  assertExists(state);
  assertEquals(state.notifiedSignature === null, false);
});

migratedTest(
  'registered handler keeps success cursor reschedule and backoff after post-insert notification failures',
  async () => {
    const handler = getHandler();
    const instanceIds = Array.from({ length: 6 }, () => seedInstance('sonarr'));
    for (const instanceId of instanceIds) {
      configHealthSnapshotsQueries.insert(
        makeReport(instanceId, 'sonarr', 79, 'attention', {
          generatedAt: '2026-07-18T12:00:00.000Z',
        })
      );
    }

    const originalSnapshotInstance = configHealthSnapshotHandlerDeps.snapshotInstance;
    let result: Awaited<ReturnType<JobHandler>>;
    try {
      configHealthSnapshotHandlerDeps.snapshotInstance = async (instanceId) => {
        await snapshotInstance(instanceId, {
          scoreInstance: async () =>
            makeReport(instanceId, 'sonarr', 74, 'attention', {
              generatedAt: '2026-07-18T13:00:00.000Z',
            }),
          sendHealthDegraded: async () => {
            throw new Error('provider unavailable');
          },
        });
      };
      result = await handler(createSnapshotJob({ source: 'schedule' }));
    } finally {
      configHealthSnapshotHandlerDeps.snapshotInstance = originalSnapshotInstance;
    }

    assertEquals(result.status, 'success');
    assertStringIncludes(result.output ?? '', 'continuing sweep');
    assertExists(result.rescheduleAt);
    const settings = configHealthSettingsQueries.get();
    assertEquals(settings.sweep_cursor, instanceIds[4]);
    assertExists(settings.sweep_started_at);
    assertEquals(settings.error_count, 0);
    assertEquals(settings.backoff_until, null);
    assertEquals(settings.last_run_at, null);
    for (const instanceId of instanceIds.slice(0, 5)) {
      assertEquals(configHealthSnapshotsQueries.getTrend(instanceId).length, 2);
      assertExists(configHealthNotificationStateQueries.get(instanceId));
    }
    assertEquals(configHealthSnapshotsQueries.getTrend(instanceIds[5]).length, 1);
  }
);

migratedTest('health.degraded manual harness: repeat and recovery re-arm', async () => {
  const instanceId = seedInstance('radarr');
  const capturedEvents: HealthDegradedEvent[] = [];

  await persistReport(makeReport(instanceId, 'radarr', 79, 'attention'), capturedEvents);
  await persistReport(
    makeReport(instanceId, 'radarr', 74, 'attention', {
      generatedAt: '2026-07-18T13:00:00.000Z',
    }),
    capturedEvents
  );
  await persistReport(
    makeReport(instanceId, 'radarr', 74, 'attention', {
      generatedAt: '2026-07-18T14:00:00.000Z',
    }),
    capturedEvents
  );
  await persistReport(
    makeReport(instanceId, 'radarr', 79, 'attention', {
      generatedAt: '2026-07-18T15:00:00.000Z',
    }),
    capturedEvents
  );
  const rearmed = configHealthNotificationStateQueries.get(instanceId);
  assertExists(rearmed, 'recovery must leave a monotonic re-arm tombstone');
  assertEquals(rearmed.notifiedSignature, null, 'recovery must re-arm silently');
  await persistReport(
    makeReport(instanceId, 'radarr', 74, 'attention', {
      generatedAt: '2026-07-18T16:00:00.000Z',
    }),
    capturedEvents
  );

  assertEquals(capturedEvents.length, 2);
  assertEquals(capturedEvents[0].signature, capturedEvents[1].signature);
  assertEquals(
    capturedEvents.map((event) => event.currentScore),
    [74, 74]
  );
});
