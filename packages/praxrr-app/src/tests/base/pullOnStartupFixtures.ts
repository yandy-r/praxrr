/**
 * Shared deterministic test fixtures for startup pull feature.
 *
 * Fixture builders produce stable, typed inputs for unit and integration tests
 * across config, matching, default filtering, adapters, orchestration, and
 * idempotency suites. All fixtures are explicit by arr_type to avoid
 * cross-app test leakage.
 */

import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { JobRunStatus, ArrPullStartupCounters, ArrPullStartupInstanceResult, ArrPullStartupRunResult } from '$jobs/queueTypes.ts';
import type {
	StartupPullArrType,
	StartupPullSection,
	StartupPullMatchStatus,
	StartupPullMatchMethod,
	StartupPullMatchReason,
	StartupPullMatchResult,
	StartupPullMatchRequest,
	StartupPullEntityDescriptor,
	StartupPullInstanceInput,
	StartupPullCounters,
	StartupPullInstanceResult,
	StartupPullRunStatus,
	StartupPullRunSummary,
} from '$lib/server/pull/startup/types.ts';
import type { StartupAdapterResultEnvelope } from '$lib/server/pull/startup/handlers/shared.ts';
import type { StartupMatchBatchResult } from '$lib/server/pull/startup/matching.ts';
import type { StartupDefaultFilterDecision } from '$lib/server/pull/startup/defaultFilters.ts';
import type {
	ApplySectionOutcome,
	ApplySectionReason,
	ApplySelectionsResult,
} from '$lib/server/pull/startup/applySelections.ts';

// =============================================================================
// Constants
// =============================================================================

const NOW_ISO = '2026-02-21T00:00:00.000Z';
const LATER_ISO = '2026-02-21T00:00:01.000Z';

const STABLE_RUN_ID = 'test-run-00000000-0000-0000-0000-000000000000';

// =============================================================================
// Arr Instance Fixtures
// =============================================================================

export interface ArrInstanceFixtureOptions {
	id?: number;
	name?: string;
	type?: string;
	url?: string;
	enabled?: number;
	source?: ArrInstance['source'];
}

export function buildArrInstance(
	arrType: StartupPullArrType,
	overrides: ArrInstanceFixtureOptions = {}
): ArrInstance {
	const id = overrides.id ?? getDefaultInstanceId(arrType);
	const now = NOW_ISO;
	return {
		id,
		name: overrides.name ?? `${arrType}-test-${id}`,
		type: overrides.type ?? arrType,
		url: overrides.url ?? `http://127.0.0.1:${getDefaultPort(arrType)}`,
		external_url: null,
		api_key: `test-api-key-${arrType}-${id}`,
		api_key_fingerprint: null,
		tags: null,
		enabled: overrides.enabled ?? 1,
		source: overrides.source,
		created_at: now,
		updated_at: now,
	};
}

export function buildRadarrInstance(overrides: ArrInstanceFixtureOptions = {}): ArrInstance {
	return buildArrInstance('radarr', overrides);
}

export function buildSonarrInstance(overrides: ArrInstanceFixtureOptions = {}): ArrInstance {
	return buildArrInstance('sonarr', overrides);
}

export function buildLidarrInstance(overrides: ArrInstanceFixtureOptions = {}): ArrInstance {
	return buildArrInstance('lidarr', overrides);
}

export function buildDisabledInstance(arrType: StartupPullArrType): ArrInstance {
	return buildArrInstance(arrType, { enabled: 0 });
}

function getDefaultInstanceId(arrType: StartupPullArrType): number {
	switch (arrType) {
		case 'radarr':
			return 100;
		case 'sonarr':
			return 200;
		case 'lidarr':
			return 300;
	}
}

function getDefaultPort(arrType: StartupPullArrType): number {
	switch (arrType) {
		case 'radarr':
			return 7878;
		case 'sonarr':
			return 8989;
		case 'lidarr':
			return 8686;
	}
}

// =============================================================================
// Instance Input Fixtures
// =============================================================================

export interface InstanceInputFixtureOptions {
	instanceId?: number;
	instanceName?: string;
	arrType?: StartupPullArrType;
	url?: string;
	databaseIds?: readonly number[];
}

export function buildInstanceInput(
	arrType: StartupPullArrType,
	overrides: InstanceInputFixtureOptions = {}
): StartupPullInstanceInput {
	const id = overrides.instanceId ?? getDefaultInstanceId(arrType);
	return {
		instanceId: id,
		instanceName: overrides.instanceName ?? `${arrType}-test-${id}`,
		arrType: overrides.arrType ?? arrType,
		url: overrides.url ?? `http://127.0.0.1:${getDefaultPort(arrType)}`,
		databaseIds: overrides.databaseIds ?? [1],
	};
}

export function buildRadarrInput(overrides: InstanceInputFixtureOptions = {}): StartupPullInstanceInput {
	return buildInstanceInput('radarr', overrides);
}

export function buildSonarrInput(overrides: InstanceInputFixtureOptions = {}): StartupPullInstanceInput {
	return buildInstanceInput('sonarr', overrides);
}

export function buildLidarrInput(overrides: InstanceInputFixtureOptions = {}): StartupPullInstanceInput {
	return buildInstanceInput('lidarr', overrides);
}

// =============================================================================
// Entity Descriptor Fixtures
// =============================================================================

export interface EntityDescriptorFixtureOptions {
	id?: number | string;
	name?: string;
	section?: StartupPullSection;
	arrType?: StartupPullArrType;
	databaseId?: number;
	fingerprint?: string | null;
}

export function buildEntityDescriptor(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: EntityDescriptorFixtureOptions = {}
): StartupPullEntityDescriptor {
	return {
		id: overrides.id ?? 1,
		name: overrides.name ?? `${section}-entity-${arrType}`,
		section: overrides.section ?? section,
		arrType: overrides.arrType ?? arrType,
		databaseId: overrides.databaseId ?? 1,
		fingerprint: overrides.fingerprint ?? null,
	};
}

export function buildQualityProfileDescriptor(
	arrType: StartupPullArrType,
	overrides: EntityDescriptorFixtureOptions = {}
): StartupPullEntityDescriptor {
	return buildEntityDescriptor(arrType, 'qualityProfiles', {
		name: overrides.name ?? 'HD Bluray + WEB',
		...overrides,
	});
}

export function buildDelayProfileDescriptor(
	arrType: StartupPullArrType,
	overrides: EntityDescriptorFixtureOptions = {}
): StartupPullEntityDescriptor {
	return buildEntityDescriptor(arrType, 'delayProfiles', {
		name: overrides.name ?? 'Standard Delay',
		...overrides,
	});
}

export function buildNamingDescriptor(
	arrType: StartupPullArrType,
	overrides: EntityDescriptorFixtureOptions = {}
): StartupPullEntityDescriptor {
	return buildEntityDescriptor(arrType, 'naming', {
		id: overrides.id ?? 'naming',
		name: overrides.name ?? 'naming',
		...overrides,
	});
}

export function buildMediaSettingsDescriptor(
	arrType: StartupPullArrType,
	overrides: EntityDescriptorFixtureOptions = {}
): StartupPullEntityDescriptor {
	return buildEntityDescriptor(arrType, 'mediaSettings', {
		id: overrides.id ?? 'mediaManagement',
		name: overrides.name ?? 'mediaManagement',
		...overrides,
	});
}

export function buildQualityDefinitionsDescriptor(
	arrType: StartupPullArrType,
	overrides: EntityDescriptorFixtureOptions = {}
): StartupPullEntityDescriptor {
	return buildEntityDescriptor(arrType, 'qualityDefinitions', {
		id: overrides.id ?? 'qualityDefinitions',
		name: overrides.name ?? 'qualityDefinitions',
		...overrides,
	});
}

export function buildMetadataProfileDescriptor(
	overrides: EntityDescriptorFixtureOptions = {}
): StartupPullEntityDescriptor {
	return buildEntityDescriptor('lidarr', 'metadataProfiles', {
		name: overrides.name ?? 'Standard Metadata',
		...overrides,
	});
}

// =============================================================================
// Remote Descriptor Fixtures (without databaseId, as fetched from Arr API)
// =============================================================================

export interface RemoteDescriptorFixtureOptions {
	id?: number | string;
	name?: string;
	section?: StartupPullSection;
	arrType?: StartupPullArrType;
	fingerprint?: string | null;
}

export function buildRemoteDescriptor(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: RemoteDescriptorFixtureOptions = {}
): Omit<StartupPullEntityDescriptor, 'databaseId'> {
	return {
		id: overrides.id ?? 1,
		name: overrides.name ?? `${section}-remote-${arrType}`,
		section: overrides.section ?? section,
		arrType: overrides.arrType ?? arrType,
		fingerprint: overrides.fingerprint ?? null,
	};
}

// =============================================================================
// Match Request Fixtures
// =============================================================================

export interface MatchRequestFixtureOptions {
	instanceId?: number;
	databaseId?: number;
	section?: StartupPullSection;
	arrType?: StartupPullArrType;
	remote?: StartupPullEntityDescriptor;
	candidates?: readonly StartupPullEntityDescriptor[];
}

export function buildMatchRequest(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: MatchRequestFixtureOptions = {}
): StartupPullMatchRequest {
	const instanceId = overrides.instanceId ?? getDefaultInstanceId(arrType);
	const databaseId = overrides.databaseId ?? 1;
	return {
		instanceId,
		databaseId,
		section: overrides.section ?? section,
		arrType: overrides.arrType ?? arrType,
		remote: overrides.remote ?? buildEntityDescriptor(arrType, section, { databaseId }),
		candidates: overrides.candidates ?? [],
	};
}

// =============================================================================
// Match Result Fixtures
// =============================================================================

export interface MatchResultFixtureOptions {
	instanceId?: number;
	databaseId?: number;
	section?: StartupPullSection;
	arrType?: StartupPullArrType;
	status?: StartupPullMatchStatus;
	reason?: StartupPullMatchReason;
	matchMethod?: StartupPullMatchMethod;
	matchedEntityId?: number | string | null;
	matchedEntityName?: string | null;
	matchedCount?: number;
	candidatesChecked?: number;
}

export function buildMatchResult(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	status: StartupPullMatchStatus,
	overrides: MatchResultFixtureOptions = {}
): StartupPullMatchResult {
	const instanceId = overrides.instanceId ?? getDefaultInstanceId(arrType);
	const shared = {
		instanceId,
		databaseId: overrides.databaseId ?? 1,
		section: overrides.section ?? section,
		arrType: overrides.arrType ?? arrType,
		candidatesChecked: overrides.candidatesChecked ?? 0,
	};

	if (status === 'matched') {
		return {
			...shared,
			status: 'matched' as const,
			reason: (overrides.reason ?? 'matched_exact_name') as 'matched_exact_name' | 'matched_fingerprint',
			matchMethod: overrides.matchMethod ?? 'exact_name',
			matchedEntityId: overrides.matchedEntityId ?? 1,
			matchedEntityName: overrides.matchedEntityName ?? `${section}-entity-${arrType}`,
			matchedCount: overrides.matchedCount ?? 1,
		};
	}

	return {
		...shared,
		status,
		reason: overrides.reason ?? getDefaultReasonForStatus(status),
		...(overrides.matchMethod !== undefined ? { matchMethod: overrides.matchMethod } : {}),
		...(overrides.matchedCount !== undefined ? { matchedCount: overrides.matchedCount } : {}),
	};
}

function getDefaultReasonForStatus(status: StartupPullMatchStatus): StartupPullMatchReason {
	switch (status) {
		case 'matched':
			return 'matched_exact_name';
		case 'no_match':
			return 'no_match';
		case 'conflicted':
			return 'name_conflict';
	}
}

/**
 * Build a matched result from an exact name match.
 */
export function buildMatchedExactNameResult(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: MatchResultFixtureOptions = {}
): StartupPullMatchResult {
	return buildMatchResult(arrType, section, 'matched', {
		reason: 'matched_exact_name',
		matchMethod: 'exact_name',
		matchedEntityId: overrides.matchedEntityId ?? 1,
		matchedEntityName: overrides.matchedEntityName ?? `${section}-entity-${arrType}`,
		matchedCount: 1,
		candidatesChecked: overrides.candidatesChecked ?? 1,
		...overrides,
	});
}

/**
 * Build a matched result from a fingerprint match.
 */
export function buildMatchedFingerprintResult(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: MatchResultFixtureOptions = {}
): StartupPullMatchResult {
	return buildMatchResult(arrType, section, 'matched', {
		reason: 'matched_fingerprint',
		matchMethod: 'metadata_fingerprint',
		matchedEntityId: overrides.matchedEntityId ?? 1,
		matchedEntityName: overrides.matchedEntityName ?? `${section}-entity-${arrType}`,
		matchedCount: 1,
		candidatesChecked: overrides.candidatesChecked ?? 1,
		...overrides,
	});
}

/**
 * Build a no-match result (entity not found in candidates).
 */
export function buildNoMatchResult(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: MatchResultFixtureOptions = {}
): StartupPullMatchResult {
	return buildMatchResult(arrType, section, 'no_match', {
		reason: 'no_match',
		candidatesChecked: overrides.candidatesChecked ?? 0,
		...overrides,
	});
}

/**
 * Build a skipped-default result (default entity excluded by policy).
 */
export function buildSkippedDefaultResult(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: MatchResultFixtureOptions = {}
): StartupPullMatchResult {
	return buildMatchResult(arrType, section, 'no_match', {
		reason: 'default_skip',
		candidatesChecked: overrides.candidatesChecked ?? 0,
		...overrides,
	});
}

/**
 * Build a conflicted result (multiple name matches or fingerprint collisions).
 */
export function buildConflictedResult(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: MatchResultFixtureOptions = {}
): StartupPullMatchResult {
	return buildMatchResult(arrType, section, 'conflicted', {
		reason: overrides.reason ?? 'name_conflict',
		matchMethod: overrides.matchMethod ?? 'exact_name',
		matchedCount: overrides.matchedCount ?? 2,
		candidatesChecked: overrides.candidatesChecked ?? 2,
		...overrides,
	});
}

/**
 * Build an unsupported section result.
 */
export function buildUnsupportedSectionResult(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	overrides: MatchResultFixtureOptions = {}
): StartupPullMatchResult {
	return buildMatchResult(arrType, section, 'no_match', {
		reason: 'unsupported_section',
		candidatesChecked: 0,
		...overrides,
	});
}

// =============================================================================
// Counters Fixtures
// =============================================================================

export function buildEmptyCounters(): StartupPullCounters {
	return {
		imported: 0,
		skipped_default: 0,
		skipped_no_match: 0,
		conflicted: 0,
		failed: 0,
	};
}

export interface CountersFixtureOptions {
	imported?: number;
	skipped_default?: number;
	skipped_no_match?: number;
	conflicted?: number;
	failed?: number;
}

export function buildCounters(overrides: CountersFixtureOptions = {}): StartupPullCounters {
	return {
		imported: overrides.imported ?? 0,
		skipped_default: overrides.skipped_default ?? 0,
		skipped_no_match: overrides.skipped_no_match ?? 0,
		conflicted: overrides.conflicted ?? 0,
		failed: overrides.failed ?? 0,
	};
}

// =============================================================================
// Instance Result Fixtures
// =============================================================================

export interface InstanceResultFixtureOptions extends CountersFixtureOptions {
	instanceId?: number;
	instanceName?: string;
	arrType?: StartupPullArrType;
	status?: JobRunStatus;
}

export function buildInstanceResult(
	arrType: StartupPullArrType,
	status: JobRunStatus,
	overrides: InstanceResultFixtureOptions = {}
): StartupPullInstanceResult {
	const instanceId = overrides.instanceId ?? getDefaultInstanceId(arrType);
	return {
		instanceId,
		instanceName: overrides.instanceName ?? `${arrType}-test-${instanceId}`,
		arrType: overrides.arrType ?? arrType,
		status,
		imported: overrides.imported ?? 0,
		skipped_default: overrides.skipped_default ?? 0,
		skipped_no_match: overrides.skipped_no_match ?? 0,
		conflicted: overrides.conflicted ?? 0,
		failed: overrides.failed ?? 0,
	};
}

export function buildSuccessInstanceResult(
	arrType: StartupPullArrType,
	overrides: InstanceResultFixtureOptions = {}
): StartupPullInstanceResult {
	return buildInstanceResult(arrType, 'success', overrides);
}

export function buildFailedInstanceResult(
	arrType: StartupPullArrType,
	overrides: InstanceResultFixtureOptions = {}
): StartupPullInstanceResult {
	return buildInstanceResult(arrType, 'failure', {
		failed: overrides.failed ?? 1,
		...overrides,
	});
}

export function buildSkippedInstanceResult(
	arrType: StartupPullArrType,
	overrides: InstanceResultFixtureOptions = {}
): StartupPullInstanceResult {
	return buildInstanceResult(arrType, 'skipped', overrides);
}

// =============================================================================
// Adapter Result Envelope Fixtures
// =============================================================================

export function buildAdapterEnvelope(
	status: JobRunStatus = 'skipped',
	overrides: CountersFixtureOptions = {}
): StartupAdapterResultEnvelope {
	return {
		status,
		counters: buildCounters(overrides),
	};
}

export function buildSuccessAdapterEnvelope(
	overrides: CountersFixtureOptions = {}
): StartupAdapterResultEnvelope {
	return buildAdapterEnvelope('success', overrides);
}

export function buildFailureAdapterEnvelope(
	error?: string,
	overrides: CountersFixtureOptions = {}
): StartupAdapterResultEnvelope {
	return {
		...buildAdapterEnvelope('failure', { failed: 1, ...overrides }),
		error,
	};
}

// =============================================================================
// Run Summary Fixtures
// =============================================================================

export interface RunSummaryFixtureOptions extends CountersFixtureOptions {
	runId?: string;
	status?: StartupPullRunStatus;
	startedAt?: string;
	finishedAt?: string | null;
	instances?: readonly StartupPullInstanceResult[];
}

export function buildRunSummary(
	overrides: RunSummaryFixtureOptions = {}
): StartupPullRunSummary {
	const instances = overrides.instances ?? [];
	const counters = instances.length > 0
		? aggregateFixtureCounters(instances)
		: buildCounters(overrides);

	return {
		runId: overrides.runId ?? STABLE_RUN_ID,
		status: overrides.status ?? 'success',
		startedAt: overrides.startedAt ?? NOW_ISO,
		finishedAt: overrides.finishedAt ?? LATER_ISO,
		instances,
		...counters,
	};
}

export function buildEmptyRunSummary(
	overrides: RunSummaryFixtureOptions = {}
): StartupPullRunSummary {
	return buildRunSummary({
		status: 'skipped',
		instances: [],
		...overrides,
	});
}

export function buildDisabledRunSummary(): StartupPullRunSummary {
	return buildRunSummary({
		status: 'disabled',
		instances: [],
	});
}

export function buildPartialRunSummary(
	successInstance: StartupPullInstanceResult,
	failedInstance: StartupPullInstanceResult,
	overrides: RunSummaryFixtureOptions = {}
): StartupPullRunSummary {
	return buildRunSummary({
		status: 'partial',
		instances: [successInstance, failedInstance],
		...overrides,
	});
}

// =============================================================================
// ArrPullStartupRunResult Fixtures (job queue output contract)
// =============================================================================

export function buildArrPullStartupRunResult(
	overrides: Partial<ArrPullStartupRunResult> = {}
): ArrPullStartupRunResult {
	return {
		runId: overrides.runId ?? STABLE_RUN_ID,
		status: overrides.status ?? 'success',
		startedAt: overrides.startedAt ?? NOW_ISO,
		finishedAt: overrides.finishedAt ?? LATER_ISO,
		instances: overrides.instances ?? [],
		imported: overrides.imported ?? 0,
		skipped_default: overrides.skipped_default ?? 0,
		skipped_no_match: overrides.skipped_no_match ?? 0,
		conflicted: overrides.conflicted ?? 0,
		failed: overrides.failed ?? 0,
	};
}

// =============================================================================
// Default Filter Decision Fixtures
// =============================================================================

export function buildNotDefaultDecision(): StartupDefaultFilterDecision {
	return {
		skip: false,
		confidence: null,
		reason: null,
	};
}

export function buildCertainDefaultDecision(reason: string): StartupDefaultFilterDecision {
	return {
		skip: true,
		confidence: 'certain',
		reason,
	};
}

export function buildUncertainDefaultDecision(reason: string): StartupDefaultFilterDecision {
	return {
		skip: true,
		confidence: 'uncertain',
		reason,
	};
}

// =============================================================================
// Apply Selections Outcome Fixtures
// =============================================================================

export function buildAppliedOutcome(count: number): ApplySectionOutcome {
	return { written: true, reason: 'applied', count };
}

export function buildUnchangedOutcome(count: number): ApplySectionOutcome {
	return { written: false, reason: 'unchanged', count };
}

export function buildNoMatchesOutcome(): ApplySectionOutcome {
	return { written: false, reason: 'no_matches', count: 0 };
}

export function buildApplySelectionsResult(
	overrides: Partial<ApplySelectionsResult> = {}
): ApplySelectionsResult {
	return {
		qualityProfiles: overrides.qualityProfiles ?? buildNoMatchesOutcome(),
		delayProfiles: overrides.delayProfiles ?? buildNoMatchesOutcome(),
		mediaManagement: overrides.mediaManagement ?? buildNoMatchesOutcome(),
		metadataProfiles: overrides.metadataProfiles ?? buildNoMatchesOutcome(),
	};
}

// =============================================================================
// Batch Result Fixtures
// =============================================================================

export function buildBatchResult(
	section: StartupPullSection,
	arrType: StartupPullArrType,
	results: readonly StartupPullMatchResult[]
): StartupMatchBatchResult {
	let matched = 0;
	let noMatch = 0;
	let conflicted = 0;
	let skipped = 0;
	let totalCandidates = 0;

	for (const result of results) {
		totalCandidates += result.candidatesChecked;
		switch (result.status) {
			case 'matched':
				matched += 1;
				break;
			case 'conflicted':
				conflicted += 1;
				break;
			case 'no_match':
				noMatch += 1;
				break;
			default:
				skipped += 1;
		}
	}

	return {
		section,
		arrType,
		totalCandidates,
		matched,
		noMatch,
		conflicted,
		skipped,
		results,
	};
}

// =============================================================================
// Default Arr Payload Fixtures (simulate Arr API responses)
// =============================================================================

/**
 * Radarr default delay profile: id=1, the stable default in Radarr.
 */
export function buildRadarrDefaultDelayProfile(): Record<string, unknown> {
	return {
		id: 1,
		enableUsenet: true,
		enableTorrent: true,
		preferredProtocol: 'usenet',
		usenetDelay: 0,
		torrentDelay: 0,
		order: 2147483647,
		tags: [],
	};
}

/**
 * Sonarr default delay profile: id=1, the stable default in Sonarr.
 */
export function buildSonarrDefaultDelayProfile(): Record<string, unknown> {
	return {
		id: 1,
		enableUsenet: true,
		enableTorrent: true,
		preferredProtocol: 'usenet',
		usenetDelay: 0,
		torrentDelay: 0,
		order: 2147483647,
		tags: [],
	};
}

/**
 * Lidarr uncertain default delay profile: order=1, empty tags.
 * This triggers the 'uncertain' confidence path in default detection.
 */
export function buildLidarrUncertainDefaultDelayProfile(): Record<string, unknown> {
	return {
		id: 5,
		enableUsenet: true,
		enableTorrent: true,
		preferredProtocol: 'usenet',
		usenetDelay: 0,
		torrentDelay: 0,
		order: 1,
		tags: [],
	};
}

/**
 * Non-default delay profile: id=10, distinct from known defaults.
 */
export function buildNonDefaultDelayProfile(arrType: StartupPullArrType): Record<string, unknown> {
	return {
		id: 10,
		name: `Custom Delay ${arrType}`,
		enableUsenet: true,
		enableTorrent: true,
		preferredProtocol: 'usenet',
		usenetDelay: 120,
		torrentDelay: 120,
		order: 5,
		tags: [1, 2],
	};
}

/**
 * Quality profile from Arr API.
 */
export function buildArrQualityProfile(
	id: number,
	name: string
): Record<string, unknown> {
	return {
		id,
		name,
		upgradeAllowed: true,
		cutoff: 7,
		items: [],
		minFormatScore: 0,
		cutoffFormatScore: 0,
		formatItems: [],
	};
}

/**
 * Metadata profile from Lidarr API.
 */
export function buildLidarrMetadataProfile(
	id: number,
	name: string
): Record<string, unknown> {
	return {
		id,
		name,
		primaryAlbumTypes: [
			{
				albumType: { id: 1, name: 'Album' },
				allowed: true,
			},
		],
		secondaryAlbumTypes: [
			{
				albumType: { id: 1, name: 'Studio' },
				allowed: true,
			},
		],
		releaseStatuses: [
			{
				releaseStatus: { id: 1, name: 'Official' },
				allowed: true,
			},
		],
	};
}

// =============================================================================
// Counter Expectation Fixtures
// =============================================================================

/**
 * Expected counters for a run where all entities matched by exact name.
 */
export function buildAllImportedCounters(count: number): StartupPullCounters {
	return buildCounters({ imported: count });
}

/**
 * Expected counters for a run where all entities were skipped as defaults.
 */
export function buildAllSkippedDefaultCounters(count: number): StartupPullCounters {
	return buildCounters({ skipped_default: count });
}

/**
 * Expected counters for a run where all entities had no match.
 */
export function buildAllNoMatchCounters(count: number): StartupPullCounters {
	return buildCounters({ skipped_no_match: count });
}

/**
 * Expected counters for a run where all entities were conflicted.
 */
export function buildAllConflictedCounters(count: number): StartupPullCounters {
	return buildCounters({ conflicted: count });
}

/**
 * Expected counters for a fully failed instance.
 */
export function buildAllFailedCounters(count: number): StartupPullCounters {
	return buildCounters({ failed: count });
}

/**
 * Build a mixed-outcome counter expectation for realistic scenarios.
 */
export function buildMixedCounters(options: CountersFixtureOptions): StartupPullCounters {
	return buildCounters(options);
}

// =============================================================================
// Scenario Builders (compose multiple fixtures for common test scenarios)
// =============================================================================

/**
 * Exact name match scenario: one remote entity matches one local candidate.
 */
export function buildExactNameMatchScenario(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	entityName: string,
	options: { instanceId?: number; databaseId?: number } = {}
): {
	remote: StartupPullEntityDescriptor;
	candidate: StartupPullEntityDescriptor;
	request: StartupPullMatchRequest;
} {
	const instanceId = options.instanceId ?? getDefaultInstanceId(arrType);
	const databaseId = options.databaseId ?? 1;
	const remote = buildEntityDescriptor(arrType, section, {
		id: 50,
		name: entityName,
		databaseId,
	});
	const candidate = buildEntityDescriptor(arrType, section, {
		id: 101,
		name: entityName,
		databaseId,
	});
	const request = buildMatchRequest(arrType, section, {
		instanceId,
		databaseId,
		remote,
		candidates: [candidate],
	});

	return { remote, candidate, request };
}

/**
 * Ambiguous match scenario: one remote entity maps to multiple local candidates
 * with the same name.
 */
export function buildAmbiguousMatchScenario(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	entityName: string,
	options: { instanceId?: number; databaseId?: number; candidateCount?: number } = {}
): {
	remote: StartupPullEntityDescriptor;
	candidates: StartupPullEntityDescriptor[];
	request: StartupPullMatchRequest;
} {
	const instanceId = options.instanceId ?? getDefaultInstanceId(arrType);
	const databaseId = options.databaseId ?? 1;
	const candidateCount = options.candidateCount ?? 2;

	const remote = buildEntityDescriptor(arrType, section, {
		id: 50,
		name: entityName,
		databaseId,
	});

	const candidates: StartupPullEntityDescriptor[] = [];
	for (let i = 0; i < candidateCount; i++) {
		candidates.push(
			buildEntityDescriptor(arrType, section, {
				id: 200 + i,
				name: entityName,
				databaseId: databaseId + i,
			})
		);
	}

	const request = buildMatchRequest(arrType, section, {
		instanceId,
		databaseId,
		remote,
		candidates,
	});

	return { remote, candidates, request };
}

/**
 * No-match scenario: remote entity has no corresponding local candidate.
 */
export function buildNoMatchScenario(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	options: { instanceId?: number; databaseId?: number } = {}
): {
	remote: StartupPullEntityDescriptor;
	request: StartupPullMatchRequest;
} {
	const instanceId = options.instanceId ?? getDefaultInstanceId(arrType);
	const databaseId = options.databaseId ?? 1;

	const remote = buildEntityDescriptor(arrType, section, {
		id: 50,
		name: 'Nonexistent Profile',
		databaseId,
	});

	const unrelatedCandidate = buildEntityDescriptor(arrType, section, {
		id: 999,
		name: 'Completely Different Profile',
		databaseId,
	});

	const request = buildMatchRequest(arrType, section, {
		instanceId,
		databaseId,
		remote,
		candidates: [unrelatedCandidate],
	});

	return { remote, request };
}

/**
 * Fingerprint match scenario: remote entity matches local candidate
 * by metadata fingerprint (not name).
 */
export function buildFingerprintMatchScenario(
	arrType: StartupPullArrType,
	section: StartupPullSection,
	fingerprint: string,
	options: { instanceId?: number; databaseId?: number } = {}
): {
	remote: StartupPullEntityDescriptor;
	candidate: StartupPullEntityDescriptor;
	request: StartupPullMatchRequest;
} {
	const instanceId = options.instanceId ?? getDefaultInstanceId(arrType);
	const databaseId = options.databaseId ?? 1;

	const remote = buildEntityDescriptor(arrType, section, {
		id: 50,
		name: 'Remote Name A',
		databaseId,
		fingerprint,
	});

	const candidate = buildEntityDescriptor(arrType, section, {
		id: 101,
		name: 'Local Name B',
		databaseId,
		fingerprint,
	});

	const request = buildMatchRequest(arrType, section, {
		instanceId,
		databaseId,
		remote,
		candidates: [candidate],
	});

	return { remote, candidate, request };
}

// =============================================================================
// Helpers
// =============================================================================

function aggregateFixtureCounters(instances: readonly StartupPullInstanceResult[]): StartupPullCounters {
	const counters = buildEmptyCounters();
	for (const instance of instances) {
		counters.imported += instance.imported;
		counters.skipped_default += instance.skipped_default;
		counters.skipped_no_match += instance.skipped_no_match;
		counters.conflicted += instance.conflicted;
		counters.failed += instance.failed;
	}
	return counters;
}

/**
 * Stable test timestamp constants for deterministic assertions.
 */
export const FIXTURE_TIMESTAMPS = {
	now: NOW_ISO,
	later: LATER_ISO,
	stableRunId: STABLE_RUN_ID,
} as const;

/**
 * All supported arr types for table-driven test iteration.
 */
export const ALL_ARR_TYPES: readonly StartupPullArrType[] = ['radarr', 'sonarr', 'lidarr'] as const;

/**
 * All startup pull sections for table-driven test iteration.
 */
export const ALL_SECTIONS: readonly StartupPullSection[] = [
	'qualityProfiles',
	'delayProfiles',
	'naming',
	'mediaSettings',
	'qualityDefinitions',
	'metadataProfiles',
] as const;

/**
 * Sections that support default filtering.
 */
export const FILTERABLE_SECTIONS: readonly StartupPullSection[] = [
	'qualityProfiles',
	'delayProfiles',
	'metadataProfiles',
] as const;

/**
 * Media management sub-sections.
 */
export const MEDIA_MANAGEMENT_SECTIONS: readonly StartupPullSection[] = [
	'naming',
	'mediaSettings',
	'qualityDefinitions',
] as const;
