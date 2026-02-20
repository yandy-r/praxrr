import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import { previewStore } from '$sync/preview/store.ts';
import { PREVIEW_STATUS_FAILED, PREVIEW_STATUS_GENERATING, PREVIEW_STATUS_READY } from '$sync/preview/store.ts';
import { generatePreview } from '$sync/preview/orchestrator.ts';
import { SYNC_SECTION_ORDER } from '$sync/mappings.ts';
import type { SectionType } from '$sync/types.ts';
import type { SyncPreviewArrType, SyncPreviewResult, SyncPreviewSummary } from '$sync/preview/types.ts';
import { uuid } from '$shared/utils/uuid.ts';

type ErrorResponse = {
	error: string;
};

type CreateRequestBody = {
	instanceId: number;
	sections?: unknown;
	sectionConfigs?: unknown;
};

type CreatePreviewResult = {
	previewId: string;
	instanceId: number;
	instanceName: string;
	arrType: SyncPreviewArrType;
	sections: SectionType[] | undefined;
	sectionConfigs?: Partial<Record<SectionType, unknown>>;
};

function isSyncPreviewArrType(value: string): value is SyncPreviewArrType {
	return value === 'radarr' || value === 'sonarr' || value === 'lidarr';
}

function parseSectionOrderValue(rawSections: unknown): SectionType[] | undefined {
	if (rawSections === undefined) {
		return undefined;
	}

	if (!Array.isArray(rawSections)) {
		throw new Error('sections must be an array when provided');
	}

	const validSections = new Set<SectionType>(SYNC_SECTION_ORDER);
	const nextSections: SectionType[] = [];
	const seen = new Set<SectionType>();

	for (const rawSection of rawSections) {
		if (typeof rawSection !== 'string') {
			throw new Error(`Invalid section value: ${String(rawSection)}`);
		}

		if (!validSections.has(rawSection as SectionType)) {
			throw new Error(`Invalid section: ${rawSection}`);
		}

		const section = rawSection as SectionType;
		if (seen.has(section)) {
			continue;
		}

		seen.add(section);
		nextSections.push(section);
	}

	return nextSections;
}

function parseSectionConfigs(rawSectionConfigs: unknown): Partial<Record<SectionType, unknown>> | undefined {
	if (rawSectionConfigs === undefined) {
		return undefined;
	}

	if (rawSectionConfigs === null || typeof rawSectionConfigs !== 'object' || Array.isArray(rawSectionConfigs)) {
		throw new Error('sectionConfigs must be an object when provided');
	}

	const validSections = new Set<SectionType>(SYNC_SECTION_ORDER);
	const sectionConfigMap: Record<string, unknown> = rawSectionConfigs as Record<string, unknown>;
	const parsed: Partial<Record<SectionType, unknown>> = {};

	for (const [rawSection, rawConfig] of Object.entries(sectionConfigMap)) {
		if (!validSections.has(rawSection as SectionType)) {
			throw new Error(`Invalid section config key: ${rawSection}`);
		}

		parsed[rawSection as SectionType] = rawConfig;
	}

	return parsed;
}

function parseCreateRequest(body: unknown): CreatePreviewResult {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new Error('Request body must be an object');
	}

	const { instanceId, sections, sectionConfigs } = body as CreateRequestBody;
	if (typeof instanceId !== 'number' || !Number.isInteger(instanceId) || instanceId <= 0) {
		throw new Error('instanceId is required');
	}

	return {
		previewId: `preview_${instanceId}_${Date.now()}_${uuid()}`,
		instanceId,
		instanceName: '',
		arrType: 'radarr',
		sections: parseSectionOrderValue(sections),
		sectionConfigs: parseSectionConfigs(sectionConfigs),
	};
}

function createInitialSummary(): SyncPreviewSummary {
	return {
		totalCreates: 0,
		totalUpdates: 0,
		totalDeletes: 0,
		totalUnchanged: 0,
	};
}

function createInitialPreview(request: CreatePreviewResult): SyncPreviewResult {
	return {
		id: request.previewId,
		instanceId: request.instanceId,
		instanceName: request.instanceName,
		arrType: request.arrType,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
		status: PREVIEW_STATUS_GENERATING,
		sections: request.sections ?? [],
		qualityProfiles: null,
		delayProfiles: null,
		mediaManagement: null,
		metadataProfiles: null,
		summary: createInitialSummary(),
	};
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
	}

	let requestPayload: CreatePreviewResult;
	try {
		requestPayload = parseCreateRequest(body);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid request body';
		return json({ error: message } satisfies ErrorResponse, { status: 400 });
	}

	const instance = arrInstancesQueries.getById(requestPayload.instanceId);
	if (!instance) {
		return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
	}

	if (!isSyncPreviewArrType(instance.type)) {
		return json({ error: `Unsupported instance type: ${instance.type}` } satisfies ErrorResponse, { status: 400 });
	}

	if (!instance.enabled) {
		return json({ error: 'Instance is disabled' } satisfies ErrorResponse, { status: 400 });
	}

	const nowMs = Date.now();
	requestPayload = {
		...requestPayload,
		instanceName: instance.name,
		arrType: instance.type,
	};

	const initialPreview = createInitialPreview(requestPayload);
	let storedPreview = previewStore.create(initialPreview, nowMs);

	await logger.info('Generating sync preview', {
		source: 'SyncPreview',
		meta: {
			previewId: storedPreview.id,
			instanceId: requestPayload.instanceId,
			instanceName: requestPayload.instanceName,
			instanceType: instance.type,
		},
	});

	const requestedSections = requestPayload.sections?.length ? requestPayload.sections : undefined;

	try {
		const generated = await generatePreview({
			instance,
			sections: requestedSections,
			sectionConfigs: requestPayload.sectionConfigs,
			nowMs,
		});

		const errors = generated.errors ?? [];
		const statusError = errors.length > 0 ? `Preview generation completed with ${errors.length} section error(s)` : undefined;

		storedPreview = previewStore.updateResult(storedPreview.id, {
			status: PREVIEW_STATUS_READY,
			sections: generated.sections,
			qualityProfiles: generated.qualityProfiles,
			delayProfiles: generated.delayProfiles,
			mediaManagement: generated.mediaManagement,
			metadataProfiles: generated.metadataProfiles,
			summary: generated.summary,
			error: statusError,
			instanceName: generated.instanceName,
		})!;

		if (!storedPreview) {
			return json({ error: 'Failed to persist preview result' } satisfies ErrorResponse, { status: 500 });
		}

		return json(storedPreview);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Failed to generate preview';

		previewStore.updateResult(storedPreview.id, {
			status: PREVIEW_STATUS_FAILED,
			error: errorMessage,
		});

		await logger.error('Failed to generate sync preview', {
			source: 'SyncPreview',
			meta: {
				previewId: storedPreview.id,
				instanceId: requestPayload.instanceId,
				instanceName: requestPayload.instanceName,
				error: errorMessage,
			},
		});

		return json({ error: errorMessage } satisfies ErrorResponse, { status: 500 });
	}
};
