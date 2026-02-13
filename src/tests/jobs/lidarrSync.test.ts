import { assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource } from '$jobs/queueTypes.ts';
import {
	isSyncSectionSupported,
	getUnsupportedSyncSectionReason,
	SYNC_SECTION_ORDER,
	type SyncArrType,
} from '$lib/server/sync/mappings.ts';
import type { SectionType } from '$lib/server/sync/types.ts';

import '$jobs/handlers/arrSync.ts';

function createInstance(id: number, type: ArrInstance['type']): ArrInstance {
	const now = new Date().toISOString();
	return {
		id,
		name: `${type}-${id}`,
		type,
		url: 'http://127.0.0.1:8989',
		api_key: `${type}-key`,
		tags: null,
		enabled: 1,
		created_at: now,
		updated_at: now,
	};
}

function createSyncJob(instanceId: number, source: JobSource, section?: SectionType): JobQueueRecord {
	const now = new Date().toISOString();
	return {
		id: instanceId,
		jobType: 'arr.sync',
		status: 'queued',
		runAt: now,
		payload: {
			instanceId,
			section: section ?? 'qualityProfiles',
		},
		source,
		dedupeKey: null,
		cooldownUntil: null,
		attempts: 0,
		startedAt: null,
		finishedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

// =============================================================================
// Sync mapping unit tests (pure functions, no handler mocking needed)
// =============================================================================

Deno.test('isSyncSectionSupported: lidarr supports delayProfiles', () => {
	assertEquals(isSyncSectionSupported('lidarr', 'delayProfiles'), true);
});

Deno.test('isSyncSectionSupported: lidarr supports mediaManagement', () => {
	assertEquals(isSyncSectionSupported('lidarr', 'mediaManagement'), true);
});

Deno.test('isSyncSectionSupported: lidarr does not support qualityProfiles', () => {
	assertEquals(isSyncSectionSupported('lidarr', 'qualityProfiles'), false);
});

Deno.test('isSyncSectionSupported: radarr supports all sections', () => {
	for (const section of SYNC_SECTION_ORDER) {
		assertEquals(isSyncSectionSupported('radarr', section), true);
	}
});

Deno.test('isSyncSectionSupported: sonarr supports all sections', () => {
	for (const section of SYNC_SECTION_ORDER) {
		assertEquals(isSyncSectionSupported('sonarr', section), true);
	}
});

Deno.test('getUnsupportedSyncSectionReason: returns null for supported sections', () => {
	const supportedCases: Array<[SyncArrType, SectionType]> = [
		['radarr', 'qualityProfiles'],
		['radarr', 'delayProfiles'],
		['radarr', 'mediaManagement'],
		['sonarr', 'qualityProfiles'],
		['sonarr', 'delayProfiles'],
		['sonarr', 'mediaManagement'],
		['lidarr', 'delayProfiles'],
		['lidarr', 'mediaManagement'],
	];
	for (const [arrType, section] of supportedCases) {
		assertEquals(getUnsupportedSyncSectionReason(arrType, section), null, `${arrType}/${section} should be null`);
	}
});

Deno.test('getUnsupportedSyncSectionReason: returns reason for lidarr qualityProfiles', () => {
	const reason = getUnsupportedSyncSectionReason('lidarr', 'qualityProfiles');
	assertEquals(typeof reason, 'string');
	assertStringIncludes(reason!, 'Lidarr quality profile sync is not supported yet');
});

Deno.test('SYNC_SECTION_ORDER: contains all three sections in expected order', () => {
	assertEquals(SYNC_SECTION_ORDER, ['qualityProfiles', 'delayProfiles', 'mediaManagement']);
});

// =============================================================================
// Handler integration tests (mock DB queries, exercise handler logic)
// =============================================================================

Deno.test({
	name: 'arr.sync qualityProfiles: lidarr is explicitly unsupported without regressing radarr/sonarr',
	sanitizeResources: false,
	fn: async () => {
		const handler = jobQueueRegistry.get('arr.sync');
		assertExists(handler);

		const instances = new Map<number, ArrInstance>([
			[101, createInstance(101, 'lidarr')],
			[102, createInstance(102, 'radarr')],
			[103, createInstance(103, 'sonarr')],
		]);

		const originalGetById = arrInstancesQueries.getById;
		const originalGetSyncConfigStatus = arrSyncQueries.getSyncConfigStatus;
		const originalGetNextScheduledRunAt = arrSyncQueries.getNextScheduledRunAt;

		arrInstancesQueries.getById = (id: number) => instances.get(id);
		arrSyncQueries.getSyncConfigStatus = () => ({
			qualityProfiles: {
				trigger: 'manual',
				cron: null,
				nextRunAt: null,
				syncStatus: 'idle',
			},
			delayProfiles: {
				trigger: 'manual',
				cron: null,
				nextRunAt: null,
				syncStatus: 'idle',
			},
			mediaManagement: {
				trigger: 'manual',
				cron: null,
				nextRunAt: null,
				syncStatus: 'idle',
			},
		});
		arrSyncQueries.getNextScheduledRunAt = () => null;

		try {
			const lidarrResult = await handler(createSyncJob(101, 'manual'));
			assertEquals(lidarrResult.status, 'skipped');
			assertStringIncludes(lidarrResult.output ?? '', 'qualityProfiles: skipped (');
			assertStringIncludes(lidarrResult.output ?? '', 'Lidarr quality profile sync is not supported yet');

			for (const supportedId of [102, 103]) {
				const supportedResult = await handler(createSyncJob(supportedId, 'schedule'));
				assertEquals(supportedResult.status, 'skipped');
				assertEquals(supportedResult.output, 'qualityProfiles: skipped');
			}
		} finally {
			arrInstancesQueries.getById = originalGetById;
			arrSyncQueries.getSyncConfigStatus = originalGetSyncConfigStatus;
			arrSyncQueries.getNextScheduledRunAt = originalGetNextScheduledRunAt;
		}
	},
});

Deno.test({
	name: 'arr.sync disabled instance: returns cancelled for all arr types',
	sanitizeResources: false,
	fn: async () => {
		const handler = jobQueueRegistry.get('arr.sync');
		assertExists(handler);

		const disabledInstance: ArrInstance = {
			...createInstance(201, 'lidarr'),
			enabled: 0,
		};

		const originalGetById = arrInstancesQueries.getById;
		arrInstancesQueries.getById = () => disabledInstance;

		try {
			const result = await handler(createSyncJob(201, 'manual'));
			assertEquals(result.status, 'cancelled');
			assertEquals(result.output, 'Arr instance disabled');
		} finally {
			arrInstancesQueries.getById = originalGetById;
		}
	},
});
