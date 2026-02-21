import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord } from '$jobs/queueTypes.ts';
import { config } from '$config';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { toArrPullStartupRunResult, toJobRunStatus } from '$lib/server/pull/startup/index.ts';
import {
	buildRunSummary,
	buildSuccessInstanceResult,
	buildFailedInstanceResult,
	buildSkippedInstanceResult,
	buildRadarrInstance,
	buildSonarrInstance,
	buildLidarrInstance,
} from '../base/pullOnStartupFixtures.ts';

// Side-effect import to register the handler
import '$jobs/handlers/arrPullStartup.ts';

// =============================================================================
// Patch/Restore helpers (following lidarrSync.test.ts pattern)
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

function patchConfig(
	overrides: Partial<MutableConfig>,
	restores: Restore[]
): void {
	const mutable = config as unknown as MutableConfig;
	const original: MutableConfig = {
		pullOnStart: mutable.pullOnStart,
		pullOnStartMaxConcurrency: mutable.pullOnStartMaxConcurrency,
		pullOnStartTimeoutMs: mutable.pullOnStartTimeoutMs,
	};

	if (overrides.pullOnStart !== undefined) mutable.pullOnStart = overrides.pullOnStart;
	if (overrides.pullOnStartMaxConcurrency !== undefined) {
		mutable.pullOnStartMaxConcurrency = overrides.pullOnStartMaxConcurrency;
	}
	if (overrides.pullOnStartTimeoutMs !== undefined) {
		mutable.pullOnStartTimeoutMs = overrides.pullOnStartTimeoutMs;
	}

	restores.push(() => {
		mutable.pullOnStart = original.pullOnStart;
		mutable.pullOnStartMaxConcurrency = original.pullOnStartMaxConcurrency;
		mutable.pullOnStartTimeoutMs = original.pullOnStartTimeoutMs;
	});
}

// =============================================================================
// Helper: create a stub job record for the handler
// =============================================================================

function createStartupJobRecord(): JobQueueRecord {
	const now = new Date().toISOString();
	return {
		id: 1,
		jobType: 'arr.pull.startup',
		status: 'running',
		runAt: now,
		payload: { enqueuedAt: now },
		source: 'system',
		dedupeKey: 'arr.pull.startup:boot',
		cooldownUntil: null,
		attempts: 1,
		startedAt: now,
		finishedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

// =============================================================================
// Handler registration test
// =============================================================================

Deno.test('arr.pull.startup handler is registered in the handler registry', () => {
	const handler = jobQueueRegistry.get('arr.pull.startup');
	assertExists(handler, 'arr.pull.startup handler should be registered');
});

// =============================================================================
// Config gate tests
// =============================================================================

Deno.test({
	name: 'arr.pull.startup handler returns skipped when feature is disabled',
	sanitizeResources: false,
	fn: async () => {
		const handler = jobQueueRegistry.get('arr.pull.startup')!;
		const restores: Restore[] = [];

		patchConfig({ pullOnStart: false }, restores);

		try {
			const result = await handler(createStartupJobRecord());
			assertEquals(result.status, 'skipped');
			assertStringIncludes(result.output!, 'Startup pull disabled');
		} finally {
			for (const restore of restores.reverse()) restore();
		}
	},
});

// =============================================================================
// Orchestrator integration tests via query-layer patching
// =============================================================================

Deno.test({
	name: 'arr.pull.startup handler returns skipped when no instances are enabled',
	sanitizeResources: false,
	fn: async () => {
		const handler = jobQueueRegistry.get('arr.pull.startup')!;
		const restores: Restore[] = [];

		patchConfig({ pullOnStart: true }, restores);
		patchTarget(arrInstancesQueries, 'getEnabled', () => [], restores);

		try {
			const result = await handler(createStartupJobRecord());
			// No instances -> orchestrator returns skipped run -> handler maps to skipped
			assertEquals(result.status, 'skipped');
			assertExists(result.output);

			const parsed = JSON.parse(result.output!);
			assertEquals(parsed.status, 'skipped');
			assertEquals(parsed.instances.length, 0);
		} finally {
			for (const restore of restores.reverse()) restore();
		}
	},
});

Deno.test({
	name: 'arr.pull.startup handler returns skipped when no databases are enabled',
	sanitizeResources: false,
	fn: async () => {
		const handler = jobQueueRegistry.get('arr.pull.startup')!;
		const restores: Restore[] = [];

		patchConfig({ pullOnStart: true }, restores);

		const radarrInstance = buildRadarrInstance({ id: 10 });
		patchTarget(arrInstancesQueries, 'getEnabled', () => [radarrInstance], restores);
		patchTarget(databaseInstancesQueries, 'getAll', () => [], restores);

		try {
			const result = await handler(createStartupJobRecord());
			assertEquals(result.status, 'skipped');
			assertExists(result.output);

			const parsed = JSON.parse(result.output!);
			assertEquals(parsed.status, 'skipped');
			assertEquals(parsed.instances.length, 0);
		} finally {
			for (const restore of restores.reverse()) restore();
		}
	},
});

Deno.test({
	name: 'arr.pull.startup handler isolates per-instance failures and returns failure with counters',
	sanitizeResources: false,
	fn: async () => {
		const handler = jobQueueRegistry.get('arr.pull.startup')!;
		const restores: Restore[] = [];

		patchConfig({ pullOnStart: true }, restores);

		// Provide instances that will fail because no credentials exist
		const radarrInstance = buildRadarrInstance({ id: 10 });
		const sonarrInstance = buildSonarrInstance({ id: 20 });

		patchTarget(arrInstancesQueries, 'getEnabled', () => [radarrInstance, sonarrInstance], restores);
		patchTarget(
			databaseInstancesQueries,
			'getAll',
			() => [{ id: 1, uuid: 'test-uuid', name: 'test-db', enabled: 1 } as ReturnType<typeof databaseInstancesQueries.getAll>[0]],
			restores
		);

		// No credentials -> loadStartupInstanceAndClient throws -> orchestrator catches per instance
		patchTarget(arrInstanceCredentialsQueries, 'getByInstanceId', () => undefined, restores);

		try {
			const result = await handler(createStartupJobRecord());
			// Both instances fail, so orchestrator returns 'failed' run -> handler maps to 'failure'
			assertEquals(result.status, 'failure');
			assertExists(result.output);

			const parsed = JSON.parse(result.output!);
			assertEquals(parsed.status, 'failure');
			assertEquals(parsed.instances.length, 2);

			// Each instance should have failed independently (per-instance isolation)
			for (const instanceResult of parsed.instances) {
				assertEquals(instanceResult.status, 'failure');
				assertEquals(instanceResult.failed, 1);
			}

			// Aggregate counters should reflect both failures
			assertEquals(parsed.failed, 2);
		} finally {
			for (const restore of restores.reverse()) restore();
		}
	},
});

Deno.test({
	name: 'arr.pull.startup handler returns structured output with instance-level counters',
	sanitizeResources: false,
	fn: async () => {
		const handler = jobQueueRegistry.get('arr.pull.startup')!;
		const restores: Restore[] = [];

		patchConfig({ pullOnStart: true }, restores);

		// Single instance that will fail due to missing credentials
		const lidarrInstance = buildLidarrInstance({ id: 30 });

		patchTarget(arrInstancesQueries, 'getEnabled', () => [lidarrInstance], restores);
		patchTarget(
			databaseInstancesQueries,
			'getAll',
			() => [{ id: 1, uuid: 'test-uuid', name: 'test-db', enabled: 1 } as ReturnType<typeof databaseInstancesQueries.getAll>[0]],
			restores
		);
		patchTarget(arrInstanceCredentialsQueries, 'getByInstanceId', () => undefined, restores);

		try {
			const result = await handler(createStartupJobRecord());
			assertExists(result.output);

			const parsed = JSON.parse(result.output!);
			assertExists(parsed.runId);
			assertExists(parsed.startedAt);
			assertExists(parsed.finishedAt);
			assertExists(parsed.instances);

			// Verify counter fields exist at run level
			assertEquals(typeof parsed.imported, 'number');
			assertEquals(typeof parsed.skipped_default, 'number');
			assertEquals(typeof parsed.skipped_no_match, 'number');
			assertEquals(typeof parsed.conflicted, 'number');
			assertEquals(typeof parsed.failed, 'number');

			// Verify each instance has counter fields
			for (const instanceResult of parsed.instances) {
				assertEquals(typeof instanceResult.instanceId, 'number');
				assertEquals(typeof instanceResult.instanceName, 'string');
				assertEquals(typeof instanceResult.status, 'string');
				assertEquals(typeof instanceResult.imported, 'number');
				assertEquals(typeof instanceResult.skipped_default, 'number');
				assertEquals(typeof instanceResult.skipped_no_match, 'number');
				assertEquals(typeof instanceResult.conflicted, 'number');
				assertEquals(typeof instanceResult.failed, 'number');
			}
		} finally {
			for (const restore of restores.reverse()) restore();
		}
	},
});

// =============================================================================
// Result mapping tests (pure functions, no mocking needed)
// =============================================================================

Deno.test('toJobRunStatus maps success to success', () => {
	assertEquals(toJobRunStatus('success'), 'success');
});

Deno.test('toJobRunStatus maps partial to success (best-effort semantics)', () => {
	assertEquals(toJobRunStatus('partial'), 'success');
});

Deno.test('toJobRunStatus maps failed to failure', () => {
	assertEquals(toJobRunStatus('failed'), 'failure');
});

Deno.test('toJobRunStatus maps skipped to skipped', () => {
	assertEquals(toJobRunStatus('skipped'), 'skipped');
});

Deno.test('toJobRunStatus maps disabled to skipped', () => {
	assertEquals(toJobRunStatus('disabled'), 'skipped');
});

Deno.test('toArrPullStartupRunResult preserves instance-level counters', () => {
	const radarrSuccess = buildSuccessInstanceResult('radarr', { imported: 5, skipped_default: 2 });
	const sonarrFailed = buildFailedInstanceResult('sonarr', { failed: 1 });
	const summary = buildRunSummary({
		status: 'partial',
		instances: [radarrSuccess, sonarrFailed],
	});

	const result = toArrPullStartupRunResult(summary);

	assertEquals(result.status, 'success'); // partial -> success via toJobRunStatus
	assertEquals(result.instances.length, 2);
	assertEquals(result.imported, 5);
	assertEquals(result.skipped_default, 2);
	assertEquals(result.failed, 1);

	const radarrResult = result.instances.find((i) => i.instanceId === radarrSuccess.instanceId);
	assertExists(radarrResult);
	assertEquals(radarrResult!.status, 'success');
	assertEquals(radarrResult!.imported, 5);
	assertEquals(radarrResult!.skipped_default, 2);

	const sonarrResult = result.instances.find((i) => i.instanceId === sonarrFailed.instanceId);
	assertExists(sonarrResult);
	assertEquals(sonarrResult!.status, 'failure');
	assertEquals(sonarrResult!.failed, 1);
});

Deno.test('toArrPullStartupRunResult handles empty run summary', () => {
	const summary = buildRunSummary({
		status: 'skipped',
		instances: [],
	});

	const result = toArrPullStartupRunResult(summary);

	assertEquals(result.status, 'skipped');
	assertEquals(result.instances.length, 0);
	assertEquals(result.imported, 0);
	assertEquals(result.skipped_default, 0);
	assertEquals(result.skipped_no_match, 0);
	assertEquals(result.conflicted, 0);
	assertEquals(result.failed, 0);
});

Deno.test('toArrPullStartupRunResult preserves runId and timestamps', () => {
	const summary = buildRunSummary({
		runId: 'test-run-id-12345',
		startedAt: '2026-02-21T10:00:00.000Z',
		finishedAt: '2026-02-21T10:00:05.000Z',
		status: 'success',
		instances: [],
	});

	const result = toArrPullStartupRunResult(summary);

	assertEquals(result.runId, 'test-run-id-12345');
	assertEquals(result.startedAt, '2026-02-21T10:00:00.000Z');
	assertEquals(result.finishedAt, '2026-02-21T10:00:05.000Z');
});
