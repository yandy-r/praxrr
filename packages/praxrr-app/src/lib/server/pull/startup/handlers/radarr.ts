import { HttpError } from '$http/types.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrDelayProfile } from '$arr/types.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import * as delayProfileQueries from '$pcd/entities/delayProfiles/read.ts';
import { pcdManager } from '$pcd/index.ts';
import {
	assertStartupArrType,
	createAdapterResultEnvelope,
	getStartupSectionSupportReason,
	type StartupAdapterResultEnvelope,
	incrementCounter,
} from './shared.ts';
import {
	StartupPullArrType,
	type StartupPullEntityDescriptor,
	type StartupPullInstanceInput,
	type StartupPullMatchReason,
	type StartupPullMatchResult,
	type StartupPullSection,
} from '../types.ts';
import {
	buildMatchRequestFromRemoteSnapshot,
	buildRemoteMediaSettingsSnapshot,
	buildRemoteNamingSnapshot,
	buildRemoteQualityDefinitionsSnapshot,
	classifyMediaManagementMatch,
	collectStartupMediaManagementCandidates,
} from '../mediaManagement.ts';
import { matchStartupEntity, makeStartupMatchNoMatchResult } from '../matching.ts';
import { shouldSkipStartupDefault } from '../defaultFilters.ts';

export type RadarrStartupFetchFailureKind = 'auth' | 'unreachable' | 'unknown';

export interface RadarrUnsupportedSection {
	readonly section: StartupPullSection;
	readonly reason: string;
}

export interface RadarrStartupRemoteSnapshot {
	readonly supportedSections: readonly StartupPullSection[];
	readonly unsupportedSections: readonly RadarrUnsupportedSection[];
	readonly resources: {
		readonly qualityProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly delayProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly naming: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly mediaSettings: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly qualityDefinitions: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
		readonly metadataProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
	};
}

export interface RadarrStartupFetchFailure {
	readonly success: false;
	readonly kind: RadarrStartupFetchFailureKind;
	readonly statusCode: number | null;
	readonly message: string;
}

export interface RadarrStartupFetchSuccess {
	readonly success: true;
	readonly snapshot: RadarrStartupRemoteSnapshot;
}

export type RadarrStartupFetchResult = RadarrStartupFetchSuccess | RadarrStartupFetchFailure;

export interface RadarrStartupCandidates {
	readonly qualityProfiles: readonly StartupPullEntityDescriptor[];
	readonly delayProfiles: readonly StartupPullEntityDescriptor[];
	readonly naming: readonly StartupPullEntityDescriptor[];
	readonly mediaSettings: readonly StartupPullEntityDescriptor[];
	readonly qualityDefinitions: readonly StartupPullEntityDescriptor[];
	readonly metadataProfiles: readonly StartupPullEntityDescriptor[];
}

export interface RadarrStartupMatchRunResult {
	readonly status: 'success' | 'failed';
	readonly failureKind: RadarrStartupFetchFailureKind | null;
	readonly envelope: StartupAdapterResultEnvelope;
	readonly matches: readonly StartupPullMatchResult[];
	readonly unsupportedSections: readonly RadarrUnsupportedSection[];
}

const RADARR_SECTIONS: readonly StartupPullSection[] = [
	'qualityProfiles',
	'delayProfiles',
	'metadataProfiles',
	'naming',
	'mediaSettings',
	'qualityDefinitions',
] as const;

function classifyRadarrFetchError(error: unknown): RadarrStartupFetchFailure {
	if (error instanceof HttpError) {
		if (error.status === 401 || error.status === 403) {
			return {
				success: false,
				kind: 'auth',
				statusCode: error.status,
				message: `Radarr startup adapter fetch failed: authentication rejected by Radarr (HTTP ${error.status}).`,
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
				message: `Radarr startup adapter fetch failed: unable to reach Radarr API (HTTP ${error.status}).`,
			};
		}

		return {
				success: false,
				kind: 'unknown',
				statusCode: error.status,
				message: `Radarr startup adapter fetch failed: Radarr API returned HTTP ${error.status}.`,
			};
		}

	if (error instanceof Error) {
		return {
			success: false,
			kind: 'unreachable',
			statusCode: null,
			message: `Radarr startup adapter fetch failed: ${error.message}`,
		};
	}

	return {
		success: false,
		kind: 'unknown',
		statusCode: null,
		message: 'Radarr startup adapter fetch failed due to an unknown error.',
	};
}

function toSectionSnapshot(
	values: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[]
): readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[] {
	return [...values].sort((left, right) => {
		const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
		if (byName !== 0) {
			return byName;
		}

		return String(left.id).localeCompare(String(right.id));
	});
}

function getDelayProfileName(profile: ArrDelayProfile): string {
	const rawName = (profile as { name?: unknown }).name;
	if (typeof rawName === 'string' && rawName.length > 0) {
		return rawName;
	}

	return `Delay Profile ${profile.id}`;
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
	reason: RadarrUnsupportedSection
): StartupPullMatchResult {
	return {
		...makeStartupMatchNoMatchResult(
			{
				instanceId,
				databaseId,
				section: reason.section,
				arrType: 'radarr',
				remote: {
					id: `unsupported:${reason.section}`,
					name: reason.section,
					section: reason.section,
					arrType: 'radarr',
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

function matchSectionByNameThenFingerprint(
	instanceId: number,
	databaseId: number,
	section: Extract<StartupPullSection, 'qualityProfiles' | 'delayProfiles'>,
	arrType: StartupPullArrType,
	remote: Omit<StartupPullEntityDescriptor, 'databaseId'>,
	candidates: readonly StartupPullEntityDescriptor[]
): StartupPullMatchResult {
	const request = {
		instanceId,
		databaseId,
		section,
		arrType,
		remote: {
			...remote,
			databaseId,
		},
		candidates,
	};

	const skip = shouldSkipStartupDefault(request.arrType, request.section, request.remote);
	if (skip.skip) {
		return makeStartupMatchNoMatchResult(request, 'default_skip' satisfies StartupPullMatchReason, {
			hasFingerprintAttempt: request.remote.fingerprint !== null,
		});
	}

	const result = matchStartupEntity(request);
	if (result.status !== 'matched') {
		return result;
	}

	if (result.matchedEntityId === null || result.matchedEntityId === undefined) {
		return result;
	}

	const matchedCandidate = candidates.find((candidate) => candidate.id === result.matchedEntityId);
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
): Promise<RadarrStartupFetchResult> {
	const unsupportedSections: RadarrUnsupportedSection[] = [];
	const supportedSections: StartupPullSection[] = [];
	const supportLookup = new Map<StartupPullSection, string | null>();

	for (const section of RADARR_SECTIONS) {
		const reason = getStartupSectionSupportReason('radarr', section);
		supportLookup.set(section, reason);
		if (reason === null) {
			supportedSections.push(section);
			continue;
		}

		unsupportedSections.push({
			section,
			reason,
		});
	}

	try {
		const [qualityProfiles, delayProfiles, naming, mediaManagement, qualityDefinitions] = await Promise.all([
			supportLookup.get('qualityProfiles') === null
				? client.getQualityProfiles()
				: Promise.resolve([] as Awaited<ReturnType<typeof client.getQualityProfiles>>),
			supportLookup.get('delayProfiles') === null
				? client.getDelayProfiles()
				: Promise.resolve([] as Awaited<ReturnType<typeof client.getDelayProfiles>>),
			supportLookup.get('naming') === null
				? client.getNamingConfig()
				: Promise.resolve(null as unknown as Awaited<ReturnType<typeof client.getNamingConfig>>),
			supportLookup.get('mediaSettings') === null
				? client.getMediaManagementConfig()
				: Promise.resolve(null as unknown as Awaited<ReturnType<typeof client.getMediaManagementConfig>>),
			supportLookup.get('qualityDefinitions') === null
				? client.getQualityDefinitions()
				: Promise.resolve([] as Awaited<ReturnType<typeof client.getQualityDefinitions>>),
		]);

		const resources: RadarrStartupRemoteSnapshot['resources'] = {
			qualityProfiles: toSectionSnapshot(
				qualityProfiles.map((profile) => ({
					id: profile.id,
					name: profile.name,
					section: 'qualityProfiles',
					arrType: 'radarr',
				}))
			),
			delayProfiles: toSectionSnapshot(
				delayProfiles.map((profile) => ({
					id: profile.id,
					name: getDelayProfileName(profile),
					section: 'delayProfiles',
					arrType: 'radarr',
				}))
			),
			naming: naming ? toSectionSnapshot([buildRemoteNamingSnapshot('radarr', naming)]) : [],
			mediaSettings: mediaManagement ? toSectionSnapshot([buildRemoteMediaSettingsSnapshot(mediaManagement, 'radarr')]) : [],
			qualityDefinitions: qualityDefinitions
				? toSectionSnapshot([buildRemoteQualityDefinitionsSnapshot(qualityDefinitions, 'radarr')])
				: [],
			metadataProfiles: [],
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
		return classifyRadarrFetchError(error);
	}
}

export async function collectRadarrStartupCandidates(databaseIds: readonly number[]): Promise<RadarrStartupCandidates> {
	const qualityProfiles: StartupPullEntityDescriptor[] = [];
	const delayProfiles: StartupPullEntityDescriptor[] = [];
	const naming: StartupPullEntityDescriptor[] = [];
	const mediaSettings: StartupPullEntityDescriptor[] = [];
	const qualityDefinitions: StartupPullEntityDescriptor[] = [];

	for (const databaseId of databaseIds) {
		const cache = pcdManager.getCache(databaseId);
		if (!cache) {
			continue;
		}

		const [qualityRows, delayRows, mediaManagementCandidates] = await Promise.all([
			qualityProfileQueries.list(cache, 'radarr'),
			delayProfileQueries.list(cache),
			collectStartupMediaManagementCandidates(cache, databaseId, 'radarr'),
		]);

		for (const profile of qualityRows) {
			qualityProfiles.push({
				id: profile.id,
				name: profile.name,
				section: 'qualityProfiles',
				arrType: 'radarr',
				databaseId,
			});
		}

		for (const profile of delayRows) {
			delayProfiles.push({
				id: profile.id,
				name: profile.name,
				section: 'delayProfiles',
				arrType: 'radarr',
				databaseId,
			});
		}

		naming.push(...mediaManagementCandidates.naming);
		mediaSettings.push(...mediaManagementCandidates.mediaSettings);
		qualityDefinitions.push(...mediaManagementCandidates.qualityDefinitions);
	}

	return {
		qualityProfiles: sortStartupCandidates(qualityProfiles),
		delayProfiles: sortStartupCandidates(delayProfiles),
		naming: sortStartupCandidates(naming),
		mediaSettings: sortStartupCandidates(mediaSettings),
		qualityDefinitions: sortStartupCandidates(qualityDefinitions),
		metadataProfiles: [],
	};
}

export async function matchRadarrStartupResources(
	input: StartupPullInstanceInput,
	snapshot: RadarrStartupRemoteSnapshot,
	candidates: RadarrStartupCandidates
): Promise<RadarrStartupMatchRunResult> {
	const arrType = assertStartupArrType(input.arrType, 'radarr', 'Cannot process non-Radarr instance in radarr adapter');
	const envelope = createAdapterResultEnvelope('skipped');
	const matches: StartupPullMatchResult[] = [];
	const fallbackDatabaseId = input.databaseIds[0] ?? 0;

	for (const unsupported of snapshot.unsupportedSections) {
		const result = buildUnsupportedSectionResult(input.instanceId, fallbackDatabaseId, unsupported);
		matches.push(result);
		incrementCountersFromMatchResult(envelope, result);
	}

	for (const section of snapshot.supportedSections) {
		if (section === 'qualityProfiles') {
			for (const remoteProfile of snapshot.resources.qualityProfiles) {
				const result = matchSectionByNameThenFingerprint(
					input.instanceId,
					fallbackDatabaseId,
					'qualityProfiles',
					arrType,
					remoteProfile,
					candidates.qualityProfiles,
				);
				matches.push(result);
				incrementCountersFromMatchResult(envelope, result);
			}

			continue;
		}

		if (section === 'delayProfiles') {
			for (const remoteProfile of snapshot.resources.delayProfiles) {
				const result = matchSectionByNameThenFingerprint(
					input.instanceId,
					fallbackDatabaseId,
					'delayProfiles',
					arrType,
					remoteProfile,
					candidates.delayProfiles,
				);
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
	}

	envelope.status = matches.length === 0 ? 'skipped' : envelope.counters.failed > 0 ? 'failure' : 'success';

	return {
		status: envelope.status === 'failure' ? 'failed' : 'success',
		failureKind: null,
		envelope,
		matches,
		unsupportedSections: snapshot.unsupportedSections,
	};
}

export async function runRadarrStartupAdapter(
	input: StartupPullInstanceInput,
	client: BaseArrClient
): Promise<RadarrStartupMatchRunResult> {
	assertStartupArrType(input.arrType, 'radarr', 'Cannot run non-Radarr adapter');

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

	const candidates = await collectRadarrStartupCandidates(input.databaseIds);
	return matchRadarrStartupResources(input, fetchResult.snapshot, candidates);
}

export const radarrStartupAdapter = {
	arrType: 'radarr' as const,
	fetch: collectRemoteSectionSnapshots,
	collectCandidates: collectRadarrStartupCandidates,
	match: matchRadarrStartupResources,
	run: runRadarrStartupAdapter,
};
