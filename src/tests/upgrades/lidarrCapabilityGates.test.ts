import { assertEquals, assertExists } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { RenameSettings } from '$db/queries/arrRenameSettings.ts';
import { arrRenameSettingsQueries } from '$db/queries/arrRenameSettings.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import type { JobQueueRecord, JobSource, JobType } from '$jobs/queueTypes.ts';
import type { UpgradeConfig } from '$shared/upgrades/filters.ts';
import {
	supportsArrWorkflow,
	supportsArrSyncSurface,
	supportsFeature,
	isArrAppType,
	ARR_APPS,
	type ArrAppType,
} from '$shared/arr/capabilities.ts';
import { getUnsupportedSyncSectionReason } from '$lib/server/sync/mappings.ts';

import '$jobs/handlers/arrRename.ts';
import '$jobs/handlers/arrUpgrade.ts';

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

function createRenameSettings(instanceId: number, enabled: boolean): RenameSettings {
	const now = new Date().toISOString();
	return {
		id: instanceId,
		arrInstanceId: instanceId,
		dryRun: true,
		renameFolders: false,
		ignoreTag: null,
		summaryNotifications: true,
		enabled,
		schedule: 60,
		lastRunAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

function createUpgradeConfig(instanceId: number, enabled: boolean): UpgradeConfig {
	const now = new Date().toISOString();
	return {
		id: instanceId,
		arrInstanceId: instanceId,
		enabled,
		dryRun: true,
		schedule: 60,
		filterMode: 'round_robin',
		filters: [],
		currentFilterIndex: 0,
		lastRunAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

function createJob(jobType: JobType, instanceId: number, source: JobSource): JobQueueRecord {
	const now = new Date().toISOString();
	return {
		id: instanceId,
		jobType,
		status: 'queued',
		runAt: now,
		payload: { instanceId },
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
// Capability predicate unit tests (pure functions, no handler mocking needed)
// =============================================================================

Deno.test('supportsArrWorkflow: lidarr rename is false', () => {
	assertEquals(supportsArrWorkflow('lidarr', 'rename'), false);
});

Deno.test('supportsArrWorkflow: lidarr upgrades is false', () => {
	assertEquals(supportsArrWorkflow('lidarr', 'upgrades'), false);
});

Deno.test('supportsArrWorkflow: lidarr instances/library/releases are true', () => {
	assertEquals(supportsArrWorkflow('lidarr', 'instances'), true);
	assertEquals(supportsArrWorkflow('lidarr', 'library'), true);
	assertEquals(supportsArrWorkflow('lidarr', 'releases'), true);
});

Deno.test('supportsArrWorkflow: radarr supports all workflows', () => {
	assertEquals(supportsArrWorkflow('radarr', 'instances'), true);
	assertEquals(supportsArrWorkflow('radarr', 'library'), true);
	assertEquals(supportsArrWorkflow('radarr', 'releases'), true);
	assertEquals(supportsArrWorkflow('radarr', 'rename'), true);
	assertEquals(supportsArrWorkflow('radarr', 'upgrades'), true);
});

Deno.test('supportsArrWorkflow: sonarr supports rename but not upgrades', () => {
	assertEquals(supportsArrWorkflow('sonarr', 'rename'), true);
	assertEquals(supportsArrWorkflow('sonarr', 'upgrades'), false);
});

Deno.test('supportsArrSyncSurface: lidarr sync capabilities match expected', () => {
	assertEquals(supportsArrSyncSurface('lidarr', 'quality_profiles'), true);
	assertEquals(supportsArrSyncSurface('lidarr', 'custom_formats'), true);
	assertEquals(supportsArrSyncSurface('lidarr', 'delay_profiles'), true);
	assertEquals(supportsArrSyncSurface('lidarr', 'media_management'), true);
});

Deno.test('supportsArrSyncSurface: radarr and sonarr support all sync surfaces', () => {
	for (const arrType of ['radarr', 'sonarr'] as ArrAppType[]) {
		assertEquals(supportsArrSyncSurface(arrType, 'quality_profiles'), true, `${arrType} quality_profiles`);
		assertEquals(supportsArrSyncSurface(arrType, 'custom_formats'), true, `${arrType} custom_formats`);
		assertEquals(supportsArrSyncSurface(arrType, 'delay_profiles'), true, `${arrType} delay_profiles`);
		assertEquals(supportsArrSyncSurface(arrType, 'media_management'), true, `${arrType} media_management`);
	}
});

Deno.test('supportsFeature: generic predicate covers workflow and sync surfaces', () => {
	assertEquals(supportsFeature('lidarr', 'rename'), false);
	assertEquals(supportsFeature('lidarr', 'upgrades'), false);
	assertEquals(supportsFeature('lidarr', 'quality_profiles'), true);
	assertEquals(supportsFeature('lidarr', 'custom_formats'), true);
	assertEquals(supportsFeature('lidarr', 'delay_profiles'), true);
	assertEquals(supportsFeature('lidarr', 'media_management'), true);
	assertEquals(supportsFeature('lidarr', 'nonexistent_feature'), false);
});

Deno.test('getUnsupportedSyncSectionReason: lidarr qualityProfiles has no unsupported reason', () => {
	assertEquals(getUnsupportedSyncSectionReason('lidarr', 'qualityProfiles'), null);
});

Deno.test('isArrAppType: validates all known types and rejects invalid ones', () => {
	assertEquals(isArrAppType('radarr'), true);
	assertEquals(isArrAppType('sonarr'), true);
	assertEquals(isArrAppType('lidarr'), true);
	assertEquals(isArrAppType('all'), false);
	assertEquals(isArrAppType('readarr'), false);
	assertEquals(isArrAppType(''), false);
});

Deno.test('ARR_APPS: lidarr metadata has correct label and capability flags', () => {
	const lidarr = ARR_APPS.lidarr;
	assertEquals(lidarr.type, 'lidarr');
	assertEquals(lidarr.label, 'Lidarr');
	assertEquals(lidarr.capabilities.workflows.rename, false);
	assertEquals(lidarr.capabilities.workflows.upgrades, false);
	assertEquals(lidarr.capabilities.sync.quality_profiles, true);
	assertEquals(lidarr.capabilities.sync.custom_formats, true);
	assertEquals(lidarr.capabilities.sync.delay_profiles, true);
	assertEquals(lidarr.capabilities.sync.media_management, true);
});

// =============================================================================
// Handler integration tests (mock DB queries, exercise handler logic)
// =============================================================================

Deno.test(
	'rename/upgrade handlers: lidarr capability gates stay explicit and mixed-arr behavior remains stable',
	async () => {
		const renameHandler = jobQueueRegistry.get('arr.rename');
		const upgradeHandler = jobQueueRegistry.get('arr.upgrade');
		assertExists(renameHandler);
		assertExists(upgradeHandler);

		const instances = new Map<number, ArrInstance>([
			[201, createInstance(201, 'lidarr')],
			[202, createInstance(202, 'radarr')],
			[203, createInstance(203, 'sonarr')],
		]);

		const originalGetById = arrInstancesQueries.getById;
		const originalGetRenameSettings = arrRenameSettingsQueries.getByInstanceId;
		const originalGetUpgradeConfig = upgradeConfigsQueries.getByArrInstanceId;

		arrInstancesQueries.getById = (id: number) => instances.get(id);
		arrRenameSettingsQueries.getByInstanceId = (instanceId: number) =>
			createRenameSettings(instanceId, instanceId === 201);
		upgradeConfigsQueries.getByArrInstanceId = (instanceId: number) =>
			createUpgradeConfig(instanceId, instanceId === 201);

		try {
			// Lidarr rename: handler checks settings.enabled first (true for 201),
			// then instance lookup, then capability gate
			const lidarrRenameResult = await renameHandler(createJob('arr.rename', 201, 'manual'));
			assertEquals(lidarrRenameResult.status, 'skipped');
			assertEquals(lidarrRenameResult.output, 'Rename is not supported for Lidarr instances');

			// Lidarr upgrade: handler checks config.enabled first (true for 201),
			// then instance lookup, then capability gate
			const lidarrUpgradeResult = await upgradeHandler(createJob('arr.upgrade', 201, 'manual'));
			assertEquals(lidarrUpgradeResult.status, 'skipped');
			assertEquals(lidarrUpgradeResult.output, 'Upgrades are not supported for Lidarr instances');

			// Radarr/Sonarr regression: config is disabled for these instances,
			// so they return 'cancelled' before reaching the capability gate
			for (const supportedId of [202, 203]) {
				const supportedRenameResult = await renameHandler(createJob('arr.rename', supportedId, 'manual'));
				assertEquals(supportedRenameResult.status, 'cancelled');
				assertEquals(supportedRenameResult.output, 'Rename config disabled');

				const supportedUpgradeResult = await upgradeHandler(
					createJob('arr.upgrade', supportedId, 'schedule')
				);
				assertEquals(supportedUpgradeResult.status, 'cancelled');
				assertEquals(supportedUpgradeResult.output, 'Upgrade config disabled');
			}
		} finally {
			arrInstancesQueries.getById = originalGetById;
			arrRenameSettingsQueries.getByInstanceId = originalGetRenameSettings;
			upgradeConfigsQueries.getByArrInstanceId = originalGetUpgradeConfig;
		}
	}
);

Deno.test('rename handler: missing instance returns failure', async () => {
	const renameHandler = jobQueueRegistry.get('arr.rename');
	assertExists(renameHandler);

	const originalGetRenameSettings = arrRenameSettingsQueries.getByInstanceId;
	const originalGetById = arrInstancesQueries.getById;

	arrRenameSettingsQueries.getByInstanceId = () => createRenameSettings(999, true);
	arrInstancesQueries.getById = () => undefined;

	try {
		const result = await renameHandler(createJob('arr.rename', 999, 'manual'));
		assertEquals(result.status, 'failure');
		assertEquals(result.error, 'Arr instance not found');
	} finally {
		arrRenameSettingsQueries.getByInstanceId = originalGetRenameSettings;
		arrInstancesQueries.getById = originalGetById;
	}
});

Deno.test('upgrade handler: missing instance returns failure', async () => {
	const upgradeHandler = jobQueueRegistry.get('arr.upgrade');
	assertExists(upgradeHandler);

	const originalGetUpgradeConfig = upgradeConfigsQueries.getByArrInstanceId;
	const originalGetById = arrInstancesQueries.getById;

	upgradeConfigsQueries.getByArrInstanceId = () => createUpgradeConfig(999, true);
	arrInstancesQueries.getById = () => undefined;

	try {
		const result = await upgradeHandler(createJob('arr.upgrade', 999, 'manual'));
		assertEquals(result.status, 'failure');
		assertEquals(result.error, 'Arr instance not found');
	} finally {
		upgradeConfigsQueries.getByArrInstanceId = originalGetUpgradeConfig;
		arrInstancesQueries.getById = originalGetById;
	}
});
