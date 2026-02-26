import type {
  StartupPullMatchReason,
  StartupPullMatchRequest,
  StartupPullMatchResult,
  StartupPullSection,
  StartupPullUnmatchedResult,
} from '$lib/server/pull/startup/types.ts';

/**
 * Startup entity matching uses a two-phase strategy:
 * first try exact normalized name matching; if that fails, fall back to fingerprint matching.
 * Either phase can return `conflicted` when multiple candidates match.
 */
export type StartupNameNormalizer = (name: string) => string;

export interface StartupMatchOptions {
  normalizeName?: StartupNameNormalizer;
}

export interface StartupMatchBatchResult {
  readonly section: StartupPullSection;
  readonly arrType: StartupPullMatchRequest['arrType'];
  readonly totalCandidates: number;
  readonly matched: number;
  readonly noMatch: number;
  readonly conflicted: number;
  readonly skipped: number;
  readonly results: readonly StartupPullMatchResult[];
}

/**
 * Lowercases a startup entity name for case-insensitive comparison.
 *
 * @param name - The entity name to normalize
 * @returns The lowercased name string
 */
export function normalizeStartupName(name: string): string {
  return name.toLocaleLowerCase();
}

/**
 * Attempts to match a single remote entity against a set of local candidates, returning a structured
 * match result.
 *
 * @param request - The match request containing the remote entity and candidate list
 * @param options - Optional overrides for name normalization behavior
 * @returns A `StartupPullMatchResult` with matched, conflicted, or no_match status
 */
export function matchStartupEntity(
  request: StartupPullMatchRequest,
  options: StartupMatchOptions = {}
): StartupPullMatchResult {
  const normalize = options.normalizeName ?? normalizeStartupName;
  const candidateCount = request.candidates.length;
  const normalizedRemoteName = normalize(request.remote.name);

  const exactMatches = request.candidates.filter((candidate) => {
    return normalize(candidate.name) === normalizedRemoteName;
  });

  if (exactMatches.length === 1) {
    const matched = exactMatches[0];
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

  if (exactMatches.length > 1) {
    return {
      instanceId: request.instanceId,
      databaseId: request.databaseId,
      section: request.section,
      arrType: request.arrType,
      status: 'conflicted',
      reason: 'name_conflict',
      matchMethod: 'exact_name',
      matchedCount: exactMatches.length,
      candidatesChecked: candidateCount,
    };
  }

  const remoteFingerprint = request.remote.fingerprint;
  if (typeof remoteFingerprint !== 'string' || remoteFingerprint.length === 0) {
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

/**
 * Matches a batch of startup match requests and aggregates counts across all results.
 *
 * @param requests - A non-empty list of match requests to process
 * @param options - Optional overrides for name normalization behavior
 * @returns An aggregated batch result with per-status counts and all individual results
 * @throws {Error} When called with an empty requests array
 */
export function matchStartupEntityBatch(
  requests: readonly StartupPullMatchRequest[],
  options: StartupMatchOptions = {}
): StartupMatchBatchResult {
  if (requests.length === 0) {
    throw new Error('matchStartupEntityBatch called with empty requests');
  }

  const results = requests.map((request) => matchStartupEntity(request, options));

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

  const first = requests[0];

  return {
    section: first?.section ?? 'qualityProfiles',
    arrType: first?.arrType ?? 'radarr',
    totalCandidates,
    matched,
    noMatch,
    conflicted,
    skipped,
    results,
  };
}

/**
 * Creates a no-match result for a startup match request with the given reason.
 *
 * @param request - The match request to create a no-match result for
 * @param reason - The reason for the no-match outcome
 * @param options - Optional flags such as whether a fingerprint attempt was made
 * @returns A `StartupPullUnmatchedResult` with `status: 'no_match'`
 */
export function makeStartupMatchNoMatchResult(
  request: StartupPullMatchRequest,
  reason: StartupPullMatchReason,
  options: { hasFingerprintAttempt?: boolean } = {}
): StartupPullUnmatchedResult {
  return {
    instanceId: request.instanceId,
    databaseId: request.databaseId,
    section: request.section,
    arrType: request.arrType,
    status: 'no_match',
    reason,
    matchMethod: options.hasFingerprintAttempt ? 'metadata_fingerprint' : undefined,
    candidatesChecked: request.candidates.length,
  };
}
