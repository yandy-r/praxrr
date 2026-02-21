import { HttpError } from '$http/types.ts';
import { pcdManager } from '$pcd/index.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type {
	ArrDelayProfile,
	ArrMediaManagementConfig,
	ArrNamingConfig,
	ArrQualityDefinition,
	LidarrMetadataProfileListResponse,
} from '$arr/types.ts';
import { assertStartupArrType, createAdapterResultEnvelope, getStartupSectionSupportReason, incrementCounter, isStartupSectionSupported, type StartupAdapterResultEnvelope } from './shared.ts';
import {
	makeStartupMatchNoMatchResult,
} from '../matching.ts';
import {
	shouldSkipStartupDefault,
} from '../defaultFilters.ts';
import {
	buildRemoteNamingSnapshot,
	buildRemoteMediaSettingsSnapshot,
	buildRemoteQualityDefinitionsSnapshot,
	buildMatchRequestFromRemoteSnapshot,
	collectStartupMediaManagementCandidates,
	classifyMediaManagementMatch,
} from '../mediaManagement.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import * as delayProfileQueries from '$pcd/entities/delayProfiles/read.ts';
import {
	collectStartupMetadataProfileCandidates,
	buildRemoteMetadataProfileSnapshot,
	classifyMetadataProfileMatch,
} from './lidarrMetadata.ts';
import type {
	StartupPullArrType,
	StartupPullEntityDescriptor,
	StartupPullInstanceInput,
	StartupPullMatchRequest,
	StartupPullMatchResult,
	StartupPullSection,
} from '../types.ts';
import {
	buildDelayProfileFingerprintFromArr,
	buildDelayProfileFingerprintFromLocal,
	matchDelayProfileByFingerprint,
	matchManagedStartupProfileByNamespace,
	selectDefaultDelayProfileForStartup,
} from '../profileMatching.ts';

export type LidarrStartupFetchFailureKind = 'auth' | 'unreachable' | 'unknown';

export interface LidarrUnsupportedSection {
	readonly section: StartupPullSection;
	readonly reason: string;
}

export interface LidarrStartupRemoteSnapshot {
	readonly supportedSections: readonly StartupPullSection[];
	readonly unsupportedSections: readonly LidarrUnsupportedSection[];
	readonly resources: {
		readonly qualityProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly delayProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly naming: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly mediaSettings: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly qualityDefinitions: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly metadataProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
	};
}

export interface LidarrStartupFetchFailure {
	readonly success: false;
	readonly kind: LidarrStartupFetchFailureKind;
	readonly statusCode: number | null;
	readonly message: string;
}

export interface LidarrStartupFetchSuccess {
	readonly success: true;
	readonly snapshot: LidarrStartupRemoteSnapshot;
}

export type LidarrStartupFetchResult = LidarrStartupFetchSuccess | LidarrStartupFetchFailure;

export interface LidarrStartupCandidates {
	readonly qualityProfiles: readonly StartupPullEntityDescriptor[];
	readonly delayProfiles: readonly StartupPullEntityDescriptor[];
	readonly naming: readonly StartupPullEntityDescriptor[];
	readonly mediaSettings: readonly StartupPullEntityDescriptor[];
	readonly qualityDefinitions: readonly StartupPullEntityDescriptor[];
	readonly metadataProfiles: readonly StartupPullEntityDescriptor[];
}

export interface LidarrStartupMatchRunResult {
	readonly status: 'success' | 'failed';
	readonly failureKind: LidarrStartupFetchFailureKind | null;
	readonly envelope: StartupAdapterResultEnvelope;
	readonly matches: readonly StartupPullMatchResult[];
	readonly unsupportedSections: readonly LidarrUnsupportedSection[];
}

const LIDARR_SECTIONS: readonly StartupPullSection[] = [
	'qualityProfiles',
	'delayProfiles',
	'naming',
	'mediaSettings',
	'qualityDefinitions',
	'metadataProfiles',
] as const;

const LIDARR_STARTUP_ERROR_MESSAGE_PREFIX = 'Lidarr startup adapter fetch failed';

interface LidarrStartupClient {
	getQualityProfiles(): Promise<ReadonlyArray<{ readonly id: number; readonly name: string }>>;
	getDelayProfiles(): Promise<ReadonlyArray<ArrDelayProfile>>;
	getNamingConfig(): Promise<ArrNamingConfig>;
	getMediaManagementConfig(): Promise<ArrMediaManagementConfig>;
	getQualityDefinitions(): Promise<ReadonlyArray<ArrQualityDefinition>>;
	getMetadataProfiles(): Promise<LidarrMetadataProfileListResponse>;
}

function getDelayProfileName(profile: ArrDelayProfile): string {
	const rawName = (profile as { name?: unknown }).name;
	if (typeof rawName === 'string' && rawName.length > 0) {
		return rawName;
	}

	return `Delay Profile ${profile.id}`;
}

function classifyLidarrFetchError(error: unknown): LidarrStartupFetchFailure {
	if (error instanceof HttpError) {
		if (error.status === 401 || error.status === 403) {
			return {
				success: false,
				kind: 'auth',
				statusCode: error.status,
				message: `${LIDARR_STARTUP_ERROR_MESSAGE_PREFIX}: authentication rejected by Lidarr (HTTP ${error.status}).`,
			};
		}

		if (
			error.status === 0 ||
			error.status === 408 ||
			error.status === 500 ||
			error.status === 502 ||
			error.status === 503 ||
			error.status === 504
		) {
			return {
				success: false,
				kind: 'unreachable',
				statusCode: error.status,
				message: `${LIDARR_STARTUP_ERROR_MESSAGE_PREFIX}: unable to reach Lidarr API (HTTP ${error.status}).`,
			};
		}

		return {
			success: false,
			kind: 'unknown',
			statusCode: error.status,
			message: `${LIDARR_STARTUP_ERROR_MESSAGE_PREFIX}: Lidarr API returned HTTP ${error.status}.`,
		};
	}

	if (error instanceof Error) {
		return {
			success: false,
			kind: 'unreachable',
			statusCode: null,
			message: `${LIDARR_STARTUP_ERROR_MESSAGE_PREFIX}: ${error.message}`,
		};
	}

	return {
		success: false,
		kind: 'unknown',
		statusCode: null,
		message: `${LIDARR_STARTUP_ERROR_MESSAGE_PREFIX}.`,
	};
}

function sortDescriptorSnapshots(items: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[]): Omit<StartupPullEntityDescriptor, 'databaseId'>[] {
	return [...items].sort((left, right) => {
		const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
		if (byName !== 0) {
			return byName;
		}

		return String(left.id).localeCompare(String(right.id));
	});
}

function sortStartupCandidates(items: readonly StartupPullEntityDescriptor[]): StartupPullEntityDescriptor[] {
	return [...items].sort((left, right) => {
		const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
		if (byName !== 0) {
			return byName;
		}

		if (left.databaseId !== right.databaseId) {
			return left.databaseId - right.databaseId;
		}

		return String(left.id).localeCompare(String(right.id));
	});
}

function incrementCountersFromMatchResult(
	envelope: StartupAdapterResultEnvelope,
	result: StartupPullMatchResult
): void {
	if (result.status === 'matched') {
		incrementCounter(envelope, 'imported');
		return;
	}

	if (result.status === 'conflicted') {
		incrementCounter(envelope, 'conflicted');
		return;
	}

	if (result.status === 'no_match' && result.reason === 'default_skip') {
		incrementCounter(envelope, 'skipped_default');
		return;
	}

	incrementCounter(envelope, 'skipped_no_match');
}

function buildUnsupportedSectionResult(
	instanceId: number,
	databaseId: number,
	reason: LidarrUnsupportedSection
): StartupPullMatchResult {
	return {
		...makeStartupMatchNoMatchResult(
			{
				instanceId,
				databaseId,
				section: reason.section,
				arrType: 'lidarr',
				remote: {
					id: `unsupported:${reason.section}`,
					name: reason.section,
					section: reason.section,
					arrType: 'lidarr',
					databaseId,
				},
				candidates: [],
			},
			'unsupported_section',
			{
				hasFingerprintAttempt: false,
			}
		),
		reason: 'unsupported_section',
	};
}

function classifyLidarrManagedProfileMatch(input: StartupPullMatchRequest): StartupPullMatchResult {
	const skipDefault = shouldSkipStartupDefault(input.arrType, input.section, input.remote);
	if (skipDefault.skip) {
		return makeStartupMatchNoMatchResult(input, 'default_skip', {
			hasFingerprintAttempt: input.remote.fingerprint !== null,
		});
	}

	const result = matchManagedStartupProfileByNamespace(input);

	if (result.status !== 'matched' || result.matchedEntityId === null || result.matchedEntityId === undefined) {
		return result;
	}

	const matchedCandidate = input.candidates.find((candidate) => candidate.id === result.matchedEntityId);
	if (!matchedCandidate) {
		return result;
	}

	return {
		...result,
		databaseId: matchedCandidate.databaseId,
		matchedEntityId: matchedCandidate.id,
		matchedEntityName: matchedCandidate.name,
	};
}

function classifyLidarrDelayProfileMatch(input: StartupPullMatchRequest): StartupPullMatchResult {
	const result = matchDelayProfileByFingerprint(input);

	if (result.status !== 'matched' || result.matchedEntityId === null || result.matchedEntityId === undefined) {
		return result;
	}

	const matchedCandidate = input.candidates.find((candidate) => candidate.id === result.matchedEntityId);
	if (!matchedCandidate) {
		return result;
	}

	return {
		...result,
		databaseId: matchedCandidate.databaseId,
		matchedEntityId: matchedCandidate.id,
		matchedEntityName: matchedCandidate.name,
	};
}

export async function collectRemoteSectionSnapshots(
	client: BaseArrClient
): Promise<LidarrStartupFetchResult> {
	const lidarrClient = client as unknown as LidarrStartupClient;
	const unsupportedSections: LidarrUnsupportedSection[] = [];
	const supportedSections: StartupPullSection[] = [];

	for (const section of LIDARR_SECTIONS) {
		const reason = getStartupSectionSupportReason('lidarr', section);
		if (reason === null) {
			supportedSections.push(section);
			continue;
		}

		unsupportedSections.push({ section, reason });
	}

	try {
		const [qualityProfiles, delayProfiles, naming, mediaSettings, qualityDefinitions, metadataProfiles] =
			await Promise.all([
				isStartupSectionSupported('lidarr', 'qualityProfiles')
					? lidarrClient.getQualityProfiles()
					: Promise.resolve([] as const),
				isStartupSectionSupported('lidarr', 'delayProfiles')
					? lidarrClient.getDelayProfiles()
					: Promise.resolve([] as const),
				isStartupSectionSupported('lidarr', 'naming')
					? lidarrClient.getNamingConfig()
					: Promise.resolve(null as ArrNamingConfig | null),
				isStartupSectionSupported('lidarr', 'mediaSettings')
					? lidarrClient.getMediaManagementConfig()
					: Promise.resolve(null as ArrMediaManagementConfig | null),
				isStartupSectionSupported('lidarr', 'qualityDefinitions')
					? lidarrClient.getQualityDefinitions()
					: Promise.resolve([] as const),
				isStartupSectionSupported('lidarr', 'metadataProfiles')
					? lidarrClient.getMetadataProfiles()
					: Promise.resolve([] as const),
			]);

		const remoteQualityProfiles = sortDescriptorSnapshots(
			qualityProfiles.map((profile) => ({
				id: profile.id,
				name: profile.name,
				section: 'qualityProfiles',
				arrType: 'lidarr',
				databaseId: -1,
				fingerprint: null,
			}))
		);

		const remoteDelayProfiles = sortDescriptorSnapshots(
			(() => {
				const defaultDelayProfile = selectDefaultDelayProfileForStartup('lidarr', delayProfiles);
				if (!defaultDelayProfile) {
					return [];
				}

				return [
					{
						id: defaultDelayProfile.id,
						name: getDelayProfileName(defaultDelayProfile),
						section: 'delayProfiles' as const,
						arrType: 'lidarr' as const,
						databaseId: -1,
						fingerprint: buildDelayProfileFingerprintFromArr(defaultDelayProfile),
					},
				];
			})()
		);

		const remoteMetadataProfiles = sortDescriptorSnapshots(
			metadataProfiles.map((profile) => buildRemoteMetadataProfileSnapshot(profile))
		);

		const resources = {
			qualityProfiles: remoteQualityProfiles,
			delayProfiles: remoteDelayProfiles,
			naming: naming ? sortDescriptorSnapshots([buildRemoteNamingSnapshot('lidarr', naming)]) : [],
			mediaSettings: mediaSettings
				? sortDescriptorSnapshots([buildRemoteMediaSettingsSnapshot(mediaSettings, 'lidarr')])
				: [],
			qualityDefinitions: qualityDefinitions
				? sortDescriptorSnapshots([buildRemoteQualityDefinitionsSnapshot(qualityDefinitions, 'lidarr')])
				: [],
			metadataProfiles: remoteMetadataProfiles,
		};

		return {
			success: true,
			snapshot: {
				supportedSections,
				unsupportedSections,
				resources,
			},
		};
	} catch (error) {
		return classifyLidarrFetchError(error);
	}
}

export async function collectLidarrStartupCandidates(
	databaseIds: readonly number[]
): Promise<LidarrStartupCandidates> {
	const qualityProfiles: StartupPullEntityDescriptor[] = [];
	const delayProfiles: StartupPullEntityDescriptor[] = [];
	const naming: StartupPullEntityDescriptor[] = [];
	const mediaSettings: StartupPullEntityDescriptor[] = [];
	const qualityDefinitions: StartupPullEntityDescriptor[] = [];
	const metadataProfiles: StartupPullEntityDescriptor[] = [];

	for (const databaseId of databaseIds) {
		const cache = pcdManager.getCache(databaseId);
		if (!cache) continue;

		const [qualityProfileRows, delayProfileRows, mediaManagementCandidates, metadataProfileCandidates] =
			await Promise.all([
				qualityProfileQueries.list(cache, 'lidarr'),
				delayProfileQueries.list(cache),
				collectStartupMediaManagementCandidates(cache, databaseId, 'lidarr'),
				collectStartupMetadataProfileCandidates(cache, databaseId),
			]);

		for (const row of qualityProfileRows) {
			qualityProfiles.push({
				id: row.id,
				name: row.name,
				section: 'qualityProfiles',
				arrType: 'lidarr',
				databaseId,
			});
		}

		for (const row of delayProfileRows) {
			delayProfiles.push({
				id: row.id,
				name: row.name,
				section: 'delayProfiles',
				arrType: 'lidarr',
				databaseId,
				fingerprint: buildDelayProfileFingerprintFromLocal(row),
			});
		}

		naming.push(...mediaManagementCandidates.naming);
		mediaSettings.push(...mediaManagementCandidates.mediaSettings);
		qualityDefinitions.push(...mediaManagementCandidates.qualityDefinitions);
		metadataProfiles.push(...metadataProfileCandidates);
	}

	return {
		qualityProfiles: sortStartupCandidates(qualityProfiles),
		delayProfiles: sortStartupCandidates(delayProfiles),
		naming: sortStartupCandidates(naming),
		mediaSettings: sortStartupCandidates(mediaSettings),
		qualityDefinitions: sortStartupCandidates(qualityDefinitions),
		metadataProfiles: sortStartupCandidates(metadataProfiles),
	};
}

export async function matchLidarrStartupResources(
	input: StartupPullInstanceInput,
	snapshot: LidarrStartupRemoteSnapshot,
	candidates: LidarrStartupCandidates
): Promise<LidarrStartupMatchRunResult> {
	const arrType = assertStartupArrType(input.arrType, 'lidarr', 'Cannot process non-Lidarr instance in Lidarr adapter');
	const envelope = createAdapterResultEnvelope('skipped');
	const matches: StartupPullMatchResult[] = [];
	const fallbackDatabaseId = input.databaseIds[0] ?? 0;

	for (const unsupportedSection of snapshot.unsupportedSections) {
		const result = buildUnsupportedSectionResult(input.instanceId, fallbackDatabaseId, unsupportedSection);
		matches.push(result);
		incrementCountersFromMatchResult(envelope, result);
	}

	for (const section of snapshot.supportedSections) {
		if (section === 'qualityProfiles') {
			for (const remoteProfile of snapshot.resources.qualityProfiles) {
				const remoteSectionProfile = {
					...remoteProfile,
					databaseId: fallbackDatabaseId,
				};
				const result = classifyLidarrManagedProfileMatch({
					instanceId: input.instanceId,
					databaseId: fallbackDatabaseId,
					section,
					arrType,
					remote: remoteSectionProfile,
					candidates: candidates.qualityProfiles,
				});
				matches.push(result);
				incrementCountersFromMatchResult(envelope, result);
			}
			continue;
		}

		if (section === 'delayProfiles') {
			for (const remoteProfile of snapshot.resources.delayProfiles) {
				const remoteSectionProfile = {
					...remoteProfile,
					databaseId: fallbackDatabaseId,
				};
				const result = classifyLidarrDelayProfileMatch({
					instanceId: input.instanceId,
					databaseId: fallbackDatabaseId,
					section,
					arrType,
					remote: remoteSectionProfile,
					candidates: candidates.delayProfiles,
				});
				matches.push(result);
				incrementCountersFromMatchResult(envelope, result);
			}
			continue;
		}

		if (section === 'naming') {
			for (const remoteProfile of snapshot.resources.naming) {
				const result = classifyMediaManagementMatch(
					buildMatchRequestFromRemoteSnapshot(
						input.instanceId,
						fallbackDatabaseId,
						'naming',
						arrType,
						remoteProfile,
						candidates.naming
					)
				);
				matches.push(result);
				incrementCountersFromMatchResult(envelope, result);
			}
			continue;
		}

		if (section === 'mediaSettings') {
			for (const remoteProfile of snapshot.resources.mediaSettings) {
				const result = classifyMediaManagementMatch(
					buildMatchRequestFromRemoteSnapshot(
						input.instanceId,
						fallbackDatabaseId,
						'mediaSettings',
						arrType,
						remoteProfile,
						candidates.mediaSettings
					)
				);
				matches.push(result);
				incrementCountersFromMatchResult(envelope, result);
			}
			continue;
		}

		if (section === 'qualityDefinitions') {
			for (const remoteProfile of snapshot.resources.qualityDefinitions) {
				const result = classifyMediaManagementMatch(
					buildMatchRequestFromRemoteSnapshot(
						input.instanceId,
						fallbackDatabaseId,
						'qualityDefinitions',
						arrType,
						remoteProfile,
						candidates.qualityDefinitions
					)
				);
				matches.push(result);
				incrementCountersFromMatchResult(envelope, result);
			}
			continue;
		}

		if (section === 'metadataProfiles') {
			for (const remoteProfile of snapshot.resources.metadataProfiles) {
				const remoteMetadataProfile = {
					...remoteProfile,
					databaseId: fallbackDatabaseId,
				};
				const result = classifyMetadataProfileMatch({
					instanceId: input.instanceId,
					databaseId: fallbackDatabaseId,
					section,
					arrType,
					remote: remoteMetadataProfile,
					candidates: candidates.metadataProfiles,
				});
				matches.push(result);
				incrementCountersFromMatchResult(envelope, result);
			}
		}
	}

	envelope.status = matches.length === 0 ? 'skipped' : envelope.counters.failed > 0 ? 'failure' : 'success';

	return {
		status: envelope.status === 'failure' ? 'failed' : 'success',
		failureKind: null,
		envelope,
		matches,
		unsupportedSections: snapshot.unsupportedSections,
	};
};

export async function runLidarrStartupAdapter(
	input: StartupPullInstanceInput,
	client: BaseArrClient
): Promise<LidarrStartupMatchRunResult> {
	assertStartupArrType(input.arrType, 'lidarr', 'Cannot run non-Lidarr adapter');
	const fetchResult = await collectRemoteSectionSnapshots(client);

	if (!fetchResult.success) {
		const envelope = createAdapterResultEnvelope('failure');
		incrementCounter(envelope, 'failed');
		envelope.error = `${fetchResult.message} (${fetchResult.kind})`;

		return {
			status: 'failed',
			failureKind: fetchResult.kind,
			envelope,
			matches: [],
			unsupportedSections: [],
		};
	}

	const candidates = await collectLidarrStartupCandidates(input.databaseIds);
	return matchLidarrStartupResources(input, fetchResult.snapshot, candidates);
}

export const lidarrStartupAdapter = {
	arrType: 'lidarr' as const,
	fetch: collectRemoteSectionSnapshots,
	collectCandidates: collectLidarrStartupCandidates,
	match: matchLidarrStartupResources,
	run: runLidarrStartupAdapter,
} as const;
