import { assert, assertEquals, assertExists, assertMatch, assertStringIncludes } from '@std/assert';
import { load as customFormatsIndexLoad } from '../../routes/custom-formats/+page.server.ts';
import { load as qualityProfilesIndexLoad } from '../../routes/quality-profiles/+page.server.ts';
import { pcdManager } from '../../lib/server/pcd/index.ts';
import { trashGuideManager, type TrashGuideSourceResponse } from '../../lib/server/trashguide/manager.ts';
import type { DatabaseInstance } from '../../lib/server/db/queries/databaseInstances.ts';
import type { SourceRef } from '../../lib/shared/sources/types.ts';
import { jobQueueQueries, type CreateJobQueueInput } from '$db/queries/jobQueue.ts';
import { jobRunHistoryQueries } from '$db/queries/jobRunHistory.ts';
import { trashGuideSourcesQueries, type TrashGuideSource } from '$db/queries/trashGuideSources.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { logger } from '$logger/logger.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import '$jobs/handlers/trashGuideSync.ts';
import {
  enqueueManualTrashGuideSourceSync,
  getTrashGuideSyncDedupeKey,
  getTrashGuideSyncStatus,
  parseTrashGuideSyncRunEvidence,
} from '$jobs/helpers/trashGuideSyncQueue.ts';
import type {
  JobQueueRecord,
  JobRunHistoryRecord,
  TrashGuideSyncJobPayload,
  TrashGuideSyncRunEvidence,
} from '$jobs/queueTypes.ts';

type Restore = () => void;

interface SourceContextPayload {
  sourceContext: {
    availableSources: SourceRef[];
    showAllSourcesTab: boolean;
    defaultSourceKey: string;
    filterDisabledReason: string | null;
  };
}

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function restoreAll(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

function createDatabase(id: number, name: string): DatabaseInstance {
  return {
    id,
    uuid: `db-${id}`,
    name,
    repository_url: `https://example.com/${name.toLowerCase()}`,
    local_path: `/tmp/${name.toLowerCase()}`,
    sync_strategy: 0,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    has_personal_access_token: 0,
    is_private: 0,
    local_ops_enabled: 1,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function createTrashSource(
  id: number,
  name: string,
  arrType: TrashGuideSourceResponse['arrType'],
  entityCounts: TrashGuideSourceResponse['entityCounts']
): TrashGuideSourceResponse {
  return {
    id,
    name,
    repositoryUrl: `https://github.com/example/${name.toLowerCase().replace(/\s+/g, '-')}`,
    branch: 'main',
    arrType,
    scoreProfile: 'default',
    autoPull: true,
    enabled: true,
    syncStrategy: 0,
    lastSyncedAt: null,
    lastCommitHash: null,
    entityCounts,
  };
}

async function readFixture(relativePath: string): Promise<string> {
  return await Deno.readTextFile(new URL(relativePath, import.meta.url));
}

const TRASHGUIDE_SYNC_JOB_TYPE = 'trashguide.sync' as const;

// In-memory stand-in for the per-source queue slot + its terminal run history (issue #238). Keeping
// the queue/history/source lookups here lets every AC exercise the real correlation resolver with NO DB.
interface SyncQueueStore {
  slot: JobQueueRecord | undefined;
  history: JobRunHistoryRecord[];
  nextQueueId: number;
}

function createTrashGuideSourceRecord(
  id: number,
  name: string,
  arrType: TrashGuideSource['arr_type'],
  overrides: Partial<TrashGuideSource> = {}
): TrashGuideSource {
  return {
    id,
    name,
    repository_url: `https://github.com/example/${name.toLowerCase().replace(/\s+/g, '-')}`,
    branch: 'main',
    local_path: `/tmp/trash/${id}`,
    arr_type: arrType,
    score_profile: 'default',
    sync_strategy: 0,
    auto_pull: true,
    enabled: true,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createQueueRecord(
  sourceId: number,
  payload: TrashGuideSyncJobPayload,
  overrides: Partial<JobQueueRecord> = {}
): JobQueueRecord {
  return {
    id: 7000,
    jobType: TRASHGUIDE_SYNC_JOB_TYPE,
    status: 'queued',
    runAt: '2026-07-10T00:00:00.000Z',
    payload: payload as unknown as JobQueueRecord['payload'],
    source: 'manual',
    dedupeKey: getTrashGuideSyncDedupeKey(sourceId),
    cooldownUntil: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function createRunHistoryRecord(
  queueId: number,
  evidence: TrashGuideSyncRunEvidence,
  overrides: Partial<JobRunHistoryRecord> = {}
): JobRunHistoryRecord {
  return {
    id: 9000,
    queueId,
    jobType: TRASHGUIDE_SYNC_JOB_TYPE,
    status: evidence.status,
    startedAt: '2026-07-10T00:00:01.000Z',
    finishedAt: '2026-07-10T00:00:03.000Z',
    durationMs: 2000,
    error: evidence.failure?.message ?? null,
    output: JSON.stringify(evidence),
    evidence: null,
    createdAt: '2026-07-10T00:00:03.000Z',
    ...overrides,
  };
}

function patchLoggerSilent(restores: Restore[]): void {
  const noop = (async () => {}) as typeof logger.info;
  patchTarget(logger, 'debug', noop, restores);
  patchTarget(logger, 'info', noop, restores);
  patchTarget(logger, 'warn', noop, restores);
  patchTarget(logger, 'error', noop, restores);
}

// Wire the enqueue helper, the status resolver, and the sync handler to an in-memory queue store so a
// full enqueue -> handler -> status pass runs without touching the app DB or the live dispatcher timer.
function installSyncQueueHarness(
  store: SyncQueueStore,
  source: TrashGuideSource | undefined,
  restores: Restore[]
): void {
  patchTarget(jobQueueQueries, 'getByDedupeKey', (() => store.slot) as typeof jobQueueQueries.getByDedupeKey, restores);
  patchTarget(
    jobQueueQueries,
    'upsertScheduled',
    ((input: CreateJobQueueInput) => {
      // Mirror the real coalescing rule: never overwrite a running slot.
      if (store.slot?.status === 'running') {
        return store.slot;
      }
      const record: JobQueueRecord = {
        id: store.slot?.id ?? store.nextQueueId,
        jobType: input.jobType,
        status: 'queued',
        runAt: input.runAt,
        payload: (input.payload ?? {}) as unknown as JobQueueRecord['payload'],
        source: input.source ?? 'schedule',
        dedupeKey: input.dedupeKey ?? null,
        cooldownUntil: input.cooldownUntil ?? null,
        attempts: store.slot?.attempts ?? 0,
        startedAt: store.slot?.startedAt ?? null,
        finishedAt: null,
        createdAt: store.slot?.createdAt ?? '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      };
      store.slot = record;
      return record;
    }) as typeof jobQueueQueries.upsertScheduled,
    restores
  );
  patchTarget(
    jobRunHistoryQueries,
    'getByQueueId',
    ((queueId: number, limit = 1) =>
      store.history
        .filter((row) => row.queueId === queueId)
        .slice(0, limit)) as typeof jobRunHistoryQueries.getByQueueId,
    restores
  );
  patchTarget(trashGuideSourcesQueries, 'getById', (() => source) as typeof trashGuideSourcesQueries.getById, restores);
  patchTarget(jobDispatcher, 'notifyJobEnqueued', (() => {}) as typeof jobDispatcher.notifyJobEnqueued, restores);
  patchLoggerSilent(restores);
}

Deno.test('custom formats source context hides all-sources affordance for single-source state', async () => {
  const restores: Restore[] = [];

  patchTarget(pcdManager, 'getAll', (() => [createDatabase(11, 'Praxrr-DB')]) as typeof pcdManager.getAll, restores);
  patchTarget(trashGuideManager, 'listSources', (() => []) as typeof trashGuideManager.listSources, restores);

  try {
    const payload = (await customFormatsIndexLoad(
      {} as Parameters<typeof customFormatsIndexLoad>[0]
    )) as SourceContextPayload;

    assertEquals(payload.sourceContext.availableSources, [
      {
        type: 'pcd',
        id: 11,
        name: 'Praxrr-DB',
      },
    ]);
    assertEquals(payload.sourceContext.showAllSourcesTab, false);
    assertEquals(payload.sourceContext.defaultSourceKey, 'pcd:11');
    assertEquals(payload.sourceContext.filterDisabledReason, 'Source filtering requires at least two sources');
  } finally {
    restoreAll(restores);
  }
});

Deno.test(
  'custom formats source context enables all-sources state when two or more sources are available',
  async () => {
    const restores: Restore[] = [];
    const trashSource = createTrashSource(91, 'TRaSH Radarr', 'radarr', {
      customFormats: 12,
      customFormatGroups: 0,
      qualityProfiles: 0,
      qualitySizes: 0,
      naming: 0,
    });

    patchTarget(pcdManager, 'getAll', (() => [createDatabase(11, 'Praxrr-DB')]) as typeof pcdManager.getAll, restores);
    patchTarget(
      trashGuideManager,
      'listSources',
      (() => [trashSource]) as typeof trashGuideManager.listSources,
      restores
    );

    try {
      const payload = (await customFormatsIndexLoad(
        {} as Parameters<typeof customFormatsIndexLoad>[0]
      )) as SourceContextPayload;

      assertEquals(payload.sourceContext.showAllSourcesTab, true);
      assertEquals(payload.sourceContext.defaultSourceKey, 'pcd:11');
      assertEquals(payload.sourceContext.filterDisabledReason, null);
      assertEquals(payload.sourceContext.availableSources, [
        {
          type: 'pcd',
          id: 11,
          name: 'Praxrr-DB',
        },
        {
          type: 'trash',
          id: 91,
          name: 'TRaSH Radarr',
          arrType: 'radarr',
        },
      ]);
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test(
  'custom formats source context surfaces mismatch empty-state messaging when TRaSH sources have zero entities',
  async () => {
    const restores: Restore[] = [];
    const trashSource = createTrashSource(92, 'TRaSH Sonarr', 'sonarr', {
      customFormats: 0,
      customFormatGroups: 0,
      qualityProfiles: 8,
      qualitySizes: 0,
      naming: 0,
    });

    patchTarget(pcdManager, 'getAll', (() => [createDatabase(12, 'Main DB')]) as typeof pcdManager.getAll, restores);
    patchTarget(
      trashGuideManager,
      'listSources',
      (() => [trashSource]) as typeof trashGuideManager.listSources,
      restores
    );

    try {
      const payload = (await customFormatsIndexLoad(
        {} as Parameters<typeof customFormatsIndexLoad>[0]
      )) as SourceContextPayload;

      assertEquals(payload.sourceContext.availableSources, [
        {
          type: 'pcd',
          id: 12,
          name: 'Main DB',
        },
      ]);
      assertEquals(payload.sourceContext.showAllSourcesTab, false);
      assertEquals(
        payload.sourceContext.filterDisabledReason,
        'Linked TRaSH sources do not currently provide custom formats'
      );
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test(
  'quality profiles source context exposes explicit empty-state defaults when no sources are available',
  async () => {
    const restores: Restore[] = [];

    patchTarget(pcdManager, 'getAll', (() => []) as typeof pcdManager.getAll, restores);
    patchTarget(trashGuideManager, 'listSources', (() => []) as typeof trashGuideManager.listSources, restores);

    try {
      const payload = (await qualityProfilesIndexLoad(
        {} as Parameters<typeof qualityProfilesIndexLoad>[0]
      )) as SourceContextPayload;

      assertEquals(payload.sourceContext.availableSources, []);
      assertEquals(payload.sourceContext.showAllSourcesTab, false);
      assertEquals(payload.sourceContext.defaultSourceKey, 'all');
      assertEquals(payload.sourceContext.filterDisabledReason, 'No quality profile sources are available');
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test('quality profiles source context enables all-sources visibility for mixed PCD and TRaSH data', async () => {
  const restores: Restore[] = [];
  const trashSource = createTrashSource(33, 'TRaSH Sonarr', 'sonarr', {
    customFormats: 0,
    customFormatGroups: 0,
    qualityProfiles: 5,
    qualitySizes: 0,
    naming: 0,
  });

  patchTarget(pcdManager, 'getAll', (() => [createDatabase(14, 'Music DB')]) as typeof pcdManager.getAll, restores);
  patchTarget(
    trashGuideManager,
    'listSources',
    (() => [trashSource]) as typeof trashGuideManager.listSources,
    restores
  );

  try {
    const payload = (await qualityProfilesIndexLoad(
      {} as Parameters<typeof qualityProfilesIndexLoad>[0]
    )) as SourceContextPayload;

    assertEquals(payload.sourceContext.showAllSourcesTab, true);
    assertEquals(payload.sourceContext.defaultSourceKey, 'pcd:14');
    assertEquals(payload.sourceContext.filterDisabledReason, null);
    assertEquals(payload.sourceContext.availableSources, [
      {
        type: 'pcd',
        id: 14,
        name: 'Music DB',
      },
      {
        type: 'trash',
        id: 33,
        name: 'TRaSH Sonarr',
        arrType: 'sonarr',
      },
    ]);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('source filter persistence wiring remains stable for custom formats and quality profiles pages', async () => {
  const customFormatsPage = await readFixture('../../routes/custom-formats/[databaseId]/+page.svelte');
  const qualityProfilesPage = await readFixture('../../routes/quality-profiles/[databaseId]/+page.svelte');

  assertStringIncludes(customFormatsPage, "const SOURCE_FILTER_STORAGE_PREFIX = 'customFormatsSourceFilter';");
  assertStringIncludes(
    customFormatsPage,
    'sourceFilterStorageKey = `${SOURCE_FILTER_STORAGE_PREFIX}:${data.currentDatabase.id}`;'
  );
  assertStringIncludes(
    customFormatsPage,
    'localStorage.setItem(sourceFilterStorageKey, JSON.stringify(selectedSourceKeys));'
  );

  assertStringIncludes(qualityProfilesPage, "const SOURCE_FILTER_STORAGE_KEY = 'qualityProfilesSourceFilter';");
  assertStringIncludes(
    qualityProfilesPage,
    '$: sourceFilterStorageKey = SOURCE_FILTER_STORAGE_KEY + `:${data.currentDatabase.id}`;'
  );
  assertStringIncludes(qualityProfilesPage, 'selectedSourceKeys = loadSourceSelection(');
  assertStringIncludes(qualityProfilesPage, 'data.sourceContext.availableSources,');
  assertStringIncludes(qualityProfilesPage, 'data.sourceContext.defaultSourceKey,');
  assertStringIncludes(
    qualityProfilesPage,
    'localStorage.setItem(sourceFilterStorageKey, JSON.stringify(selectedSourceKeys));'
  );
});

Deno.test('source badge visibility and zero-result empty-state invariants stay wired to source context', async () => {
  const customFormatsPage = await readFixture('../../routes/custom-formats/[databaseId]/+page.svelte');
  const qualityProfilesPage = await readFixture('../../routes/quality-profiles/[databaseId]/+page.svelte');
  const trashGuideSourcesComponent = await readFixture(
    '../../routes/arr/[id]/sync/components/TrashGuideSources.svelte'
  );

  assertStringIncludes(customFormatsPage, '$: showSourceBadges = data.sourceContext.showAllSourcesTab;');
  assertMatch(customFormatsPage, /<TableView[\s\S]*\{showSourceBadges\}/);
  assertMatch(customFormatsPage, /<CardView[\s\S]*\{showSourceBadges\}/);

  assertMatch(qualityProfilesPage, /<TableView[\s\S]*showSourceBadges=\{data\.sourceContext\.showAllSourcesTab\}/);
  assertMatch(qualityProfilesPage, /<CardView[\s\S]*showSourceBadges=\{data\.sourceContext\.showAllSourcesTab\}/);

  assertStringIncludes(customFormatsPage, 'No custom formats match your selected sources');
  assertStringIncludes(customFormatsPage, 'Clear source filters');
  assertStringIncludes(qualityProfilesPage, 'No quality profiles match your selected sources');
  assertStringIncludes(trashGuideSourcesComponent, 'No TRaSH sources match your current filter');
  assertStringIncludes(trashGuideSourcesComponent, 'No enabled TRaSH Guide sources are linked for this instance type.');
});

Deno.test(
  'manual TRaSH sync enqueue correlates the handler run to the minted runToken and carries source identity (#238 AC1/AC2/AC4)',
  async () => {
    const restores: Restore[] = [];
    const source = createTrashGuideSourceRecord(501, 'TRaSH Radarr Main', 'radarr');
    const store: SyncQueueStore = { slot: undefined, history: [], nextQueueId: 7001 };
    installSyncQueueHarness(store, source, restores);
    patchTarget(
      trashGuideManager,
      'checkForUpdates',
      (async () => ({
        hasUpdates: true,
        commitsBehind: 3,
        commitsAhead: 0,
        latestRemoteCommit: 'remote-sha',
        currentLocalCommit: 'local-sha',
      })) as typeof trashGuideManager.checkForUpdates,
      restores
    );
    patchTarget(
      trashGuideManager,
      'sync',
      (async () => ({
        success: true,
        commitsBehind: 3,
        parseStatus: 'success',
        parsedFiles: 42,
        failedFiles: 0,
        activeOperations: 7,
        removedEntities: 2,
        renamedEntities: 1,
      })) as typeof trashGuideManager.sync,
      restores
    );

    try {
      const enqueued = enqueueManualTrashGuideSourceSync(501);
      assertEquals(enqueued.status, 'queued');
      const runToken = enqueued.runToken;
      assert(runToken.length > 0);

      // AC2: the POST view resolves source identity directly off the live source.
      assertEquals(enqueued.view.sourceName, 'TRaSH Radarr Main');
      assertEquals(enqueued.view.arrType, 'radarr');
      assertEquals(enqueued.view.current?.runToken, runToken);

      // The queue slot minted the token BEFORE any run-history row exists (#238 correlation-first).
      const slot = store.slot;
      assertExists(slot);
      assertEquals(slot.payload.runToken, runToken);

      // Drive the real registered handler with the enqueued slot: it must preserve the same token.
      const handler = jobQueueRegistry.get('trashguide.sync');
      assertExists(handler);
      const result = await handler(slot);
      const evidence = parseTrashGuideSyncRunEvidence(result.output ?? null);
      assertExists(evidence);
      assertEquals(evidence.status, 'success');
      assertEquals(evidence.runToken, runToken);

      // AC2: terminal evidence carries the source id + name + arr type.
      assertEquals(evidence.source.id, 501);
      assertEquals(evidence.source.name, 'TRaSH Radarr Main');
      assertEquals(evidence.source.arrType, 'radarr');

      // AC1/AC4: persist the terminal run and confirm the link lands on exactly ONE run by id.
      store.history = [createRunHistoryRecord(slot.id, evidence)];
      const view = getTrashGuideSyncStatus(501);
      assertEquals(view.queueId, 7001);
      assertEquals(view.latestRun?.id, 9000);
      assertEquals(view.latestRun?.evidence?.runToken, runToken);
      assertEquals(view.sourceName, 'TRaSH Radarr Main');
      assertEquals(view.arrType, 'radarr');
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test('an already-running TRaSH sync enqueue dedupes onto the SAME runToken and slot (#238 AC1/AC4)', () => {
  const restores: Restore[] = [];
  const source = createTrashGuideSourceRecord(612, 'TRaSH Sonarr Active', 'sonarr');
  const runToken = 'run-token-in-flight-01';
  const runningSlot = createQueueRecord(
    612,
    {
      sourceId: 612,
      trigger: 'manual',
      requestedAt: '2026-07-10T00:00:00.000Z',
      runToken,
      sourceName: 'TRaSH Sonarr Active',
      sourceArrType: 'sonarr',
    },
    { id: 7002, status: 'running', startedAt: '2026-07-10T00:00:01.000Z', attempts: 1 }
  );
  const store: SyncQueueStore = { slot: runningSlot, history: [], nextQueueId: 7999 };
  installSyncQueueHarness(store, source, restores);

  try {
    const result = enqueueManualTrashGuideSourceSync(612);
    assertEquals(result.status, 'already_running');
    assertEquals(result.runToken, runToken);
    assertEquals(result.view.current?.status, 'running');
    assertEquals(result.view.current?.runToken, runToken);
    // Dedupe must not mint a second token or a second slot id.
    assertEquals(store.slot?.id, 7002);
  } finally {
    restoreAll(restores);
  }
});

Deno.test(
  'a failed manual TRaSH sync surfaces safe typed failure evidence with recovery + retryable (#238 AC3)',
  async () => {
    const restores: Restore[] = [];
    const source = createTrashGuideSourceRecord(733, 'TRaSH Radarr Net', 'radarr');
    const store: SyncQueueStore = { slot: undefined, history: [], nextQueueId: 7003 };
    installSyncQueueHarness(store, source, restores);
    patchTarget(
      trashGuideManager,
      'checkForUpdates',
      (async () => {
        throw new Error('Could not resolve host trash.invalid');
      }) as typeof trashGuideManager.checkForUpdates,
      restores
    );

    try {
      const enqueued = enqueueManualTrashGuideSourceSync(733);
      const runToken = enqueued.runToken;
      const slot = store.slot;
      assertExists(slot);

      const handler = jobQueueRegistry.get('trashguide.sync');
      assertExists(handler);
      const result = await handler(slot);
      assertEquals(result.status, 'failure');
      // Safe evidence: the raw hostname from the thrown error never leaks into persisted output.
      assert(!(result.output ?? '').includes('trash.invalid'));

      const evidence = parseTrashGuideSyncRunEvidence(result.output ?? null);
      assertExists(evidence);
      assertEquals(evidence.runToken, runToken);
      assertExists(evidence.failure);
      assertEquals(evidence.failure.code, 'network');
      assertEquals(evidence.failure.message, 'Could not reach the TRaSH repository.');
      assert(evidence.failure.recoveryAction.length > 0);
      assertEquals(evidence.retry.retryable, true);

      // The GET status resolver re-surfaces the same safe failure message + recovery + retryable flag.
      store.history = [createRunHistoryRecord(slot.id, evidence)];
      const view = getTrashGuideSyncStatus(733);
      assertEquals(view.latestRun?.evidence?.failure?.message, 'Could not reach the TRaSH repository.');
      assertEquals(view.latestRun?.evidence?.failure?.recoveryAction, evidence.failure.recoveryAction);
      assertEquals(view.latestRun?.evidence?.retry.retryable, true);
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test(
  'the TRaSH source run panel wires recoveryAction, retryable, a Retry control, and fetched/applied counts (#238 AC3)',
  async () => {
    const trashSourcePanel = await readFixture('../../routes/databases/trash/[id]/+page.svelte');

    assertStringIncludes(trashSourcePanel, 'terminalEvidence.failure.recoveryAction');
    assertStringIncludes(trashSourcePanel, 'terminalEvidence.retry.retryable');
    assertStringIncludes(trashSourcePanel, 'Retry sync');
    assertStringIncludes(trashSourcePanel, 'terminalEvidence.counts.parsedFiles');
    assertStringIncludes(trashSourcePanel, 'Files fetched');
    assertStringIncludes(trashSourcePanel, 'Changes applied');
    assertStringIncludes(trashSourcePanel, 'activeOperations');
    // The panel resolves its run strictly by the initiating runToken, never by timestamp.
    assertStringIncludes(trashSourcePanel, 'runView.latestRun?.evidence?.runToken === runToken');
  }
);

Deno.test('a since-deleted TRaSH source keeps its identity from the durable queue snapshot (#238 AC5)', () => {
  const restores: Restore[] = [];
  const snapshotSlot = createQueueRecord(
    777,
    {
      sourceId: 777,
      trigger: 'manual',
      requestedAt: '2026-07-10T00:00:00.000Z',
      runToken: 'run-token-deleted-01',
      sourceName: 'Deleted TRaSH Radarr',
      sourceArrType: 'radarr',
    },
    { id: 7005, status: 'queued' }
  );
  const store: SyncQueueStore = { slot: snapshotSlot, history: [], nextQueueId: 7999 };
  // getById resolves to undefined: the source row has been hard-deleted.
  installSyncQueueHarness(store, undefined, restores);

  try {
    const view = getTrashGuideSyncStatus(777);
    assertEquals(view.sourceId, 777);
    assertEquals(view.sourceName, 'Deleted TRaSH Radarr');
    assertEquals(view.arrType, 'radarr');
    assertEquals(view.current?.runToken, 'run-token-deleted-01');
  } finally {
    restoreAll(restores);
  }
});

Deno.test('the arr sync TRaSH sources surface links each source to its run-detail route (#238)', async () => {
  const trashGuideSourcesComponent = await readFixture(
    '../../routes/arr/[id]/sync/components/TrashGuideSources.svelte'
  );

  assertStringIncludes(trashGuideSourcesComponent, '/databases/trash/${source.sourceId}');
  assertStringIncludes(trashGuideSourcesComponent, 'View sync run');
});

Deno.test('the arr sync surface unwraps the form-action envelope before reading the source label (#238)', async () => {
  const component = await readFixture('../../routes/arr/[id]/sync/components/TrashGuideSources.svelte');

  // The source-labeled toast reads action data, which SvelteKit wraps in an ActionResult envelope;
  // it must deserialize and branch on result.type before reading `.data.view`, or the label silently
  // collapses to the generic fallback. These guards catch a regression back to raw `response.json().view`.
  assertStringIncludes(component, "import { deserialize } from '$app/forms'");
  assertStringIncludes(component, 'deserialize(await response.text())');
  assertStringIncludes(component, "result.type === 'success'");
  assertStringIncludes(component, 'TRaSH sync queued for');
});
