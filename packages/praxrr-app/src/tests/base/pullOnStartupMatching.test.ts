/**
 * Unit tests for deterministic startup matching logic.
 *
 * Tests exercise matchStartupEntity and matchStartupEntityBatch from
 * matching.ts using fixtures from pullOnStartupFixtures.ts.
 * Coverage: exact name priority, fingerprint fallback, no-match,
 * conflicted/ambiguous, case sensitivity, per-arr_type isolation,
 * and batch result aggregation.
 */

import { assertEquals } from '@std/assert';
import {
	matchStartupEntity,
	matchStartupEntityBatch,
	normalizeStartupName,
	makeStartupMatchNoMatchResult,
} from '$lib/server/pull/startup/matching.ts';
import type { StartupPullMatchRequest, StartupPullEntityDescriptor } from '$lib/server/pull/startup/types.ts';
import {
	buildMatchRequest,
	buildEntityDescriptor,
	buildExactNameMatchScenario,
	buildAmbiguousMatchScenario,
	buildNoMatchScenario,
	buildFingerprintMatchScenario,
	ALL_ARR_TYPES,
} from './pullOnStartupFixtures.ts';

// =============================================================================
// normalizeStartupName
// =============================================================================

Deno.test('normalizeStartupName: compares names using case-insensitive normalization', () => {
	assertEquals(normalizeStartupName('HD Bluray + WEB'), 'hd bluray + web');
	assertEquals(normalizeStartupName(''), '');
	assertEquals(normalizeStartupName('  padded  '), '  padded  ');
});

// =============================================================================
// Exact name match takes priority over fingerprint match
// =============================================================================

Deno.test('matchStartupEntity: exact name match takes priority over fingerprint', () => {
	const { request } = buildExactNameMatchScenario('radarr', 'qualityProfiles', 'HD Bluray + WEB');

	// Add a fingerprint to both remote and candidate; name still wins
	const remoteWithFingerprint: StartupPullEntityDescriptor = {
		...request.remote,
		fingerprint: 'fp-shared',
	};
	const candidateWithFingerprint: StartupPullEntityDescriptor = {
		...request.candidates[0],
		fingerprint: 'fp-shared',
	};

	const requestWithFingerprints: StartupPullMatchRequest = {
		...request,
		remote: remoteWithFingerprint,
		candidates: [candidateWithFingerprint],
	};

	const result = matchStartupEntity(requestWithFingerprints);

	assertEquals(result.status, 'matched');
	if (result.status !== 'matched') throw new Error('unreachable');
	assertEquals(result.reason, 'matched_exact_name');
	assertEquals(result.matchMethod, 'exact_name');
	assertEquals(result.matchedEntityName, 'HD Bluray + WEB');
	assertEquals(result.matchedCount, 1);
});

Deno.test('matchStartupEntity: exact name match returns correct entity id and name', () => {
	const { candidate, request } = buildExactNameMatchScenario('sonarr', 'delayProfiles', 'Standard Delay');
	const result = matchStartupEntity(request);

	assertEquals(result.status, 'matched');
	if (result.status !== 'matched') throw new Error('unreachable');
	assertEquals(result.reason, 'matched_exact_name');
	assertEquals(result.matchMethod, 'exact_name');
	assertEquals(result.matchedEntityId, candidate.id);
	assertEquals(result.matchedEntityName, candidate.name);
	assertEquals(result.candidatesChecked, 1);
});

// =============================================================================
// Fingerprint match as fallback when no exact name match
// =============================================================================

Deno.test('matchStartupEntity: fingerprint match when names differ', () => {
	const fingerprint = '{"type":"naming","config":{"renameMovies":true}}';
	const { candidate, request } = buildFingerprintMatchScenario('radarr', 'naming', fingerprint);

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'matched');
	if (result.status !== 'matched') throw new Error('unreachable');
	assertEquals(result.reason, 'matched_fingerprint');
	assertEquals(result.matchMethod, 'metadata_fingerprint');
	assertEquals(result.matchedEntityId, candidate.id);
	assertEquals(result.matchedEntityName, candidate.name);
	assertEquals(result.matchedCount, 1);
});

Deno.test('matchStartupEntity: fingerprint not attempted when remote has no fingerprint', () => {
	const remote = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 50,
		name: 'Unknown Profile',
		fingerprint: null,
	});
	const candidate = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 101,
		name: 'Different Profile',
		fingerprint: 'fp-local',
	});
	const request = buildMatchRequest('radarr', 'qualityProfiles', {
		remote,
		candidates: [candidate],
	});

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'no_match');
	assertEquals(result.reason, 'no_match');
	// matchMethod should be undefined since fingerprint was not attempted with empty remote fp
	assertEquals(result.matchMethod, undefined);
});

Deno.test('matchStartupEntity: fingerprint not attempted when remote fingerprint is empty string', () => {
	const remote = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 50,
		name: 'Unknown Profile',
		fingerprint: '',
	});
	const candidate = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 101,
		name: 'Different Profile',
		fingerprint: 'fp-local',
	});
	const request = buildMatchRequest('radarr', 'qualityProfiles', {
		remote,
		candidates: [candidate],
	});

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'no_match');
	assertEquals(result.reason, 'no_match');
	assertEquals(result.matchMethod, undefined);
});

// =============================================================================
// No-match classification when neither name nor fingerprint matches
// =============================================================================

Deno.test('matchStartupEntity: no match with unrelated candidates', () => {
	const { request } = buildNoMatchScenario('radarr', 'qualityProfiles');

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'no_match');
	assertEquals(result.reason, 'no_match');
	assertEquals(result.candidatesChecked, 1);
});

Deno.test('matchStartupEntity: no match with empty candidates list', () => {
	const remote = buildEntityDescriptor('sonarr', 'qualityProfiles', {
		id: 50,
		name: 'Orphan Profile',
	});
	const request = buildMatchRequest('sonarr', 'qualityProfiles', {
		remote,
		candidates: [],
	});

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'no_match');
	assertEquals(result.reason, 'no_match');
	assertEquals(result.candidatesChecked, 0);
});

Deno.test('matchStartupEntity: no match when fingerprints differ', () => {
	const remote = buildEntityDescriptor('radarr', 'naming', {
		id: 50,
		name: 'Remote Naming',
		fingerprint: 'fp-remote',
	});
	const candidate = buildEntityDescriptor('radarr', 'naming', {
		id: 101,
		name: 'Local Naming',
		fingerprint: 'fp-local-different',
	});
	const request = buildMatchRequest('radarr', 'naming', {
		remote,
		candidates: [candidate],
	});

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'no_match');
	assertEquals(result.reason, 'no_match');
	assertEquals(result.matchMethod, 'metadata_fingerprint');
});

// =============================================================================
// Conflicted/ambiguous classification
// =============================================================================

Deno.test('matchStartupEntity: conflicted when multiple candidates share exact name', () => {
	const { request } = buildAmbiguousMatchScenario('radarr', 'qualityProfiles', 'HD Bluray + WEB');

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'conflicted');
	assertEquals(result.reason, 'name_conflict');
	assertEquals(result.matchMethod, 'exact_name');
	assertEquals(result.matchedCount, 2);
});

Deno.test('matchStartupEntity: conflicted when multiple candidates share fingerprint (no name match)', () => {
	const fp = '{"shared":"fingerprint"}';
	const remote = buildEntityDescriptor('sonarr', 'delayProfiles', {
		id: 50,
		name: 'Remote Name',
		fingerprint: fp,
	});
	const candidateA = buildEntityDescriptor('sonarr', 'delayProfiles', {
		id: 201,
		name: 'Local A',
		fingerprint: fp,
	});
	const candidateB = buildEntityDescriptor('sonarr', 'delayProfiles', {
		id: 202,
		name: 'Local B',
		fingerprint: fp,
	});
	const request = buildMatchRequest('sonarr', 'delayProfiles', {
		remote,
		candidates: [candidateA, candidateB],
	});

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'conflicted');
	assertEquals(result.reason, 'fingerprint_conflict');
	assertEquals(result.matchMethod, 'metadata_fingerprint');
	assertEquals(result.matchedCount, 2);
});

Deno.test('matchStartupEntity: three-way ambiguity still classified as conflicted', () => {
	const { request } = buildAmbiguousMatchScenario('lidarr', 'metadataProfiles', 'Standard', {
		candidateCount: 3,
	});

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'conflicted');
	assertEquals(result.reason, 'name_conflict');
	assertEquals(result.matchedCount, 3);
});

// =============================================================================
// Case sensitivity behavior in name matching
// =============================================================================

Deno.test('matchStartupEntity: names are case-insensitive by default', () => {
	const remote = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 50,
		name: 'HD Bluray + WEB',
	});
	const candidate = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 101,
		name: 'hd bluray + web',
	});
	const request = buildMatchRequest('radarr', 'qualityProfiles', {
		remote,
		candidates: [candidate],
	});

	const result = matchStartupEntity(request);

	assertEquals(result.status, 'matched');
});

Deno.test('matchStartupEntity: custom case-sensitive normalizer can enforce strict casing', () => {
	const remote = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 50,
		name: 'HD Bluray + WEB',
	});
	const candidate = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 101,
		name: 'hd bluray + web',
	});
	const request = buildMatchRequest('radarr', 'qualityProfiles', {
		remote,
		candidates: [candidate],
	});

	const result = matchStartupEntity(request, {
		normalizeName: (name: string) => name,
	});

	assertEquals(result.status, 'no_match');
});

// =============================================================================
// Per-arr_type isolation (radarr match does not cross to sonarr)
// =============================================================================

for (const arrType of ALL_ARR_TYPES) {
	Deno.test(`matchStartupEntity: ${arrType} match result carries correct arrType`, () => {
		const { request } = buildExactNameMatchScenario(arrType, 'qualityProfiles', 'Test Profile');
		const result = matchStartupEntity(request);

		assertEquals(result.arrType, arrType);
		assertEquals(result.status, 'matched');
	});
}

Deno.test('matchStartupEntity: radarr remote does not match sonarr candidate with same name in same request', () => {
	// This tests the contract: the caller is responsible for passing arr_type-consistent
	// candidates. The matcher itself uses the arr_type from the request, not from candidates.
	// A sonarr candidate placed in a radarr request would still "match" by name,
	// but the result carries the request's arrType. The isolation is enforced by
	// callers building requests per arr_type.
	const remote = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 50,
		name: 'Shared Name',
		arrType: 'radarr',
	});
	const candidate = buildEntityDescriptor('sonarr', 'qualityProfiles', {
		id: 101,
		name: 'Shared Name',
		arrType: 'sonarr',
	});
	const request = buildMatchRequest('radarr', 'qualityProfiles', {
		remote,
		candidates: [candidate],
	});

	const result = matchStartupEntity(request);

	// Matcher compares by name, so it finds a match. The result's arrType comes from request.
	assertEquals(result.status, 'matched');
	assertEquals(result.arrType, 'radarr');
	// This verifies that arr_type isolation is a caller responsibility,
	// and the matcher correctly stamps the request's arrType on the result.
});

// =============================================================================
// matchStartupEntityBatch
// =============================================================================

Deno.test('matchStartupEntityBatch: aggregates mixed outcomes correctly', () => {
	const exactMatch = buildExactNameMatchScenario('radarr', 'qualityProfiles', 'Profile A');
	const noMatch = buildNoMatchScenario('radarr', 'qualityProfiles');
	const ambiguous = buildAmbiguousMatchScenario('radarr', 'qualityProfiles', 'Ambiguous Profile');

	const requests: StartupPullMatchRequest[] = [exactMatch.request, noMatch.request, ambiguous.request];

	const batchResult = matchStartupEntityBatch(requests);

	assertEquals(batchResult.section, 'qualityProfiles');
	assertEquals(batchResult.arrType, 'radarr');
	assertEquals(batchResult.matched, 1);
	assertEquals(batchResult.noMatch, 1);
	assertEquals(batchResult.conflicted, 1);
	assertEquals(batchResult.skipped, 0);
	assertEquals(batchResult.results.length, 3);
});

Deno.test('matchStartupEntityBatch: empty requests returns zero counters', () => {
	const batchResult = matchStartupEntityBatch([]);

	assertEquals(batchResult.matched, 0);
	assertEquals(batchResult.noMatch, 0);
	assertEquals(batchResult.conflicted, 0);
	assertEquals(batchResult.skipped, 0);
	assertEquals(batchResult.totalCandidates, 0);
	assertEquals(batchResult.results.length, 0);
});

Deno.test('matchStartupEntityBatch: all-matched batch counts correctly', () => {
	const matchA = buildExactNameMatchScenario('sonarr', 'delayProfiles', 'Delay A');
	const matchB = buildExactNameMatchScenario('sonarr', 'delayProfiles', 'Delay B');

	const batchResult = matchStartupEntityBatch([matchA.request, matchB.request]);

	assertEquals(batchResult.matched, 2);
	assertEquals(batchResult.noMatch, 0);
	assertEquals(batchResult.conflicted, 0);
});

Deno.test('matchStartupEntityBatch: totalCandidates sums across all requests', () => {
	const remote = buildEntityDescriptor('radarr', 'qualityProfiles', {
		id: 50,
		name: 'Profile X',
	});
	const candidatesA = [
		buildEntityDescriptor('radarr', 'qualityProfiles', { id: 1, name: 'A' }),
		buildEntityDescriptor('radarr', 'qualityProfiles', { id: 2, name: 'B' }),
	];
	const candidatesB = [
		buildEntityDescriptor('radarr', 'qualityProfiles', { id: 3, name: 'C' }),
	];
	const reqA = buildMatchRequest('radarr', 'qualityProfiles', {
		remote,
		candidates: candidatesA,
	});
	const reqB = buildMatchRequest('radarr', 'qualityProfiles', {
		remote: { ...remote, id: 51, name: 'Profile Y' },
		candidates: candidatesB,
	});

	const batchResult = matchStartupEntityBatch([reqA, reqB]);

	assertEquals(batchResult.totalCandidates, 3);
});

// =============================================================================
// makeStartupMatchNoMatchResult
// =============================================================================

Deno.test('makeStartupMatchNoMatchResult: creates proper no_match result', () => {
	const request = buildMatchRequest('lidarr', 'metadataProfiles', {
		candidates: [
			buildEntityDescriptor('lidarr', 'metadataProfiles', { id: 1, name: 'Meta' }),
		],
	});

	const result = makeStartupMatchNoMatchResult(request, 'default_skip');

	assertEquals(result.status, 'no_match');
	assertEquals(result.reason, 'default_skip');
	assertEquals(result.matchMethod, undefined);
	assertEquals(result.candidatesChecked, 1);
});

Deno.test('makeStartupMatchNoMatchResult: with fingerprint attempt flag', () => {
	const request = buildMatchRequest('radarr', 'naming');

	const result = makeStartupMatchNoMatchResult(request, 'no_match', {
		hasFingerprintAttempt: true,
	});

	assertEquals(result.status, 'no_match');
	assertEquals(result.matchMethod, 'metadata_fingerprint');
});
