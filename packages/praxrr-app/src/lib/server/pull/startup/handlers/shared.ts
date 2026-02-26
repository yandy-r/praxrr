import { HttpError } from '$http/types.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { ArrInstanceClientCache } from '$arr/arrInstanceClients.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { ArrClientOptions } from '$arr/base.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrDelayProfile } from '$arr/types.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import {
  isSyncSectionSupported,
  getUnsupportedSyncSectionReason,
  isMediaManagementSubsectionSupported,
  getUnsupportedMediaManagementSubsectionReason,
  type MediaManagementSubsection,
  type SyncArrType,
} from '$sync/mappings.ts';
import { type JobRunStatus } from '$jobs/queueTypes.ts';
import type {
  StartupPullArrType,
  StartupPullSection,
  StartupPullEntityDescriptor,
  StartupPullInstanceInput,
  StartupPullCounters,
  StartupPullInstanceResult,
  StartupPullMatchResult,
} from '$lib/server/pull/startup/types.ts';
import { makeStartupMatchNoMatchResult } from '../matching.ts';

/**
 * Handler logic is intentionally duplicated across Radarr/Sonarr/Lidarr where Cross-Arr
 * semantics differ; this file extracts only behavior that is truly shared. Revisit by
 * intent before extracting further to avoid accidental parity bugs.
 */

function isStartupPullSection(section: string): section is StartupPullSection {
  return (
    section === 'qualityProfiles' ||
    section === 'delayProfiles' ||
    section === 'metadataProfiles' ||
    section === 'naming' ||
    section === 'mediaSettings' ||
    section === 'qualityDefinitions'
  );
}

function toSyncArrType(arrType: StartupPullArrType): SyncArrType {
  return arrType;
}

function toMediaManagementSubsection(section: StartupPullSection): MediaManagementSubsection | null {
  if (section === 'mediaSettings' || section === 'naming' || section === 'qualityDefinitions') {
    return section;
  }

  return null;
}

/**
 * Resolves a raw string to a valid `StartupPullArrType`, throwing if unrecognized.
 *
 * @param arrType - The raw arr type string to resolve
 * @returns The validated `StartupPullArrType`
 * @throws {Error} When the string is not a recognized arr type
 */
export function resolveStartupArrType(arrType: string): StartupPullArrType {
  if (!isArrAppType(arrType)) {
    throw new Error(`Unsupported startup arr_type '${arrType}'. Expected one of: radarr, sonarr, lidarr.`);
  }

  return arrType;
}

/**
 * Asserts the given arr type matches the expected type, throwing a descriptive error if not.
 *
 * @param arrType - The arr type string to validate
 * @param expected - The expected `StartupPullArrType`
 * @param context - A context string included in the thrown error message
 * @returns The validated `StartupPullArrType`
 * @throws {Error} When the arr type does not match the expected value
 */
export function assertStartupArrType(
  arrType: string,
  expected: StartupPullArrType,
  context: string
): StartupPullArrType {
  const resolved = resolveStartupArrType(arrType);
  if (resolved !== expected) {
    throw new Error(`${context} unsupported for '${resolved}' instances; expected only '${expected}' instances.`);
  }

  return resolved;
}

/**
 * Loads an Arr instance and creates its API client for use in startup pull processing.
 *
 * @param instance - The Arr instance to load
 * @param options - Optional Arr client options
 * @param cache - Optional client cache to reuse existing clients
 * @returns The resolved instance with its validated type and the constructed API client
 * @throws {Error} When the instance type is not a recognized startup arr type
 */
export async function loadStartupInstanceAndClient(
  instance: ArrInstance,
  options?: ArrClientOptions,
  cache?: ArrInstanceClientCache
): Promise<{
  instance: ArrInstance & { type: StartupPullArrType };
  client: BaseArrClient;
}> {
  const resolvedType = resolveStartupArrType(instance.type);

  const client = await getArrInstanceClient(resolvedType, instance.id, instance.url, options, cache);

  return {
    instance: {
      ...instance,
      type: resolvedType,
    },
    client,
  };
}

/**
 * Returns the reason a section is unsupported for the given arr type, or null if it is supported.
 *
 * @param arrType - The Arr application type to check support for
 * @param section - The startup pull section to evaluate
 * @returns A string reason if unsupported, or null if supported
 */
export function getStartupSectionSupportReason(
  arrType: StartupPullArrType,
  section: StartupPullSection
): string | null {
  const syncType = toSyncArrType(arrType);

  if (section === 'naming' || section === 'mediaSettings' || section === 'qualityDefinitions') {
    const subsection = toMediaManagementSubsection(section);
    if (!subsection) {
      return `Unsupported media-management subsection mapping: ${section}`;
    }

    if (!isMediaManagementSubsectionSupported(syncType, subsection)) {
      return getUnsupportedMediaManagementSubsectionReason(syncType, subsection);
    }

    return null;
  }

  if (!isSyncSectionSupported(syncType, section)) {
    return getUnsupportedSyncSectionReason(syncType, section);
  }

  return null;
}

/**
 * Asserts a section is supported for the given arr type, throwing with context if not.
 *
 * @param arrType - The Arr application type to check support for
 * @param section - The startup pull section to assert support for
 * @param context - A context string included in the thrown error message
 * @throws {Error} When the section is not supported for the given arr type
 */
export function assertStartupSectionSupported(
  arrType: StartupPullArrType,
  section: StartupPullSection,
  context: string
): void {
  const reason = getStartupSectionSupportReason(arrType, section);
  if (reason !== null) {
    throw new Error(`${context}: ${reason}`);
  }
}

/**
 * Returns true if the section is supported for the given arr type.
 *
 * @param arrType - The Arr application type to check support for
 * @param section - The startup pull section to evaluate
 * @returns Whether the section is supported
 */
export function isStartupSectionSupported(arrType: StartupPullArrType, section: StartupPullSection): boolean {
  return getStartupSectionSupportReason(arrType, section) === null;
}

export interface StartupAdapterResultEnvelope {
  status: JobRunStatus;
  output?: string;
  error?: string;
  counters: StartupPullCounters;
}

function createEmptyCounters(): StartupPullCounters {
  return {
    imported: 0,
    skippedDefault: 0,
    skippedNoMatch: 0,
    conflicted: 0,
    failed: 0,
  };
}

/**
 * Creates a fresh adapter result envelope with zero counters and the given status.
 *
 * @param status - The initial job run status for the envelope
 * @returns A new adapter result envelope with zeroed counters
 */
export function createAdapterResultEnvelope(status: JobRunStatus = 'skipped'): StartupAdapterResultEnvelope {
  return {
    status,
    counters: createEmptyCounters(),
  };
}

/**
 * Increments a named counter on the adapter envelope by the given amount.
 *
 * @param envelope - The adapter result envelope to mutate
 * @param counter - The name of the counter to increment
 * @param amount - The amount to add to the counter (default: 1)
 */
export function incrementCounter(
  envelope: StartupAdapterResultEnvelope,
  counter: keyof StartupPullCounters,
  amount = 1
): void {
  envelope.counters[counter] += amount;
}

/**
 * Converts an adapter envelope into a `StartupPullInstanceResult` for the orchestrator.
 *
 * @param input - The instance input containing identification fields
 * @param envelope - The adapter result envelope with status and counters
 * @returns A `StartupPullInstanceResult` ready for the orchestrator
 */
export function toStartupPullInstanceResult(
  input: Pick<StartupPullInstanceInput, 'instanceId' | 'instanceName' | 'arrType'>,
  envelope: StartupAdapterResultEnvelope
): StartupPullInstanceResult {
  return {
    instanceId: input.instanceId,
    instanceName: input.instanceName,
    arrType: input.arrType,
    status: envelope.status,
    ...envelope.counters,
  };
}

/**
 * Validates and narrows a raw string to a known `StartupPullSection`, throwing if unknown.
 *
 * @param section - The raw section string to validate
 * @returns The validated `StartupPullSection`
 * @throws {Error} When the string is not a recognized startup pull section
 */
export function normalizeStartupSection(section: string): StartupPullSection {
  if (!isStartupPullSection(section)) {
    throw new Error(`Unknown startup section '${section}'`);
  }

  return section;
}

export interface StartupFetchFailure {
  readonly success: false;
  readonly kind: 'auth' | 'unreachable' | 'unknown';
  readonly statusCode: number | null;
  readonly message: string;
}

interface StartupFetchErrorOptions {
  readonly programmingErrorLabel?: string;
  readonly unknownErrorMessage?: string;
}

function isLikelyNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const cause = error.cause;
  const causeCode =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? cause.code.toUpperCase()
      : null;

  if (error.name === 'AbortError') {
    return true;
  }

  if (causeCode === null) {
    const messageMatches = /(fetch|network|connect|connection|socket|timed.?out|econn|eai_|dns|lookup)/i.test(message);
    return error.name === 'TypeError' && messageMatches;
  }

  return (
    causeCode === 'ECONNABORTED' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ECONNRESET' ||
    causeCode === 'ENOTFOUND' ||
    causeCode === 'EAI_AGAIN' ||
    causeCode === 'ETIMEDOUT'
  );
}

/**
 * Classifies a thrown error from an Arr API fetch into a structured `StartupFetchFailure` with kind
 * and message.
 *
 * @param arrLabel - A human-readable label for the Arr application used in error messages
 * @param error - The thrown error to classify
 * @param options - Optional overrides for error message labels
 * @returns A `StartupFetchFailure` with `kind` set to `'auth'`, `'unreachable'`, or `'unknown'`
 */
export function classifyStartupFetchError(
  arrLabel: string,
  error: unknown,
  options: StartupFetchErrorOptions = {}
): StartupFetchFailure {
  const prefix = `${arrLabel} startup adapter fetch failed`;
  const programmingErrorLabel = options.programmingErrorLabel ?? 'Programming error';

  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return {
        success: false,
        kind: 'auth',
        statusCode: error.status,
        message: `${prefix}: authentication rejected by ${arrLabel} (HTTP ${error.status}).`,
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
        message: `${prefix}: unable to reach ${arrLabel} API (HTTP ${error.status}).`,
      };
    }

    return {
      success: false,
      kind: 'unknown',
      statusCode: error.status,
      message: `${prefix}: ${arrLabel} API returned HTTP ${error.status}.`,
    };
  }

  if (error instanceof Error) {
    const isNetworkError = isLikelyNetworkError(error);
    return {
      success: false,
      kind: isNetworkError ? 'unreachable' : 'unknown',
      statusCode: null,
      message: isNetworkError ? `${prefix}: ${error.message}` : `${prefix}: ${programmingErrorLabel}: ${error.message}`,
    };
  }

  return {
    success: false,
    kind: 'unknown',
    statusCode: null,
    message: options.unknownErrorMessage ?? `${prefix}.`,
  };
}

/**
 * Extracts a human-readable name from an Arr delay profile, falling back to `Delay Profile {id}`.
 *
 * @param profile - The Arr delay profile to extract the name from
 * @returns The profile name, or a generated fallback using the profile ID
 */
export function getDelayProfileName(profile: ArrDelayProfile): string {
  const rawName = (profile as { name?: unknown }).name;
  if (typeof rawName === 'string' && rawName.length > 0) {
    return rawName;
  }

  return `Delay Profile ${profile.id}`;
}

/**
 * Sorts startup entity descriptors alphabetically by name, then by database ID and entity ID.
 *
 * @param items - The list of entity descriptors to sort
 * @returns A new sorted array of entity descriptors
 */
export function sortStartupCandidates(items: readonly StartupPullEntityDescriptor[]): StartupPullEntityDescriptor[] {
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

/**
 * Increments the appropriate counter on an envelope based on the match result status.
 *
 * @param envelope - The adapter result envelope to mutate
 * @param result - The match result whose status determines which counter to increment
 */
export function incrementCountersFromMatchResult(
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
    incrementCounter(envelope, 'skippedDefault');
    return;
  }

  incrementCounter(envelope, 'skippedNoMatch');
}

/**
 * Builds a no-match result for a section that is not supported by the given arr type.
 *
 * @param instanceId - The instance ID for the result
 * @param databaseId - The fallback database ID to associate with the result
 * @param reason - An object containing the unsupported section name
 * @param arrType - The Arr application type for the result
 * @returns A `StartupPullMatchResult` with `status: 'no_match'` and reason `'unsupported_section'`
 */
export function buildUnsupportedSectionResult(
  instanceId: number,
  databaseId: number,
  reason: { section: StartupPullSection },
  arrType: StartupPullArrType
): StartupPullMatchResult {
  return {
    ...makeStartupMatchNoMatchResult(
      {
        instanceId,
        databaseId,
        section: reason.section,
        arrType,
        remote: {
          id: `unsupported:${reason.section}`,
          name: reason.section,
          section: reason.section,
          arrType,
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
