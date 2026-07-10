import { assert, assertEquals, assertMatch } from '@std/assert';
import {
  _handleSyncPreviewCreateRequest,
  POST as createPreviewPost,
  type SyncPreviewCreateDependencies,
} from '../../routes/api/v1/sync/preview/+server.ts';
import {
  _handleSyncPreviewApplyRequest,
  POST as applyPreviewPost,
  type SyncPreviewApplyDependencies,
} from '../../routes/api/v1/sync/preview/[previewId]/apply/+server.ts';
import type { components } from '$api/v1.d.ts';
import { type ArrInstance, arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';
import {
  PREVIEW_STATUS_GENERATING,
  PREVIEW_STATUS_READY,
  previewStore,
  type SyncPreviewCreateInput,
} from '../../lib/server/sync/preview/store.ts';
import {
  buildSyncPreviewReviewBinding,
  buildSyncPreviewTargetHash,
} from '../../lib/server/sync/preview/reviewBinding.ts';
import {
  PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS,
  PREVIEW_MAX_SNAPSHOTS,
  PREVIEW_REQUEST_BODY_LIMIT_BYTES,
  registerPreviewCreateAttempt,
  resetPreviewCreateRateLimitForTests,
} from '../../lib/server/sync/preview/limits.ts';
import type { GeneratePreviewResult } from '../../lib/server/sync/preview/orchestrator.ts';
import { classifyPreviewFailure } from '../../lib/server/sync/preview/failureReason.ts';
import type { SyncPreviewFailureReason, SyncPreviewResult } from '../../lib/server/sync/preview/types.ts';
import type { BaseArrClient } from '../../lib/server/utils/arr/base.ts';
import { HttpError } from '../../lib/server/utils/http/types.ts';
import type { JobFailureCode } from '$shared/jobs/evidence.ts';

const INSTANCE_ID = 7001;
const now = '2026-02-21T00:00:00.000Z';

// A typed, safe section failure used to seed snapshots. Redaction is proven separately; here it
// just stands in for "this section failed to generate" without any raw text.
const SAMPLE_FAILURE: SyncPreviewFailureReason = {
  code: 'internalError',
  message: 'An unexpected error occurred while processing the preview.',
  recoveryAction: 'Try again; if the problem persists, check the server logs for details.',
};

// Secret-shaped and arbitrary free-form strings that must NEVER reach a response body or the store.
const SECRET_API_KEY = 'sk-live-DEADBEEFCAFEBABE0123456789';
const SECRET_HEX = 'deadbeefcafebabedeadbeefcafebabe';
const SECRET_MIX = `GET http://radarr.local/api/v3/qualityprofile?apikey=${SECRET_API_KEY} failed (X-Api-Key: ${SECRET_HEX}) password=hunter2`;
const FREE_FORM =
  'internal stacktrace at orchestrator.ts:255 host 10.1.2.3 /home/yandy/.env DATABASE_URL=postgres://u:p@h';
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  SECRET_API_KEY,
  SECRET_HEX,
  'hunter2',
  FREE_FORM,
  '10.1.2.3',
  'DATABASE_URL',
  '/home/yandy/.env',
];

/** Assert that no forbidden (secret-shaped or free-form) substring appears anywhere in `value`. */
function assertNoLeak(value: unknown, label: string): void {
  const serialized = JSON.stringify(value) ?? '';
  for (const secret of FORBIDDEN_SUBSTRINGS) {
    assert(!serialized.includes(secret), `${label} leaked forbidden substring: ${secret}`);
  }
}

/** Assert a value is a well-formed, closed SyncPreviewFailureReason (typed code + safe strings). */
const CLOSED_FAILURE_CODES: ReadonlySet<string> = new Set([
  'unreachable',
  'timeout',
  'unauthorized',
  'notFound',
  'rejected',
  'serverError',
  'sectionErrors',
  'executionFailed',
  'stale',
  'internalError',
]);

function assertTypedFailure(failure: unknown, label: string): SyncPreviewFailureReason {
  assert(failure !== null && typeof failure === 'object', `${label}: failure must be an object`);
  const reason = failure as Record<string, unknown>;
  assert(typeof reason.code === 'string' && CLOSED_FAILURE_CODES.has(reason.code), `${label}: code must be closed`);
  assert(typeof reason.message === 'string' && reason.message.length > 0, `${label}: message must be a safe string`);
  assert(
    typeof reason.recoveryAction === 'string' && reason.recoveryAction.length > 0,
    `${label}: recoveryAction must be a safe string`
  );
  return reason as unknown as SyncPreviewFailureReason;
}

function createPreviewCreateRequest(instanceId: number = INSTANCE_ID): Request {
  return new Request('http://localhost/api/v1/sync/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId }),
  });
}

function createDependencies(
  generatePreview: SyncPreviewCreateDependencies['generatePreview']
): SyncPreviewCreateDependencies {
  const client = { close: () => undefined } as unknown as BaseArrClient;
  return {
    generatePreview,
    getInstanceById: () => createArrInstanceFixture(),
    getReviewClient: (_type, instance) =>
      Promise.resolve({
        client,
        credentialIdentity: {
          fingerprint: instance.api_key_fingerprint!,
          keyVersion: 'legacy',
          revision: instance.updated_at,
        },
      }),
    now: () => Date.now(),
  };
}

type ErrorResponse = components['schemas']['ErrorResponse'];
type SyncPreviewApplyResponse = components['schemas']['SyncPreviewApplyResponse'];
type SyncPreviewApplyErrorResponse = components['schemas']['SyncPreviewApplyErrorResponse'];
type ReviewedSyncJobResult = Awaited<ReturnType<SyncPreviewApplyDependencies['executeReviewedSyncJob']>>;
type SyncJobResult = Extract<ReviewedSyncJobResult, { kind: 'executed' }>['result'];

function createArrInstanceFixture(): ArrInstance {
  return {
    id: INSTANCE_ID,
    name: 'Preview Test Instance',
    type: 'radarr',
    url: 'http://radarr.local',
    external_url: null,
    api_key_fingerprint: 'credential-v1',
    api_key: '',
    tags: null,
    enabled: 1,
    source: 'ui',
    created_at: now,
    updated_at: now,
  };
}

function createSnapshotInput(id: string): SyncPreviewCreateInput {
  return {
    id,
    instanceId: INSTANCE_ID,
    instanceName: 'Preview Test Instance',
    arrType: 'radarr',
    status: PREVIEW_STATUS_READY,
    failure: null,
    sections: ['qualityProfiles', 'delayProfiles'],
    sectionOutcomes: [
      {
        section: 'qualityProfiles',
        failure: null,
        skipped: false,
      },
      {
        section: 'delayProfiles',
        failure: SAMPLE_FAILURE,
        skipped: false,
      },
    ],
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: {
      totalCreates: 0,
      totalUpdates: 0,
      totalDeletes: 0,
      totalUnchanged: 0,
    },
  };
}

function createApplyRequest(previewId: string, body: string = '{}'): Request {
  return new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

async function createReviewedSnapshot(id: string, createdAtMs: number = Date.now()): Promise<void> {
  const input = createSnapshotInput(id);
  previewStore.create({ ...input, status: PREVIEW_STATUS_GENERATING }, createdAtMs);
  const binding = await buildSyncPreviewReviewBinding({
    instanceId: input.instanceId,
    arrType: input.arrType,
    target: {
      url: 'http://preview.test',
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'key-v1',
      credentialRevision: 'revision-v1',
    },
    sections: ['qualityProfiles'],
    sectionConfigs: { qualityProfiles: { selections: ['Reviewed HD'] } },
    evidence: [
      {
        section: 'qualityProfiles',
        pcd: { desired: 'reviewed' },
        arr: { current: 'reviewed' },
        plan: { action: 'update' },
      },
    ],
  });
  const { status: _status, ...patch } = input;
  previewStore.completeGeneration(id, patch, binding, createdAtMs);
}

async function createOrderedReviewedSnapshot(
  id: string,
  sections: readonly ('qualityProfiles' | 'delayProfiles' | 'mediaManagement')[],
  createdAtMs: number = Date.now()
): Promise<void> {
  const input = {
    ...createSnapshotInput(id),
    sections,
    sectionOutcomes: sections.map((section) => ({
      section,
      failure: null,
      skipped: false,
    })),
  };
  previewStore.create({ ...input, status: PREVIEW_STATUS_GENERATING }, createdAtMs);
  const binding = await buildSyncPreviewReviewBinding({
    instanceId: input.instanceId,
    arrType: input.arrType,
    target: {
      url: 'http://preview.test',
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'key-v1',
      credentialRevision: 'revision-v1',
    },
    sections,
    sectionConfigs: {},
    evidence: sections.map((section) => ({
      section,
      pcd: { section, desired: 'reviewed' },
      arr: { section, current: 'reviewed' },
      plan: { section, action: 'update' },
    })),
  });
  const { status: _status, ...patch } = input;
  previewStore.completeGeneration(id, patch, binding, createdAtMs);
}

// A returned job failure now carries a typed `failureCode` (issue #237) — there is no raw `error`
// channel on JobHandlerResult/SyncJobResult, so the input shape mirrors that discriminated union.
type DependenciesResult =
  | {
      status: 'failure';
      failureCode: JobFailureCode;
      output?: string;
      outcomes?: SyncJobResult['outcomes'];
      syncHistoryId?: SyncJobResult['syncHistoryId'];
      rescheduleAt?: string | null;
    }
  | {
      status: 'success' | 'skipped' | 'cancelled';
      output?: string;
      outcomes?: SyncJobResult['outcomes'];
      syncHistoryId?: SyncJobResult['syncHistoryId'];
      rescheduleAt?: string | null;
    };

function dependenciesReturning(result: DependenciesResult, nowMs: number = Date.now()): SyncPreviewApplyDependencies {
  const full = { outcomes: [], syncHistoryId: null, ...result } as SyncJobResult;
  return {
    getSectionsInProgress: () => [],
    executeReviewedSyncJob: () => Promise.resolve({ kind: 'executed', result: full }),
    now: () => nowMs,
  };
}

Deno.test('sync preview apply success body matches the generated response contract', async () => {
  const previewId = `preview-apply-success-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);
  let execution:
    | {
        instanceId: number;
        sections: readonly string[];
        source: string | undefined;
        previewId: string | undefined;
        arrType: string;
        sectionConfigs: unknown;
      }
    | undefined;

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      {
        getSectionsInProgress: () => [],
        executeReviewedSyncJob: (input) => {
          execution = {
            instanceId: input.binding.instanceId,
            sections: input.sections,
            source: input.source,
            previewId: input.previewId,
            arrType: input.binding.arrType,
            sectionConfigs: input.binding.sectionConfigs,
          };
          return Promise.resolve({
            kind: 'executed',
            result: {
              status: 'success',
              output: 'Synced 2 entities',
              outcomes: [
                {
                  section: 'qualityProfiles',
                  arrType: 'radarr',
                  entityType: 'qualityProfile',
                  name: 'HD-1080p',
                  action: 'create',
                  status: 'success',
                  remoteId: '42',
                  reason: null,
                },
              ],
              syncHistoryId: 555,
            },
          });
        },
        now: Date.now,
      }
    );

    assertEquals(response.status, 200);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload, {
      success: true,
      results: {
        status: 'success',
        output: 'Synced 2 entities',
      },
      staleWarning: null,
      outcomes: [
        {
          section: 'qualityProfiles',
          arrType: 'radarr',
          entityType: 'qualityProfile',
          name: 'HD-1080p',
          action: 'create',
          status: 'success',
          remoteId: '42',
          reason: null,
        },
      ],
      syncHistoryId: 555,
    });
    // Hole 1: the reviewed preview id is threaded into the run for plan↔run correlation.
    assertEquals(execution, {
      instanceId: INSTANCE_ID,
      sections: ['qualityProfiles'],
      source: 'manual',
      previewId,
      arrType: 'radarr',
      sectionConfigs: { qualityProfiles: { selections: ['Reviewed HD'] } },
    });
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply maps every reviewed invalidation and terminally fails the receipt', async () => {
  const cases = [
    { reason: 'pcd_drift', evidence: ['pcd'] },
    { reason: 'arr_drift', evidence: ['arr'] },
    { reason: 'pcd_and_arr_drift', evidence: ['pcd', 'arr'] },
    { reason: 'scope_drift', evidence: [] },
    { reason: 'unverifiable_review', evidence: [] },
  ] as const;

  for (const testCase of cases) {
    const previewId = `preview-apply-${testCase.reason}-${crypto.randomUUID()}`;
    await createReviewedSnapshot(previewId);
    try {
      const response = await _handleSyncPreviewApplyRequest(
        previewId,
        createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
        {
          getSectionsInProgress: () => [],
          executeReviewedSyncJob: () =>
            Promise.resolve({
              kind: 'invalidated',
              reason: testCase.reason,
              changedEvidence: testCase.evidence,
              changedSections: ['qualityProfiles'],
              outcomes: [],
              syncHistoryId: null,
            }),
          now: Date.now,
        }
      );

      assertEquals(response.status, 422);
      const payload = (await response.json()) as components['schemas']['SyncPreviewApplyInvalidatedResponse'];
      assertEquals(payload.code, testCase.reason);
      assertEquals(payload.changedEvidence, [...testCase.evidence]);
      assertEquals(payload.changedSections, ['qualityProfiles']);
      assertEquals(payload.regenerateRequired, true);
      assertMatch(payload.error, /Nothing was applied.*Generate and review a new preview/i);
      assertEquals(previewStore.get(previewId)?.status, 'failed');
      assertEquals('binding' in payload, false);
      assertEquals('sectionConfigs' in payload, false);
    } finally {
      previewStore.delete(previewId);
    }
  }
});

Deno.test('sync preview apply releases a reviewed DB claim conflict back to ready', async () => {
  const previewId = `preview-apply-claim-conflict-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);
  try {
    const response = await _handleSyncPreviewApplyRequest(previewId, createApplyRequest(previewId), {
      getSectionsInProgress: () => [],
      executeReviewedSyncJob: () =>
        Promise.resolve({
          kind: 'claim_conflict',
          outcomes: [],
          syncHistoryId: null,
        }),
      now: Date.now,
    });
    assertEquals(response.status, 409);
    assertEquals(previewStore.get(previewId)?.status, 'ready');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply rejects reordered reviewed scopes before execution', async () => {
  const reviewedSections = ['qualityProfiles', 'delayProfiles', 'mediaManagement'] as const;
  const reorderedScopes = [
    ['mediaManagement', 'delayProfiles', 'qualityProfiles'],
    ['mediaManagement', 'qualityProfiles'],
  ] as const;

  for (const sections of reorderedScopes) {
    const previewId = `preview-apply-reordered-${crypto.randomUUID()}`;
    await createOrderedReviewedSnapshot(previewId, reviewedSections);
    let executionCount = 0;
    try {
      const response = await _handleSyncPreviewApplyRequest(
        previewId,
        createApplyRequest(previewId, JSON.stringify({ sections })),
        {
          getSectionsInProgress: () => [],
          executeReviewedSyncJob: () => {
            executionCount += 1;
            return Promise.resolve({
              kind: 'executed',
              result: { status: 'success', outcomes: [], syncHistoryId: null },
            });
          },
          now: Date.now,
        }
      );

      assertEquals(response.status, 422);
      const payload = (await response.json()) as components['schemas']['SyncPreviewApplyInvalidatedResponse'];
      assertEquals(payload.code, 'scope_drift');
      assertEquals(payload.changedSections, [...sections]);
      assertEquals(executionCount, 0);
    } finally {
      previewStore.delete(previewId);
    }
  }
});

Deno.test('sync preview apply preserves an ordered reviewed subset through execution', async () => {
  const previewId = `preview-apply-ordered-subset-${crypto.randomUUID()}`;
  await createOrderedReviewedSnapshot(previewId, ['qualityProfiles', 'delayProfiles', 'mediaManagement']);
  let executedSections: readonly string[] | null = null;
  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles', 'mediaManagement'] })),
      {
        getSectionsInProgress: () => [],
        executeReviewedSyncJob: (input) => {
          executedSections = input.sections;
          return Promise.resolve({
            kind: 'executed',
            result: { status: 'success', outcomes: [], syncHistoryId: null },
          });
        },
        now: Date.now,
      }
    );

    assertEquals(response.status, 200);
    assertEquals(executedSections, ['qualityProfiles', 'mediaManagement']);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply sanitizes unexpected execution failures and does not strand applying', async () => {
  const previewId = `preview-apply-unexpected-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);
  try {
    const response = await _handleSyncPreviewApplyRequest(previewId, createApplyRequest(previewId), {
      getSectionsInProgress: () => [],
      executeReviewedSyncJob: () => Promise.reject(new Error('secret upstream response body')),
      now: Date.now,
    });
    assertEquals(response.status, 500);
    assertTypedFailure((await response.json()).failure, 'unexpected apply failure');
    assertEquals(previewStore.get(previewId)?.status, 'failed');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply skipped body matches the generated success contract', async () => {
  const previewId = `preview-apply-skipped-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      dependenciesReturning({
        status: 'skipped',
        output: 'No changes required',
      })
    );

    assertEquals(response.status, 200);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload, {
      success: true,
      results: {
        status: 'skipped',
        output: 'No changes required',
      },
      staleWarning: null,
      outcomes: [],
      syncHistoryId: null,
    });
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply failed body matches the generated coarse result contract', async () => {
  const previewId = `preview-apply-job-failed-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      // Gap 5: a partial/failed run still carries confirmed outcomes + the durable history id.
      dependenciesReturning({
        status: 'failure',
        failureCode: 'upstream',
        outcomes: [
          {
            section: 'qualityProfiles',
            arrType: 'radarr',
            entityType: 'customFormat',
            name: 'HDR10',
            action: 'create',
            status: 'failed',
            remoteId: null,
            reason: 'The Arr instance rejected the request (HTTP 400).',
          },
        ],
        syncHistoryId: 909,
      })
    );

    assertEquals(response.status, 500);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload, {
      success: false,
      results: {
        status: 'failure',
        output: '',
        // The raw job error ('Arr rejected the update') is redacted to a typed, safe reason.
        failure: {
          code: 'executionFailed',
          message: 'The sync run did not complete successfully.',
          recoveryAction: 'Review the per-entity outcomes, resolve the reported issues, then apply again.',
        },
      },
      staleWarning: null,
      outcomes: [
        {
          section: 'qualityProfiles',
          arrType: 'radarr',
          entityType: 'customFormat',
          name: 'HDR10',
          action: 'create',
          status: 'failed',
          remoteId: null,
          reason: 'The Arr instance rejected the request (HTTP 400).',
        },
      ],
      syncHistoryId: 909,
    });
    // The raw aggregate job error must never reach the response body.
    assert(!JSON.stringify(payload).includes('Arr rejected the update'));
    // The failed outcome and its durable id must survive the failure response — never dropped.
    assertEquals(payload.outcomes.length, 1);
    assertEquals(payload.syncHistoryId, 909);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply includes the stale warning in the generated response shape', async () => {
  const previewId = `preview-apply-stale-warning-${crypto.randomUUID()}`;
  const createdAtMs = Date.now();
  await createReviewedSnapshot(previewId, createdAtMs);

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      dependenciesReturning({ status: 'success', output: 'Synced' }, createdAtMs + 6 * 60 * 1000 + 30 * 1000)
    );

    assertEquals(response.status, 200);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(payload.staleWarning, 'Preview is 6 minute(s) old.');
    assertEquals(payload.results.status, 'success');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply stale-blocked body matches the generated error contract', async () => {
  const previewId = `preview-apply-stale-blocked-${crypto.randomUUID()}`;
  const createdAtMs = Date.now();
  previewStore.create(createSnapshotInput(previewId), createdAtMs);
  let executionCount = 0;

  try {
    const response = await _handleSyncPreviewApplyRequest(previewId, createApplyRequest(previewId), {
      getSectionsInProgress: () => [],
      executeReviewedSyncJob: () => {
        executionCount++;
        return Promise.resolve({
          kind: 'executed',
          result: { status: 'success', outcomes: [], syncHistoryId: null },
        });
      },
      now: () => createdAtMs + 31 * 60 * 1000,
    });

    assertEquals(response.status, 422);
    const payload = (await response.json()) as SyncPreviewApplyErrorResponse;
    assertEquals(payload, {
      failure: {
        code: 'stale',
        message: 'This preview is too old to apply safely.',
        recoveryAction: 'Regenerate the preview, then apply again.',
      },
      staleWarning: 'Preview is 31 minute(s) old.',
    });
    assertEquals(executionCount, 0);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply blocks when preview had section-generation errors', async () => {
  const previewId = `preview-apply-section-errors-${crypto.randomUUID()}`;
  previewStore.create(
    {
      ...createSnapshotInput(previewId),
      failure: SAMPLE_FAILURE,
    },
    Date.now()
  );

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sections: ['qualityProfiles'] }),
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 409);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /section-generation errors.*Regenerate/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply rejects explicitly requested ineligible sections', async () => {
  const previewId = `preview-apply-failed-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sections: ['delayProfiles'],
        }),
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 409);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /failed preview generation/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply blocks when no sections were successfully previewed', async () => {
  const previewId = `preview-apply-none-eligible-${crypto.randomUUID()}`;
  previewStore.create(
    {
      ...createSnapshotInput(previewId),
      sectionOutcomes: [
        {
          section: 'qualityProfiles',
          failure: SAMPLE_FAILURE,
          skipped: false,
        },
        {
          section: 'delayProfiles',
          failure: null,
          skipped: true,
        },
      ],
    },
    Date.now()
  );

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /No successfully previewed sections/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply rejects oversized request payloads', async () => {
  const previewId = `preview-apply-oversized-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const oversized = 'x'.repeat(PREVIEW_REQUEST_BODY_LIMIT_BYTES + 16);
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: oversized,
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /exceeds .* bytes/i);
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply rejects malformed JSON body', async () => {
  const previewId = `preview-apply-malformed-${crypto.randomUUID()}`;
  previewStore.create(createSnapshotInput(previewId), Date.now());

  try {
    const response = await applyPreviewPost({
      params: { previewId },
      request: new Request(`http://localhost/api/v1/sync/preview/${previewId}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"sections": ["qualityProfiles"]',
      }),
    } as unknown as Parameters<typeof applyPreviewPost>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as ErrorResponse;
    assertEquals(payload.error, 'Invalid JSON body');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview create rejects oversized request payloads', async () => {
  const oversizedBody = 'x'.repeat(PREVIEW_REQUEST_BODY_LIMIT_BYTES + 16);
  const response = await createPreviewPost({
    request: new Request('http://localhost/api/v1/sync/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversizedBody,
    }),
  } as unknown as Parameters<typeof createPreviewPost>[0]);

  assertEquals(response.status, 400);
  const payload = (await response.json()) as { error: string };
  assertMatch(payload.error, /exceeds .* bytes/i);
});

Deno.test('sync preview create rejects partial transient section configs before instance lookup', async () => {
  const invalidConfigs = [
    { delayProfiles: { databaseId: 234 } },
    { metadataProfiles: { databaseId: 234 } },
    {
      mediaManagement: {
        namingDatabaseId: 234,
        namingConfigName: null,
        qualityDefinitionsDatabaseId: null,
        qualityDefinitionsConfigName: null,
        mediaSettingsDatabaseId: null,
        mediaSettingsConfigName: null,
      },
    },
  ];

  for (const sectionConfigs of invalidConfigs) {
    const response = await createPreviewPost({
      request: new Request('http://localhost/api/v1/sync/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: INSTANCE_ID, sectionConfigs }),
      }),
    } as unknown as Parameters<typeof createPreviewPost>[0]);

    assertEquals(response.status, 400);
    const payload = (await response.json()) as ErrorResponse;
    assertMatch(payload.error, /Invalid .* section config/);
  }
});

Deno.test('sync preview create enforces per-instance rate limits', async () => {
  const originalGetById = arrInstancesQueries.getById;
  const instance = createArrInstanceFixture();
  resetPreviewCreateRateLimitForTests();

  arrInstancesQueries.getById = ((id: number) =>
    id === instance.id ? instance : undefined) as typeof arrInstancesQueries.getById;

  try {
    const nowMs = Date.now();
    for (let index = 0; index < PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS; index++) {
      registerPreviewCreateAttempt(instance.id, nowMs);
    }

    const response = await createPreviewPost({
      request: new Request('http://localhost/api/v1/sync/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: instance.id }),
      }),
    } as unknown as Parameters<typeof createPreviewPost>[0]);

    assertEquals(response.status, 429);
    const payload = (await response.json()) as { error: string };
    assertMatch(payload.error, /Too many preview requests/i);
  } finally {
    resetPreviewCreateRateLimitForTests();
    arrInstancesQueries.getById = originalGetById;
  }
});

Deno.test('sync preview create enforces preview-store capacity limits', async () => {
  const originalGetById = arrInstancesQueries.getById;
  const instance = createArrInstanceFixture();
  const createdPreviewIds: string[] = [];
  resetPreviewCreateRateLimitForTests();

  arrInstancesQueries.getById = ((id: number) =>
    id === instance.id ? instance : undefined) as typeof arrInstancesQueries.getById;

  try {
    while (previewStore.getSize() < PREVIEW_MAX_SNAPSHOTS) {
      const previewId = `preview-capacity-${crypto.randomUUID()}`;
      createdPreviewIds.push(previewId);
      previewStore.create(createSnapshotInput(previewId), Date.now());
    }

    const response = await createPreviewPost({
      request: new Request('http://localhost/api/v1/sync/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: instance.id }),
      }),
    } as unknown as Parameters<typeof createPreviewPost>[0]);

    assertEquals(response.status, 429);
    const payload = (await response.json()) as { error: string };
    assertMatch(payload.error, /at capacity/i);
  } finally {
    for (const previewId of createdPreviewIds) {
      previewStore.delete(previewId);
    }
    resetPreviewCreateRateLimitForTests();
    arrInstancesQueries.getById = originalGetById;
  }
});

// --- Issue #235: failure-evidence redaction ------------------------------------------------

Deno.test('sync preview creation binds the same credential lease used for generation', async () => {
  resetPreviewCreateRateLimitForTests();
  let authoritativeCredential = 'credential-v1';
  let leaseCount = 0;
  let closeCount = 0;
  const client = { close: () => (closeCount += 1) } as unknown as BaseArrClient;
  const deps = {
    ...createDependencies(() => {
      assertEquals(authoritativeCredential, 'credential-v2');
      return Promise.resolve({
        preview: {
          instanceId: INSTANCE_ID,
          instanceName: 'Preview Test Instance',
          arrType: 'radarr' as const,
          status: 'ready' as const,
          createdAtMs: Date.now(),
          sections: ['qualityProfiles' as const],
          sectionOutcomes: [{ section: 'qualityProfiles' as const, failure: null, skipped: false }],
          qualityProfiles: { section: 'qualityProfiles' as const, customFormats: [], qualityProfiles: [] },
          delayProfiles: null,
          mediaManagement: null,
          metadataProfiles: null,
          summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
        },
        reviewContext: {
          sectionConfigs: {},
          evidence: [
            {
              section: 'qualityProfiles' as const,
              pcd: { desired: 1 },
              arr: { current: 1 },
              plan: { action: 'unchanged' },
            },
          ],
          preparedExecutionContexts: {},
        },
      });
    }),
    getReviewClient: () => {
      leaseCount += 1;
      authoritativeCredential = 'credential-v2';
      return Promise.resolve({
        client,
        credentialIdentity: {
          fingerprint: 'credential-v1',
          keyVersion: 'legacy',
          revision: now,
        },
      });
    },
  };

  const response = await _handleSyncPreviewCreateRequest(createPreviewCreateRequest(), deps);
  const payload = (await response.json()) as SyncPreviewResult;
  try {
    assertEquals(response.status, 200);
    const claim = previewStore.claimReadyForApply(payload.id, ['qualityProfiles']);
    assert(claim.ok);
    const expectedTargetHash = await buildSyncPreviewTargetHash({
      instanceId: INSTANCE_ID,
      arrType: 'radarr',
      target: {
        url: 'http://radarr.local',
        credentialFingerprint: 'credential-v1',
        credentialKeyVersion: 'legacy',
        credentialRevision: now,
      },
    });
    assertEquals(claim.binding.targetHash, expectedTargetHash);
    previewStore.releaseApplyClaim(claim.receipt);
    assertEquals(leaseCount, 1);
    assertEquals(closeCount, 1);
  } finally {
    previewStore.delete(payload.id);
    resetPreviewCreateRateLimitForTests();
  }
});

Deno.test('sync preview create redacts a secret-shaped total generation failure', async () => {
  resetPreviewCreateRateLimitForTests();
  const deps = createDependencies(() => Promise.reject(new Error(SECRET_MIX)));

  const response = await _handleSyncPreviewCreateRequest(createPreviewCreateRequest(), deps);

  assertEquals(response.status, 500);
  const payload = (await response.json()) as SyncPreviewResult;
  try {
    assertEquals(payload.status, 'failed');
    assertTypedFailure(payload.failure, 'create total-failure body');
    assertNoLeak(payload, 'create total-failure body');
    // The stored snapshot served by GET must also be redacted.
    const stored = previewStore.get(payload.id);
    assert(stored !== null, 'failed snapshot should be stored');
    assertTypedFailure(stored!.failure, 'create total-failure stored');
    assertNoLeak(stored, 'create total-failure stored');
  } finally {
    previewStore.delete(payload.id);
    resetPreviewCreateRateLimitForTests();
  }
});

Deno.test('sync preview create redacts an arbitrary free-form total generation failure', async () => {
  resetPreviewCreateRateLimitForTests();
  const deps = createDependencies(() => Promise.reject(new Error(FREE_FORM)));

  const response = await _handleSyncPreviewCreateRequest(createPreviewCreateRequest(), deps);

  assertEquals(response.status, 500);
  const payload = (await response.json()) as SyncPreviewResult;
  try {
    assertTypedFailure(payload.failure, 'create free-form body');
    assertNoLeak(payload, 'create free-form body');
    assertNoLeak(previewStore.get(payload.id), 'create free-form stored');
  } finally {
    previewStore.delete(payload.id);
    resetPreviewCreateRateLimitForTests();
  }
});

Deno.test('sync preview create preserves successful-section evidence on partial generation', async () => {
  resetPreviewCreateRateLimitForTests();
  const partial: GeneratePreviewResult = {
    instanceId: INSTANCE_ID,
    instanceName: 'Preview Test Instance',
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: Date.now(),
    sections: ['qualityProfiles', 'delayProfiles'],
    sectionOutcomes: [
      { section: 'qualityProfiles', failure: null, skipped: false },
      { section: 'delayProfiles', failure: SAMPLE_FAILURE, skipped: false },
    ],
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [
        {
          entityType: 'customFormat',
          name: 'HDR10',
          action: 'create',
          remoteId: null,
          fields: [],
        },
      ],
      qualityProfiles: [],
    },
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: {
      totalCreates: 1,
      totalUpdates: 0,
      totalDeletes: 0,
      totalUnchanged: 0,
    },
  };
  const deps = createDependencies(() =>
    Promise.resolve({
      preview: partial,
      reviewContext: {
        sectionConfigs: {},
        evidence: [
          {
            section: 'qualityProfiles',
            pcd: { desired: 'reviewed' },
            arr: { current: 'reviewed' },
            plan: { action: 'create' },
          },
        ],
        preparedExecutionContexts: {},
      },
    })
  );

  const response = await _handleSyncPreviewCreateRequest(createPreviewCreateRequest(), deps);

  assertEquals(response.status, 200);
  const payload = (await response.json()) as SyncPreviewResult;
  try {
    // Successful-section evidence survives a partial generation...
    assertEquals(payload.status, 'ready');
    assert(payload.qualityProfiles !== null, 'successful section evidence must be preserved');
    assertEquals(payload.qualityProfiles!.customFormats.length, 1);
    assertEquals(payload.summary.totalCreates, 1);
    // ...alongside a typed top-level aggregate and a typed per-section failure (never raw text).
    const topLevel = assertTypedFailure(payload.failure, 'partial top-level');
    assertEquals(topLevel.code, 'sectionErrors');
    const failedSection = payload.sectionOutcomes.find((outcome) => outcome.section === 'delayProfiles');
    assertTypedFailure(failedSection?.failure, 'partial section');
    assertNoLeak(payload, 'partial body');
    assertNoLeak(previewStore.get(payload.id), 'partial stored');
  } finally {
    previewStore.delete(payload.id);
    resetPreviewCreateRateLimitForTests();
  }
});

Deno.test('sync preview create returns a failed 500 result when every requested section fails', async () => {
  resetPreviewCreateRateLimitForTests();
  const deps = createDependencies(() =>
    Promise.resolve({
      preview: {
        instanceId: INSTANCE_ID,
        instanceName: 'Preview Test Instance',
        arrType: 'radarr',
        status: 'ready',
        createdAtMs: Date.now(),
        sections: ['qualityProfiles', 'delayProfiles'],
        sectionOutcomes: [
          {
            section: 'qualityProfiles',
            failure: SAMPLE_FAILURE,
            skipped: false,
          },
          { section: 'delayProfiles', failure: SAMPLE_FAILURE, skipped: false },
        ],
        qualityProfiles: null,
        delayProfiles: null,
        mediaManagement: null,
        metadataProfiles: null,
        summary: {
          totalCreates: 0,
          totalUpdates: 0,
          totalDeletes: 0,
          totalUnchanged: 0,
        },
      },
      reviewContext: {
        sectionConfigs: {},
        evidence: [],
        preparedExecutionContexts: {},
      },
    })
  );

  const response = await _handleSyncPreviewCreateRequest(createPreviewCreateRequest(), deps);
  assertEquals(response.status, 500);
  const payload = (await response.json()) as SyncPreviewResult;
  try {
    assertEquals(payload.status, 'failed');
    assertEquals(payload.failure?.code, 'sectionErrors');
    assertEquals(payload.sectionOutcomes.length, 2);
    assertEquals(
      payload.sectionOutcomes.every((outcome) => outcome.failure !== null),
      true
    );
    assertEquals(previewStore.get(payload.id)?.status, 'failed');
  } finally {
    previewStore.delete(payload.id);
    resetPreviewCreateRateLimitForTests();
  }
});

Deno.test('sync preview create returns a ready non-applicable result when no sync config exists', async () => {
  resetPreviewCreateRateLimitForTests();
  const deps = createDependencies(() =>
    Promise.resolve({
      preview: {
        instanceId: INSTANCE_ID,
        instanceName: 'Preview Test Instance',
        arrType: 'radarr',
        status: 'ready',
        createdAtMs: Date.now(),
        sections: [],
        sectionOutcomes: [],
        qualityProfiles: null,
        delayProfiles: null,
        mediaManagement: null,
        metadataProfiles: null,
        summary: {
          totalCreates: 0,
          totalUpdates: 0,
          totalDeletes: 0,
          totalUnchanged: 0,
        },
      },
      reviewContext: {
        sectionConfigs: {},
        evidence: [],
        preparedExecutionContexts: {},
      },
    })
  );

  const response = await _handleSyncPreviewCreateRequest(createPreviewCreateRequest(), deps);
  assertEquals(response.status, 200);
  const payload = (await response.json()) as SyncPreviewResult;
  try {
    assertEquals(payload.status, 'ready');
    assertEquals(payload.sections, []);
    assertEquals(payload.failure, null);
    const applyResponse = await _handleSyncPreviewApplyRequest(
      payload.id,
      createApplyRequest(payload.id),
      dependenciesReturning({ status: 'success' })
    );
    assertEquals(applyResponse.status, 400);
  } finally {
    previewStore.delete(payload.id);
    resetPreviewCreateRateLimitForTests();
  }
});

Deno.test('sync preview create returns a ready non-applicable result when every section is skipped', async () => {
  resetPreviewCreateRateLimitForTests();
  const deps = createDependencies(() =>
    Promise.resolve({
      preview: {
        instanceId: INSTANCE_ID,
        instanceName: 'Preview Test Instance',
        arrType: 'radarr',
        status: 'ready',
        createdAtMs: Date.now(),
        sections: ['qualityProfiles', 'delayProfiles'],
        sectionOutcomes: [
          { section: 'qualityProfiles', failure: null, skipped: true },
          { section: 'delayProfiles', failure: null, skipped: true },
        ],
        qualityProfiles: null,
        delayProfiles: null,
        mediaManagement: null,
        metadataProfiles: null,
        summary: {
          totalCreates: 0,
          totalUpdates: 0,
          totalDeletes: 0,
          totalUnchanged: 0,
        },
      },
      reviewContext: {
        sectionConfigs: {},
        evidence: [],
        preparedExecutionContexts: {},
      },
    })
  );

  const response = await _handleSyncPreviewCreateRequest(createPreviewCreateRequest(), deps);
  assertEquals(response.status, 200);
  const payload = (await response.json()) as SyncPreviewResult;
  try {
    assertEquals(payload.status, 'ready');
    assertEquals(
      payload.sectionOutcomes.every((outcome) => outcome.skipped),
      true
    );
    assertEquals(payload.failure, null);
    const applyResponse = await _handleSyncPreviewApplyRequest(
      payload.id,
      createApplyRequest(payload.id),
      dependenciesReturning({ status: 'success' })
    );
    assertEquals(applyResponse.status, 400);
  } finally {
    previewStore.delete(payload.id);
    resetPreviewCreateRateLimitForTests();
  }
});

Deno.test('sync preview apply maps a returned job failure to a typed executionFailed reason', async () => {
  const previewId = `preview-apply-redact-secret-job-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);

  try {
    // The job result can no longer carry raw error text (issue #237): a failure arrives as a typed
    // `failureCode`, and the apply surfaces only the typed `executionFailed` reason — never raw text.
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      dependenciesReturning({ status: 'failure', failureCode: 'upstream', syncHistoryId: 42 })
    );

    assertEquals(response.status, 500);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertEquals(assertTypedFailure(payload.results.failure, 'apply job-failure results').code, 'executionFailed');
    assertNoLeak(payload, 'apply job-failure body');
    assertNoLeak(previewStore.get(previewId), 'apply job-failure stored');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply surfaces a typed failure reason for a returned job failure', async () => {
  const previewId = `preview-apply-redact-freeform-job-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      dependenciesReturning({ status: 'failure', failureCode: 'internalError', syncHistoryId: null })
    );

    assertEquals(response.status, 500);
    const payload = (await response.json()) as SyncPreviewApplyResponse;
    assertTypedFailure(payload.results.failure, 'apply free-form job results');
    assertNoLeak(payload, 'apply free-form job body');
    assertNoLeak(previewStore.get(previewId), 'apply free-form job stored');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply redacts a secret-shaped thrown exception', async () => {
  const previewId = `preview-apply-redact-secret-throw-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      {
        getSectionsInProgress: () => [],
        executeReviewedSyncJob: () => Promise.reject(new Error(SECRET_MIX)),
        now: Date.now,
      }
    );

    assertEquals(response.status, 500);
    const payload = (await response.json()) as SyncPreviewApplyErrorResponse;
    assertTypedFailure(payload.failure, 'apply thrown-secret body');
    assertNoLeak(payload, 'apply thrown-secret body');
    assertNoLeak(previewStore.get(previewId), 'apply thrown-secret stored');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('sync preview apply redacts an arbitrary free-form thrown exception', async () => {
  const previewId = `preview-apply-redact-freeform-throw-${crypto.randomUUID()}`;
  await createReviewedSnapshot(previewId);

  try {
    const response = await _handleSyncPreviewApplyRequest(
      previewId,
      createApplyRequest(previewId, JSON.stringify({ sections: ['qualityProfiles'] })),
      {
        getSectionsInProgress: () => [],
        executeReviewedSyncJob: () => Promise.reject(new Error(FREE_FORM)),
        now: Date.now,
      }
    );

    assertEquals(response.status, 500);
    const payload = (await response.json()) as SyncPreviewApplyErrorResponse;
    assertTypedFailure(payload.failure, 'apply thrown-freeform body');
    assertNoLeak(payload, 'apply thrown-freeform body');
    assertNoLeak(previewStore.get(previewId), 'apply thrown-freeform stored');
  } finally {
    previewStore.delete(previewId);
  }
});

Deno.test('classifyPreviewFailure maps error TYPE/status to closed codes without leaking raw text', () => {
  const cases: readonly { error: unknown; expected: string }[] = [
    { error: new HttpError(SECRET_MIX, 0), expected: 'unreachable' },
    { error: new HttpError(SECRET_MIX, 408), expected: 'timeout' },
    { error: new HttpError(SECRET_MIX, 401), expected: 'unauthorized' },
    { error: new HttpError(SECRET_MIX, 403), expected: 'unauthorized' },
    { error: new HttpError(SECRET_MIX, 404), expected: 'notFound' },
    { error: new HttpError(SECRET_MIX, 422), expected: 'rejected' },
    { error: new HttpError(SECRET_MIX, 503), expected: 'serverError' },
    // A non-error HTTP status (< 400) falls through to the catch-all rather than misclassifying.
    { error: new HttpError(SECRET_MIX, 302), expected: 'internalError' },
    { error: new Error(FREE_FORM), expected: 'internalError' },
  ];

  for (const { error, expected } of cases) {
    const reason = classifyPreviewFailure(error, 'radarr');
    assertEquals(reason.code, expected);
    assertTypedFailure(reason, `classify ${expected}`);
    assertNoLeak(reason, `classify ${expected}`);
  }

  // AbortError / TimeoutError are classified by error.name, not message substring.
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assertEquals(classifyPreviewFailure(abort, 'sonarr').code, 'timeout');
  const timeoutNamed = new Error('slow');
  timeoutNamed.name = 'TimeoutError';
  assertEquals(classifyPreviewFailure(timeoutNamed, 'sonarr').code, 'timeout');
});
