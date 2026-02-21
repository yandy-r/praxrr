import type { ArrDelayProfile } from '$arr/types.ts';
import type { DelayProfilesRow } from '$shared/pcd/display.ts';
import { hasNamespaceSuffix, stripNamespaceSuffix } from '$sync/namespace.ts';
import { createStartupMetadataFingerprint } from './fingerprints.ts';
import { makeStartupMatchNoMatchResult, normalizeStartupName } from './matching.ts';
import type {
	StartupPullArrType,
	StartupPullMatchRequest,
	StartupPullMatchResult,
} from './types.ts';

type DelayProfileFingerprintPayload = Record<string, unknown> & {
	preferredProtocol: string;
	enableUsenet: boolean;
	enableTorrent: boolean;
	usenetDelay: number;
	torrentDelay: number;
	bypassIfHighestQuality: boolean;
	bypassIfAboveCustomFormatScore: boolean;
	minimumCustomFormatScore: number;
};

function normalizeDelayNumber(value: number | null | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeDelayPreferredProtocol(value: unknown): string {
	if (typeof value !== 'string') {
		return 'unknown';
	}

	const normalized = value.toLocaleLowerCase();
	return normalized.length > 0 ? normalized : 'unknown';
}

function buildDelayProfileFingerprintPayload(
	profile: Pick<
		ArrDelayProfile,
		| 'preferredProtocol'
		| 'enableUsenet'
		| 'enableTorrent'
		| 'usenetDelay'
		| 'torrentDelay'
		| 'bypassIfHighestQuality'
		| 'bypassIfAboveCustomFormatScore'
		| 'minimumCustomFormatScore'
	>
): DelayProfileFingerprintPayload {
	return {
		preferredProtocol: normalizeDelayPreferredProtocol(profile.preferredProtocol),
		enableUsenet: Boolean(profile.enableUsenet),
		enableTorrent: Boolean(profile.enableTorrent),
		usenetDelay: normalizeDelayNumber(profile.usenetDelay),
		torrentDelay: normalizeDelayNumber(profile.torrentDelay),
		bypassIfHighestQuality: Boolean(profile.bypassIfHighestQuality),
		bypassIfAboveCustomFormatScore: Boolean(profile.bypassIfAboveCustomFormatScore),
		minimumCustomFormatScore: normalizeDelayNumber(profile.minimumCustomFormatScore),
	};
}

function normalizeLocalDelayProtocol(
	value: DelayProfilesRow['preferred_protocol']
): Pick<DelayProfileFingerprintPayload, 'preferredProtocol' | 'enableUsenet' | 'enableTorrent'> {
	switch (value) {
		case 'prefer_usenet':
			return { preferredProtocol: 'usenet', enableUsenet: true, enableTorrent: true };
		case 'prefer_torrent':
			return { preferredProtocol: 'torrent', enableUsenet: true, enableTorrent: true };
		case 'only_usenet':
			return { preferredProtocol: 'usenet', enableUsenet: true, enableTorrent: false };
		case 'only_torrent':
			return { preferredProtocol: 'torrent', enableUsenet: false, enableTorrent: true };
	}
}

function buildLocalDelayProfileFingerprintPayload(
	profile: Pick<
		DelayProfilesRow,
		| 'preferred_protocol'
		| 'usenet_delay'
		| 'torrent_delay'
		| 'bypass_if_highest_quality'
		| 'bypass_if_above_custom_format_score'
		| 'minimum_custom_format_score'
	>
): DelayProfileFingerprintPayload {
	const protocol = normalizeLocalDelayProtocol(profile.preferred_protocol);

	return {
		preferredProtocol: protocol.preferredProtocol,
		enableUsenet: protocol.enableUsenet,
		enableTorrent: protocol.enableTorrent,
		usenetDelay: normalizeDelayNumber(profile.usenet_delay),
		torrentDelay: normalizeDelayNumber(profile.torrent_delay),
		bypassIfHighestQuality: Boolean(profile.bypass_if_highest_quality),
		bypassIfAboveCustomFormatScore: Boolean(profile.bypass_if_above_custom_format_score),
		minimumCustomFormatScore: normalizeDelayNumber(profile.minimum_custom_format_score),
	};
}

export function buildDelayProfileFingerprintFromArr(profile: ArrDelayProfile): string | null {
	return createStartupMetadataFingerprint(buildDelayProfileFingerprintPayload(profile), {
		sortObjectKeys: true,
	});
}

export function buildDelayProfileFingerprintFromLocal(profile: DelayProfilesRow): string | null {
	return createStartupMetadataFingerprint(buildLocalDelayProfileFingerprintPayload(profile), {
		sortObjectKeys: true,
	});
}

export function selectDefaultDelayProfileForStartup(
	arrType: StartupPullArrType,
	profiles: readonly ArrDelayProfile[]
): ArrDelayProfile | null {
	if (arrType === 'radarr' || arrType === 'sonarr') {
		return profiles.find((profile) => profile.id === 1) ?? null;
	}

	const lidarrPrimaryDefault =
		profiles.find((profile) => profile.order === 1 && (!profile.tags || profile.tags.length === 0)) ?? null;
	if (lidarrPrimaryDefault) {
		return lidarrPrimaryDefault;
	}

	return profiles.find((profile) => profile.id === 1) ?? null;
}

export function matchManagedStartupProfileByNamespace(
	request: StartupPullMatchRequest
): StartupPullMatchResult {
	const normalizedRemoteName = normalizeStartupName(stripNamespaceSuffix(request.remote.name));
	if (!hasNamespaceSuffix(request.remote.name) || normalizedRemoteName.length === 0) {
		return makeStartupMatchNoMatchResult(request, 'unmanaged_remote');
	}

	const candidateCount = request.candidates.length;
	const namespaceMatches = request.candidates.filter((candidate) => {
		const normalizedCandidateName = normalizeStartupName(stripNamespaceSuffix(candidate.name));
		return normalizedCandidateName === normalizedRemoteName;
	});

	if (namespaceMatches.length === 1) {
		const matched = namespaceMatches[0];
		return {
			instanceId: request.instanceId,
			databaseId: request.databaseId,
			section: request.section,
			arrType: request.arrType,
			status: 'matched',
			reason: 'matched_exact_name',
			matchMethod: 'exact_name',
			matchedEntityId: matched.id,
			matchedEntityName: matched.name,
			matchedCount: 1,
			candidatesChecked: candidateCount,
		};
	}

	if (namespaceMatches.length > 1) {
		return {
			instanceId: request.instanceId,
			databaseId: request.databaseId,
			section: request.section,
			arrType: request.arrType,
			status: 'conflicted',
			reason: 'namespace_conflict',
			matchMethod: 'exact_name',
			matchedCount: namespaceMatches.length,
			candidatesChecked: candidateCount,
		};
	}

	return {
		instanceId: request.instanceId,
		databaseId: request.databaseId,
		section: request.section,
		arrType: request.arrType,
		status: 'no_match',
		reason: 'no_match',
		candidatesChecked: candidateCount,
	};
}

export function matchDelayProfileByFingerprint(
	request: StartupPullMatchRequest
): StartupPullMatchResult {
	const candidateCount = request.candidates.length;
	const remoteFingerprint = request.remote.fingerprint;
	if (typeof remoteFingerprint !== 'string' || remoteFingerprint.length === 0) {
		return makeStartupMatchNoMatchResult(request, 'no_match');
	}

	const fingerprintMatches = request.candidates.filter((candidate) => {
		return (
			typeof candidate.fingerprint === 'string' &&
			candidate.fingerprint.length > 0 &&
			candidate.fingerprint === remoteFingerprint
		);
	});

	if (fingerprintMatches.length === 1) {
		const matched = fingerprintMatches[0];
		return {
			instanceId: request.instanceId,
			databaseId: request.databaseId,
			section: request.section,
			arrType: request.arrType,
			status: 'matched',
			reason: 'matched_fingerprint',
			matchMethod: 'metadata_fingerprint',
			matchedEntityId: matched.id,
			matchedEntityName: matched.name,
			matchedCount: 1,
			candidatesChecked: candidateCount,
		};
	}

	if (fingerprintMatches.length > 1) {
		return {
			instanceId: request.instanceId,
			databaseId: request.databaseId,
			section: request.section,
			arrType: request.arrType,
			status: 'conflicted',
			reason: 'fingerprint_conflict',
			matchMethod: 'metadata_fingerprint',
			matchedCount: fingerprintMatches.length,
			candidatesChecked: candidateCount,
		};
	}

	return {
		instanceId: request.instanceId,
		databaseId: request.databaseId,
		section: request.section,
		arrType: request.arrType,
		status: 'no_match',
		reason: 'no_match',
		matchMethod: 'metadata_fingerprint',
		candidatesChecked: candidateCount,
	};
}
