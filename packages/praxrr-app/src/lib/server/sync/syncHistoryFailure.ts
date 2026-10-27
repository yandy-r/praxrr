/**
 * Closed sync-history failure vocabulary and legacy-data backstop.
 * History groups authorization/not-found under rejected; preview codes retain actionable recovery distinctions.
 * Raw diagnostics belong only in protectedDetails for the sanitized server logger.
 */
import { HttpError } from '$http/types.ts';
import type { SyncSectionResult } from './syncHistory/types.ts';
import {
  describeHttpStatus,
  sanitizeArrWriteError,
  SYNC_WRITE_FAILED_REASON,
  type ArrWriteFailureCode,
} from './sanitizeArrWriteError.ts';

export type SyncFailureCode = ArrWriteFailureCode;

export interface ClassifiedSyncFailure {
  code: SyncFailureCode;
  message: string;
  protectedDetails: Record<string, unknown>;
}

export const GENERIC_SYNC_ERROR_TEXT = 'Sync failed. Check the server logs for details.';

const RAW_HTTP_MESSAGE = /^HTTP (\d{3}):/;
const ENTITY_PREFIX =
  /^(?:customFormat|qualityProfile|delayProfile|metadataProfile|naming|mediaSettings|qualityDefinitions): /;
const FIXED_REASON_CODES: Readonly<Record<string, SyncFailureCode>> = Object.fromEntries([
  ...[0, 408, 200].map((status): [string, SyncFailureCode] => {
    const { reason, code } = describeHttpStatus(status);
    return [reason, code];
  }),
  [SYNC_WRITE_FAILED_REASON, 'internal'],
  [GENERIC_SYNC_ERROR_TEXT, 'internal'],
]);

/** Exact lookup, including canonical parameterized HTTP reasons from the shared status table. */
function closedReasonCode(text: string): SyncFailureCode | null {
  const fixed = Object.hasOwn(FIXED_REASON_CODES, text) ? FIXED_REASON_CODES[text] : null;
  if (fixed) return fixed;
  const match = /\(HTTP (\d+)\)\.$/.exec(text);
  if (!match) return null;
  const description = describeHttpStatus(Number(match[1]));
  return description.reason === text ? description.code : null;
}

// These are static labels emitted by the current syncers and Arr sync job handler.
const STATIC_LABELS = [
  'Sync already in progress',
  'Reviewed sync failed',
  'Reviewed sync execution failed',
  'No sync sections specified',
  'Invalid reviewed quality profile execution context',
  'Delay profiles are not supported for this arr instance type',
  'Reviewed delay profile target type does not match the active arr client',
  'Prepared media-management context does not match the target arr type.',
  'Prepared media-management identity guard is inconsistent.',
  'Prepared quality-definition identity guards are inconsistent.',
  'Media settings are not supported for this arr instance type.',
  'Naming is not supported for this arr instance type.',
  'Quality definitions are not supported for this arr instance type.',
  'Arr credentials are not readable. Arr credentials are not readable. Check Arr credential key configuration and recreate the API key. The instance has been disabled.',
  'Arr credentials are not readable. Arr master key configuration is invalid or incomplete. Update ARR_CREDENTIAL_MASTER_KEY settings and retry. The instance has been disabled.',
];
const SECTION = '(?:qualityProfiles|delayProfiles|mediaManagement|metadataProfiles)';
const ARR = '(?:radarr|sonarr|lidarr)';
const UNSUPPORTED = `Section ${SECTION} is not supported for ${ARR}`;
const VERSION = 'version (?:base_unsupported|version_unsupported)';
const SECTION_SUMMARY = `${SECTION}: (?:failed|\\d+ item\\(s\\)(?:, \\d+ entity failure\\(s\\))?|skipped(?: \\((?:sync already in progress|${UNSUPPORTED}|${VERSION})\\))?)`;
const STATIC_PATTERNS = [
  new RegExp(`^(?:${SECTION_SUMMARY})(?:, ${SECTION_SUMMARY})*$`),
  new RegExp(`^${UNSUPPORTED}$`),
  new RegExp(`^${VERSION}$`),
  new RegExp(`^Reviewed quality profile plan targets ${ARR}, not ${ARR}$`),
  /^Failed to sync \d+ quality profile\(s\)$/,
  /^Failed to delete \d+ managed entity\(ies\)$/,
  /^Skipped \d+ reviewed deletion\(s\)(?: because a write failed)?$/,
  /^TRaSH source \d+ is no longer available\.$/,
];
const ENTITY_STATIC_REASON =
  /^(?:Prepared media-management identity guard is inconsistent\.|Prepared quality-definition identity guards are inconsistent\.|Media settings are not supported for this arr instance type\.|Naming is not supported for this arr instance type\.|Quality definitions are not supported for this arr instance type\.|TRaSH source \d+ is no longer available\.|TRaSH naming entity is not in the local cache\.|TRaSH quality definition is not in the local cache\.)$/;

function isSafeLabel(text: string): boolean {
  return (
    closedReasonCode(text) !== null ||
    STATIC_LABELS.includes(text) ||
    STATIC_PATTERNS.some((pattern) => pattern.test(text))
  );
}

export function classifySyncFailure(error: unknown): ClassifiedSyncFailure {
  const { reason, protectedDetails } = sanitizeArrWriteError(error);
  return error instanceof HttpError
    ? { code: describeHttpStatus(error.status).code, message: reason, protectedDetails }
    : { code: 'internal', message: GENERIC_SYNC_ERROR_TEXT, protectedDetails };
}

/** Only the closed reasons and exact writer labels may survive a legacy-data read. */
export function toSafeSyncErrorText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.length === 0) return null;
  const httpMatch = RAW_HTTP_MESSAGE.exec(raw);
  if (httpMatch) return describeHttpStatus(Number(httpMatch[1])).reason;
  if (/[\r\n]/.test(raw)) return GENERIC_SYNC_ERROR_TEXT;
  if (isSafeLabel(raw)) return raw;
  // Quality-profile summaries and media-management entity reasons are joined with semicolons.
  const parts = raw.split('; ');
  if (
    parts.every((part) => {
      const prefix = ENTITY_PREFIX.exec(part);
      if (!prefix) return isSafeLabel(part);
      const reason = part.slice(prefix[0].length);
      return closedReasonCode(reason) !== null || ENTITY_STATIC_REASON.test(reason);
    })
  )
    return raw;
  return GENERIC_SYNC_ERROR_TEXT;
}

export function deriveFailureCode(safeText: string | null): SyncFailureCode | null {
  if (safeText === null) return null;
  return closedReasonCode(safeText.replace(ENTITY_PREFIX, ''));
}

export function sanitizeSectionResult(result: SyncSectionResult): SyncSectionResult {
  const error = toSafeSyncErrorText(result.error);
  return {
    ...result,
    error,
    errorCode: result.status === 'failed' ? (result.errorCode ?? deriveFailureCode(error)) : null,
  };
}

export function sanitizeSyncHistoryInput<T extends { error: string | null; sectionResults: SyncSectionResult[] }>(
  input: T
): T {
  return {
    ...input,
    error: toSafeSyncErrorText(input.error),
    sectionResults: input.sectionResults.map(sanitizeSectionResult),
  };
}
