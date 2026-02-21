/**
 * Preview orchestrator
 * Coordinates read-only section preview generation with ordered dispatch
 * and partial-failure accumulation.
 */

import { createArrInstanceClientCache, getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import { logger } from '$logger/logger.ts';
import { SYNC_SECTION_ORDER, type SyncArrType } from '../mappings.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { getSection } from '../registry.ts';
import { PREVIEW_STATUS_READY } from './store.ts';
import type { BaseSyncer, SectionType } from '../types.ts';
import type {
	SyncPreviewSectionResult,
	SyncPreviewSummary,
	SyncPreviewArrType,
	QualityProfilesPreview,
	DelayProfilesPreview,
	MediaManagementPreview,
	MetadataProfilesPreview,
	EntityChange,
} from './types.ts';
import type { SyncPreviewStatus } from './types.ts';

const SOURCE = 'PreviewOrchestrator';

interface SectionOutcome {
	section: SectionType;
	result: SyncPreviewSectionResult | null;
	error: string | null;
	skipped: boolean;
}

interface MutableSyncPreviewSummary {
	totalCreates: number;
	totalUpdates: number;
	totalDeletes: number;
	totalUnchanged: number;
}

export interface GeneratePreviewInput {
	instance: ArrInstance;
	sections?: SectionType[];
	sectionConfigs?: Partial<Record<SectionType, unknown>>;
	nowMs?: number;
}

export interface GeneratePreviewResult {
	instanceId: number;
	instanceName: string;
	arrType: SyncPreviewArrType;
	status: SyncPreviewStatus;
	createdAtMs: number;
	sections: SectionType[];
	sectionOutcomes: SectionOutcome[];
	qualityProfiles: QualityProfilesPreview | null;
	delayProfiles: DelayProfilesPreview | null;
	mediaManagement: MediaManagementPreview | null;
	metadataProfiles: MetadataProfilesPreview | null;
	summary: SyncPreviewSummary;
	errors: ReadonlyArray<string>;
	error?: string;
}

function toSyncArrType(value: string): SyncArrType | null {
	if (value === 'radarr' || value === 'sonarr' || value === 'lidarr') {
		return value;
	}

	return null;
}

function dedupeRequestedSections(requestedSections: SectionType[]): SectionType[] {
	const seen = new Set<SectionType>();
	const sections: SectionType[] = [];
	for (const section of requestedSections) {
		if (seen.has(section)) {
			continue;
		}

		seen.add(section);
		sections.push(section);
	}

	return sections;
}

function resolveSections(instanceId: number, requestedSections: SectionType[] | undefined): SectionType[] {
	if (!requestedSections || requestedSections.length === 0) {
		return SYNC_SECTION_ORDER.filter((section) => {
			const handler = getSection(section);
			return handler.hasConfig(instanceId);
		});
	}

	return dedupeRequestedSections(requestedSections).filter((section) => SYNC_SECTION_ORDER.includes(section));
}

function addActionToSummary(summary: MutableSyncPreviewSummary, action: EntityChange['action']): void {
	switch (action) {
		case 'create':
			summary.totalCreates += 1;
			return;
		case 'update':
			summary.totalUpdates += 1;
			return;
		case 'delete':
			summary.totalDeletes += 1;
			return;
		case 'unchanged':
			summary.totalUnchanged += 1;
			return;
	}
}

function accumulateEntityChanges(summary: SyncPreviewSummary, entities: readonly EntityChange[] | null): void {
	if (!entities) {
		return;
	}

	for (const entity of entities) {
		addActionToSummary(summary, entity.action);
	}
}

function buildEmptySummary(): MutableSyncPreviewSummary {
	return {
		totalCreates: 0,
		totalUpdates: 0,
		totalDeletes: 0,
		totalUnchanged: 0,
	};
}

function accumulateSectionSummary(summary: SyncPreviewSummary, sectionResult: SyncPreviewSectionResult): void {
	switch (sectionResult.section) {
		case 'qualityProfiles':
			accumulateEntityChanges(summary, sectionResult.customFormats);
			accumulateEntityChanges(summary, sectionResult.qualityProfiles);
			return;
		case 'delayProfiles':
			accumulateEntityChanges(summary, sectionResult.profile ? [sectionResult.profile] : null);
			return;
		case 'mediaManagement':
			accumulateEntityChanges(summary, sectionResult.naming ? [sectionResult.naming] : null);
			accumulateEntityChanges(summary, sectionResult.mediaSettings ? [sectionResult.mediaSettings] : null);
			accumulateEntityChanges(summary, sectionResult.qualityDefinitions);
			return;
		case 'metadataProfiles':
			accumulateEntityChanges(summary, sectionResult.profile ? [sectionResult.profile] : null);
			return;
	}
}

function buildSectionPayloads(
	sectionOutcomes: readonly SectionOutcome[]
): {
	qualityProfiles: QualityProfilesPreview | null;
	delayProfiles: DelayProfilesPreview | null;
	mediaManagement: MediaManagementPreview | null;
	metadataProfiles: MetadataProfilesPreview | null;
	summary: SyncPreviewSummary;
} {
	let qualityProfiles: QualityProfilesPreview | null = null;
	let delayProfiles: DelayProfilesPreview | null = null;
	let mediaManagement: MediaManagementPreview | null = null;
	let metadataProfiles: MetadataProfilesPreview | null = null;
	const summary = buildEmptySummary();

	for (const outcome of sectionOutcomes) {
		if (!outcome.result || outcome.error || outcome.skipped) {
			continue;
		}

		accumulateSectionSummary(summary, outcome.result);

		switch (outcome.result.section) {
			case 'qualityProfiles':
				qualityProfiles = outcome.result;
				break;
			case 'delayProfiles':
				delayProfiles = outcome.result;
				break;
			case 'mediaManagement':
				mediaManagement = outcome.result;
				break;
			case 'metadataProfiles':
				metadataProfiles = outcome.result;
				break;
		}
	}

	return { qualityProfiles, delayProfiles, mediaManagement, metadataProfiles, summary };
}

export async function generatePreview(input: GeneratePreviewInput): Promise<GeneratePreviewResult> {
	const arrType = toSyncArrType(input.instance.type);
	if (!arrType) {
		throw new Error(`Unsupported arr type: ${input.instance.type}`);
	}

	const nowMs = input.nowMs ?? Date.now();
	const sectionsToRun = resolveSections(input.instance.id, input.sections);

	if (sectionsToRun.length === 0) {
		await logger.debug('No preview sections to run for instance', {
			source: SOURCE,
			meta: {
				instanceId: input.instance.id,
				instanceName: input.instance.name,
				arrType,
			},
		});
	}

	const sectionOutcomes: SectionOutcome[] = [];
	const errors: string[] = [];

	const client = await getArrInstanceClient(arrType, input.instance.id, input.instance.url, undefined, createArrInstanceClientCache());
	const { id: instanceId, name: instanceName, type: instanceType } = input.instance;

	try {
		for (const section of sectionsToRun) {
			const handler = getSection(section);
			const hasSectionPreviewConfig =
				input.sectionConfigs !== undefined &&
				Object.prototype.hasOwnProperty.call(input.sectionConfigs, section);
			let syncer: BaseSyncer | null = null;

			if (!handler.hasConfig(input.instance.id) && !hasSectionPreviewConfig) {
				sectionOutcomes.push({
					section,
					result: null,
					error: null,
					skipped: true,
				});
				continue;
			}

			try {
				syncer = handler.createSyncer(client, input.instance);
				if (input.sectionConfigs?.[section] !== undefined) {
					syncer.setPreviewConfig(input.sectionConfigs[section]);
				}

				const result = await syncer.generatePreview();
				sectionOutcomes.push({
					section,
					result,
					error: null,
					skipped: false,
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				errors.push(`Section ${section} failed: ${errorMessage}`);
				sectionOutcomes.push({
					section,
					result: null,
					error: errorMessage,
					skipped: false,
				});
				await logger.error(`Preview section ${section} failed for ${input.instance.name}`, {
					source: SOURCE,
					meta: {
						instanceId,
						instanceName,
						instanceType,
						section,
						error: errorMessage,
					},
				});
			} finally {
				if (syncer) {
					syncer.clearPreviewConfig();
				}
			}
		}
	} finally {
		client.close();
	}

	const payloads = buildSectionPayloads(sectionOutcomes);
	const statusError = errors.length > 0 ? `Preview generation completed with ${errors.length} section error(s)` : undefined;

	return {
		instanceId,
		instanceName,
		arrType,
		status: PREVIEW_STATUS_READY,
		createdAtMs: nowMs,
		sections: sectionsToRun,
		sectionOutcomes,
		qualityProfiles: payloads.qualityProfiles,
		delayProfiles: payloads.delayProfiles,
		mediaManagement: payloads.mediaManagement,
		metadataProfiles: payloads.metadataProfiles,
		summary: payloads.summary,
		errors,
		error: statusError,
	};
}
