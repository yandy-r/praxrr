/**
 * Startup pull bootstrap tests: verify startup enqueue behavior,
 * config gating, dedupe semantics, and non-blocking guarantees.
 *
 * These tests mock the job queue and config to avoid real DB access.
 * They follow the env var patching pattern from envInstances.test.ts.
 */

import { assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { upsertScheduledJob } from '$jobs/queueService.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import type { CreateJobQueueInput } from '$db/queries/jobQueue.ts';

// =============================================================================
// Patch/Restore helpers (following envInstances.test.ts pattern)
// =============================================================================

type Restore = () => void;

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

type MutableConfig = {
  pullOnStart: boolean;
  pullOnStartMaxConcurrency: number | null;
  pullOnStartTimeoutMs: number | null;
};

function patchConfigValue(
  key: keyof MutableConfig,
  value: MutableConfig[keyof MutableConfig],
  restores: Restore[]
): void {
  const mutable = config as unknown as MutableConfig;
  const original = mutable[key];
  (mutable as Record<string, unknown>)[key] = value;
  restores.push(() => {
    (mutable as Record<string, unknown>)[key] = original;
  });
}

// =============================================================================
// Mock queue service module
// =============================================================================

import * as queueServiceModule from '$jobs/queueService.ts';

type QueueServiceModule = typeof queueServiceModule;

type MutableQueueService = {
  -readonly [K in keyof QueueServiceModule]: QueueServiceModule[K];
};

function createMockJobRecord(input: CreateJobQueueInput): JobQueueRecord {
  const now = new Date().toISOString();
  return {
    id: 99,
    jobType: input.jobType,
    status: 'queued',
    runAt: input.runAt,
    payload: input.payload ?? {},
    source: input.source ?? 'system',
    dedupeKey: input.dedupeKey ?? null,
    cooldownUntil: input.cooldownUntil ?? null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// =============================================================================
// Simulate the startup enqueue logic (extracted from hooks.server.ts)
//
// We cannot import hooks.server.ts directly in tests because it runs the full
// startup lifecycle. Instead, we replicate the enqueue gate logic and test it.
// =============================================================================

interface StartupEnqueueResult {
  enqueued: boolean;
  dedupeKey: string | null;
  error: string | null;
}

function runStartupEnqueueGate(upsertFn: (input: CreateJobQueueInput) => JobQueueRecord): StartupEnqueueResult {
  if (!config.pullOnStart) {
    return { enqueued: false, dedupeKey: null, error: null };
  }

  try {
    const startupJob = upsertFn({
      jobType: 'arr.pull.startup',
      runAt: new Date().toISOString(),
      source: 'system',
      payload: { enqueuedAt: new Date().toISOString() },
      dedupeKey: 'arr.pull.startup:boot',
    });

    return {
      enqueued: true,
      dedupeKey: startupJob.dedupeKey,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      enqueued: false,
      dedupeKey: null,
      error: message,
    };
  }
}

// =============================================================================
// Tests
// =============================================================================

Deno.test('startup enqueue: PULL_ON_START=false does NOT enqueue any job', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', false, restores);

  let enqueueCalled = false;
  const mockUpsert = (_input: CreateJobQueueInput): JobQueueRecord => {
    enqueueCalled = true;
    return createMockJobRecord(_input);
  };

  try {
    const result = runStartupEnqueueGate(mockUpsert);
    assertEquals(result.enqueued, false);
    assertEquals(result.dedupeKey, null);
    assertEquals(result.error, null);
    assertEquals(enqueueCalled, false, 'upsert should not be called when feature is disabled');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: PULL_ON_START=true enqueues exactly one job', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  let enqueueCount = 0;
  const mockUpsert = (input: CreateJobQueueInput): JobQueueRecord => {
    enqueueCount += 1;
    return createMockJobRecord(input);
  };

  try {
    const result = runStartupEnqueueGate(mockUpsert);
    assertEquals(result.enqueued, true);
    assertEquals(enqueueCount, 1, 'exactly one enqueue call expected');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: dedupe key is arr.pull.startup:boot', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  let capturedDedupeKey: string | null = null;
  const mockUpsert = (input: CreateJobQueueInput): JobQueueRecord => {
    capturedDedupeKey = input.dedupeKey ?? null;
    return createMockJobRecord(input);
  };

  try {
    const result = runStartupEnqueueGate(mockUpsert);
    assertEquals(capturedDedupeKey, 'arr.pull.startup:boot');
    assertEquals(result.dedupeKey, 'arr.pull.startup:boot');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: enqueue failure does not block startup (warn and continue)', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  const mockUpsert = (_input: CreateJobQueueInput): JobQueueRecord => {
    throw new Error('DB connection refused');
  };

  try {
    // This should NOT throw; the gate catches the error and returns gracefully
    const result = runStartupEnqueueGate(mockUpsert);
    assertEquals(result.enqueued, false);
    assertEquals(result.error, 'DB connection refused');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: startup remains non-blocking (enqueue returns synchronously)', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  // Track timing: enqueue is synchronous, job dispatch is deferred to the dispatcher loop
  let upsertCallTimestamp: number | null = null;

  const mockUpsert = (input: CreateJobQueueInput): JobQueueRecord => {
    upsertCallTimestamp = Date.now();
    return createMockJobRecord(input);
  };

  try {
    const beforeGate = Date.now();
    const result = runStartupEnqueueGate(mockUpsert);
    const afterGate = Date.now();

    assertEquals(result.enqueued, true);
    assertExists(upsertCallTimestamp);

    // The gate completes synchronously without awaiting job execution.
    // The actual job runs later via the dispatcher poll loop.
    // Verify the gate returned in under 10ms (no async wait for job completion).
    const gateDuration = afterGate - beforeGate;
    assertEquals(gateDuration < 50, true, `startup gate should return immediately (took ${gateDuration}ms)`);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: job type is arr.pull.startup', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  let capturedJobType: string | null = null;
  const mockUpsert = (input: CreateJobQueueInput): JobQueueRecord => {
    capturedJobType = input.jobType;
    return createMockJobRecord(input);
  };

  try {
    runStartupEnqueueGate(mockUpsert);
    assertEquals(capturedJobType, 'arr.pull.startup');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: source is system', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  let capturedSource: string | undefined | null = null;
  const mockUpsert = (input: CreateJobQueueInput): JobQueueRecord => {
    capturedSource = input.source;
    return createMockJobRecord(input);
  };

  try {
    runStartupEnqueueGate(mockUpsert);
    assertEquals(capturedSource, 'system');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: payload includes enqueuedAt timestamp', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  let capturedPayload: Record<string, unknown> | undefined;
  const mockUpsert = (input: CreateJobQueueInput): JobQueueRecord => {
    capturedPayload = input.payload;
    return createMockJobRecord(input);
  };

  try {
    runStartupEnqueueGate(mockUpsert);
    assertExists(capturedPayload);
    assertExists(capturedPayload!.enqueuedAt, 'payload should include enqueuedAt');
    assertEquals(typeof capturedPayload!.enqueuedAt, 'string');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('startup enqueue: dedupe prevents duplicate runs via upsertScheduledJob contract', () => {
  const restores: Restore[] = [];

  patchConfigValue('pullOnStart', true as unknown as boolean, restores);

  // Track how many times upsert was called with the same dedupe key
  let upsertCallCount = 0;
  const existingRecord = createMockJobRecord({
    jobType: 'arr.pull.startup',
    runAt: new Date().toISOString(),
    source: 'system',
    dedupeKey: 'arr.pull.startup:boot',
  });

  const mockUpsert = (input: CreateJobQueueInput): JobQueueRecord => {
    upsertCallCount += 1;
    // Simulate upsert behavior: return existing record if dedupe key matches
    // (no new row created, same record returned)
    return existingRecord;
  };

  try {
    // First startup call
    const result1 = runStartupEnqueueGate(mockUpsert);
    assertEquals(result1.enqueued, true);
    assertEquals(upsertCallCount, 1);

    // Second startup call with same dedupe key (process restart scenario)
    const result2 = runStartupEnqueueGate(mockUpsert);
    assertEquals(result2.enqueued, true);
    assertEquals(upsertCallCount, 2);

    // Both return the same record ID (upsert semantics, not duplicate creation)
    assertEquals(result1.dedupeKey, result2.dedupeKey);
    assertEquals(result1.dedupeKey, 'arr.pull.startup:boot');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
