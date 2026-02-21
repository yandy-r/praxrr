import type { PCDCache } from '$pcd/index.ts';
import {
	createStartupMetadataFingerprint,
} from '$lib/server/pull/startup/fingerprints.ts';
import {
	shouldSkipStartupDefault,
} from '$lib/server/pull/startup/defaultFilters.ts';
import type {
	StartupPullEntityDescriptor,
	StartupPullMatchRequest,
	StartupPullMatchResult,
} from '$lib/server/pull/startup/types.ts';
import {
	matchStartupEntity,
	makeStartupMatchNoMatchResult,
} from '$lib/server/pull/startup/matching.ts';
import type { LidarrMetadataProfile as ArrLidarrMetadataProfile } from '$arr/types.ts';
import type { LidarrMetadataProfile as LocalLidarrMetadataProfile } from '$pcd/entities/metadataProfiles/read.ts';
import * as metadataProfilesQueries from '$pcd/entities/metadataProfiles/read.ts';

interface LidarrMetadataProfileToggle {
	readonly id: number;
	readonly name: string;
	readonly allowed: boolean;
}

interface LidarrMetadataProfileFingerprintInput {
	readonly primaryAlbumTypes: readonly LidarrMetadataProfileToggle[];
	readonly secondaryAlbumTypes: readonly LidarrMetadataProfileToggle[];
	readonly releaseStatuses: readonly LidarrMetadataProfileToggle[];
}

function toProfileToggle(
	value: {
		id: number;
		name: string;
		allowed: boolean;
	}
): LidarrMetadataProfileToggle {
	return {
		id: value.id,
		name: value.name,
		allowed: value.allowed,
	};
}

function sortLidarrProfileToggles(values: readonly LidarrMetadataProfileToggle[]): LidarrMetadataProfileToggle[] {
	return [...values].sort((left, right) => {
		if (left.id !== right.id) {
			return left.id - right.id;
		}

		return left.name.localeCompare(right.name);
	});
}

function buildMetadataProfileFingerprint(
	input: LidarrMetadataProfileFingerprintInput
): string | null {
	return createStartupMetadataFingerprint({
		primaryAlbumTypes: sortLidarrProfileToggles(input.primaryAlbumTypes),
		secondaryAlbumTypes: sortLidarrProfileToggles(input.secondaryAlbumTypes),
		releaseStatuses: sortLidarrProfileToggles(input.releaseStatuses),
	}, {
		sortArrayValues: true,
	});
}

function buildStartupMetadataProfileFingerprintFromRemote(
	profile: ArrLidarrMetadataProfile
): string | null {
	return buildMetadataProfileFingerprint({
		primaryAlbumTypes: profile.primaryAlbumTypes.map((entry) =>
			toProfileToggle({
				id: entry.albumType.id,
				name: entry.albumType.name,
				allowed: entry.allowed,
			})
		),
		secondaryAlbumTypes: profile.secondaryAlbumTypes.map((entry) =>
			toProfileToggle({
				id: entry.albumType.id,
				name: entry.albumType.name,
				allowed: entry.allowed,
			})
		),
		releaseStatuses: profile.releaseStatuses.map((entry) =>
			toProfileToggle({
				id: entry.releaseStatus.id,
				name: entry.releaseStatus.name,
				allowed: entry.allowed,
			})
		),
	});
}

function buildStartupMetadataProfileFingerprintFromLocal(
	profile: LocalLidarrMetadataProfile
): string | null {
	return buildMetadataProfileFingerprint({
		primaryAlbumTypes: profile.primaryAlbumTypes.map((entry) =>
			toProfileToggle({
				id: entry.typeId,
				name: entry.name,
				allowed: entry.allowed,
			})
		),
		secondaryAlbumTypes: profile.secondaryAlbumTypes.map((entry) =>
			toProfileToggle({
				id: entry.typeId,
				name: entry.name,
				allowed: entry.allowed,
			})
		),
		releaseStatuses: profile.releaseStatuses.map((entry) =>
			toProfileToggle({
				id: entry.statusId,
				name: entry.name,
				allowed: entry.allowed,
			})
		),
	});
}

function sortMetadataProfiles(
	candidates: readonly StartupPullEntityDescriptor[]
): StartupPullEntityDescriptor[] {
	return [...candidates].sort((left, right) => {
		if (left.databaseId !== right.databaseId) {
			return left.databaseId - right.databaseId;
		}

		const byName = left.name.localeCompare(right.name);
		if (byName !== 0) {
			return byName;
		}

		return String(left.id).localeCompare(String(right.id));
	});
}

export async function collectStartupMetadataProfileCandidates(
	cache: PCDCache,
	databaseId: number
): Promise<readonly StartupPullEntityDescriptor[]> {
	const profiles = await metadataProfilesQueries.list(cache);

	const rows = profiles.map((profile) => ({
		id: profile.id,
		name: profile.name,
		section: 'metadataProfiles',
		arrType: 'lidarr',
		databaseId,
		fingerprint: buildStartupMetadataProfileFingerprintFromLocal(profile),
	}) satisfies StartupPullEntityDescriptor);

	return sortMetadataProfiles(rows);
}

export function buildRemoteMetadataProfileSnapshot(
	profile: ArrLidarrMetadataProfile
): Omit<StartupPullEntityDescriptor, 'databaseId'> {
	return {
		id: profile.id,
		name: profile.name,
		section: 'metadataProfiles',
		arrType: 'lidarr',
		fingerprint: buildStartupMetadataProfileFingerprintFromRemote(profile),
	};
}

export function classifyMetadataProfileMatch(
	request: StartupPullMatchRequest
): StartupPullMatchResult {
	const skipDefault = shouldSkipStartupDefault(request.arrType, request.section, request.remote);
	if (skipDefault.skip) {
		return makeStartupMatchNoMatchResult(request, 'default_skip', {
			hasFingerprintAttempt: request.remote.fingerprint !== null,
		});
	}

	const result = matchStartupEntity(request, {
		normalizeName: (value) => value,
	});

	if (result.status !== 'matched' || result.matchedEntityId === null || result.matchedEntityId === undefined) {
		return result;
	}

	const matchedCandidate = request.candidates.find((candidate) => candidate.id === result.matchedEntityId);
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
