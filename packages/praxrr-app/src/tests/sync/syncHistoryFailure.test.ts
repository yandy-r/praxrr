import { assert, assertEquals } from '@std/assert';
import { HttpError } from '$http/types.ts';
import type { SyncHistoryInput } from '$sync/syncHistory/types.ts';
import {
  classifySyncFailure,
  deriveFailureCode,
  GENERIC_SYNC_ERROR_TEXT,
  sanitizeSyncHistoryInput,
  sanitizeSectionResult,
  toSafeSyncErrorText,
} from '$sync/syncHistoryFailure.ts';

const SECRET = 'apikey=sk_live_SECRET123';
const REJECTED_400 = 'The Arr instance rejected the request (HTTP 400).';
const SERVER_500 = 'The Arr instance returned an error (HTTP 500).';
const raw = new HttpError('HTTP 400: Bad Request | ' + JSON.stringify({ message: SECRET }), 400, { message: SECRET });

Deno.test('classifySyncFailure: HttpError maps to a closed reason with protected details preserved', () => {
  const failure = classifySyncFailure(raw);

  assertEquals(failure.code, 'rejected');
  assertEquals(failure.message, REJECTED_400);
  assert(!failure.message.includes('SECRET123'), 'classified message must not embed the raw Arr body');
  assert(JSON.stringify(failure.protectedDetails).includes('SECRET123'), 'protected details keep the raw error');
});

Deno.test('classifySyncFailure: status classes map to closed codes', () => {
  const unreachable = classifySyncFailure(new HttpError('fetch failed to http://radarr:7878', 0));
  assertEquals(unreachable.code, 'unreachable');
  assertEquals(unreachable.message, 'Could not reach the Arr instance.');

  const timeout = classifySyncFailure(new HttpError('Request timeout', 408));
  assertEquals(timeout.code, 'timeout');
  assertEquals(timeout.message, 'The Arr instance timed out.');

  const serverError = classifySyncFailure(new HttpError('HTTP 503: Service Unavailable | boom', 503));
  assertEquals(serverError.code, 'serverError');
  assertEquals(serverError.message, 'The Arr instance returned an error (HTTP 503).');
});

Deno.test('classifySyncFailure: non-HttpError collapses to the generic internal text', () => {
  const failure = classifySyncFailure(new Error(SECRET));

  assertEquals(failure.code, 'internal');
  assertEquals(failure.message, GENERIC_SYNC_ERROR_TEXT);
  assert(JSON.stringify(failure.protectedDetails).includes(SECRET), 'raw error stays in protected details for logs');
});

Deno.test('toSafeSyncErrorText: raw HttpError-format legacy strings map to closed status text', () => {
  const legacy = 'HTTP 500: Internal Server Error | {"detail":"apikey=sk_live_SECRET123"}';
  assertEquals(toSafeSyncErrorText(legacy), SERVER_500);
  assertEquals(toSafeSyncErrorText('HTTP 400: Bad Request | ' + JSON.stringify({ message: SECRET })), REJECTED_400);
});

Deno.test('toSafeSyncErrorText: strings with URLs or host detail collapse to generic text', () => {
  assertEquals(toSafeSyncErrorText('fetch failed: http://radarr:7878/x'), GENERIC_SYNC_ERROR_TEXT);
});

Deno.test('toSafeSyncErrorText: safe allowlisted strings pass through unchanged', () => {
  const label = 'qualityProfiles: failed, delayProfiles: 3 item(s)';
  assertEquals(toSafeSyncErrorText(label), label);
  assertEquals(toSafeSyncErrorText('Sync already in progress'), 'Sync already in progress');
});

Deno.test('toSafeSyncErrorText: idempotent and null-safe', () => {
  const legacy = 'HTTP 500: Internal Server Error | {"detail":"apikey=sk_live_SECRET123"}';
  assertEquals(toSafeSyncErrorText(toSafeSyncErrorText(legacy)), toSafeSyncErrorText(legacy));
  assertEquals(toSafeSyncErrorText(null), null);
  assertEquals(toSafeSyncErrorText(''), null);
});

Deno.test('deriveFailureCode: closed strings map to codes; unknown text maps to null', () => {
  assertEquals(deriveFailureCode('Could not reach the Arr instance.'), 'unreachable');
  assertEquals(deriveFailureCode('The Arr instance timed out.'), 'timeout');
  assertEquals(deriveFailureCode(REJECTED_400), 'rejected');
  assertEquals(deriveFailureCode(SERVER_500), 'serverError');
  assertEquals(deriveFailureCode(GENERIC_SYNC_ERROR_TEXT), 'internal');
  assertEquals(deriveFailureCode('Sync write failed.'), 'internal');
  assertEquals(deriveFailureCode('qualityProfiles: failed, delayProfiles: 3 item(s)'), null);
  assertEquals(deriveFailureCode(null), null);
});

Deno.test('sanitizeSyncHistoryInput: error and section errors sanitized, errorCode filled', () => {
  const input: SyncHistoryInput = {
    arrInstanceId: 1,
    instanceName: 'Radarr one',
    arrType: 'radarr',
    jobId: null,
    trigger: 'manual',
    triggerEvent: null,
    sectionsAttempted: ['qualityProfiles'],
    status: 'failed',
    sectionsRun: 1,
    itemsSynced: 0,
    failureCount: 1,
    sectionResults: [
      {
        section: 'qualityProfiles',
        status: 'failed',
        itemsSynced: 0,
        error: raw.message,
      },
    ],
    changes: [],
    entityOutcomes: [],
    previewId: null,
    error: raw.message,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 5,
  };

  const safe = sanitizeSyncHistoryInput(input);

  assertEquals(safe.error, REJECTED_400);
  assertEquals(safe.sectionResults[0].error, REJECTED_400);
  assertEquals(safe.sectionResults[0].errorCode, 'rejected');
  assert(!JSON.stringify(safe).includes('SECRET123'), 'sanitized input must not carry the raw body');
});

Deno.test('toSafeSyncErrorText rejects arbitrary text and plain credential strings', () => {
  for (const text of [
    'boom',
    'network unreachable',
    'apikey sk_live_SECRET123',
    'Bearer SECRET123',
    'Invalid API key sk_live_SECRET123',
    'constructor',
    'The Arr instance timed out. extra',
    'Failed to sync 2 quality profile(s)\n',
    'version version_unsupported\n',
    'naming: Sync already in progress',
  ]) {
    assertEquals(toSafeSyncErrorText(text), GENERIC_SYNC_ERROR_TEXT);
  }
});

Deno.test('toSafeSyncErrorText preserves only closed writer labels and joins', () => {
  for (const text of [
    GENERIC_SYNC_ERROR_TEXT,
    'Sync write failed.',
    'Failed to sync 2 quality profile(s); Failed to delete 1 managed entity(ies); Skipped 3 reviewed deletion(s)',
    'qualityProfiles: failed, delayProfiles: 3 item(s), 2 entity failure(s), metadataProfiles: skipped (sync already in progress)',
    'mediaManagement: skipped (version version_unsupported)',
    'version base_unsupported',
    'Section metadataProfiles is not supported for radarr',
    'Reviewed sync failed',
    'Arr credentials are not readable. Arr credentials are not readable. Check Arr credential key configuration and recreate the API key. The instance has been disabled.',
    'Arr credentials are not readable. Arr master key configuration is invalid or incomplete. Update ARR_CREDENTIAL_MASTER_KEY settings and retry. The instance has been disabled.',
    'naming: The Arr instance timed out.; mediaSettings: Sync write failed.',
    'naming: TRaSH naming entity is not in the local cache.',
    'qualityDefinitions: TRaSH quality definition is not in the local cache.',
  ]) {
    assertEquals(toSafeSyncErrorText(text), text);
    assertEquals(toSafeSyncErrorText(toSafeSyncErrorText(text)), text);
  }
  assertEquals(toSafeSyncErrorText('evil: The Arr instance timed out.'), GENERIC_SYNC_ERROR_TEXT);
  assertEquals(toSafeSyncErrorText('naming: Bearer SECRET123'), GENERIC_SYNC_ERROR_TEXT);
  assertEquals(toSafeSyncErrorText('qualityProfiles: failed, Bearer SECRET123'), GENERIC_SYNC_ERROR_TEXT);
});

Deno.test('classifySyncFailure keeps non-HTTP diagnostics including response and cause', () => {
  const cause = new Error('original reason');
  const error = Object.assign(new Error('write failed', { cause }), {
    response: { detail: SECRET },
    body: SECRET,
    data: { detail: SECRET },
  });
  const failure = classifySyncFailure(error);
  assertEquals(failure.protectedDetails.cause, cause);
  assertEquals(failure.protectedDetails.response, error.response);
  assertEquals(failure.protectedDetails.responseBody, SECRET);
  assertEquals(failure.protectedDetails.responseData, error.data);
});

Deno.test('deriveFailureCode exactly matches canonical reasons including entity prefixes', () => {
  for (const status of [0, 100, 200, 302, 400, 401, 408, 500, 503]) {
    const failure = classifySyncFailure(new HttpError('upstream details', status));
    assertEquals(deriveFailureCode(failure.message), failure.code);
    assertEquals(deriveFailureCode(`naming: ${failure.message}`), failure.code);
  }
  for (const text of [
    'Command 12 timed out',
    'x The Arr instance timed out.',
    'The Arr instance timed out. extra',
    'evil: The Arr instance timed out.',
    'The Arr instance rejected the request (HTTP 408).',
  ]) {
    assertEquals(deriveFailureCode(text), null);
  }
});

Deno.test('sanitizeSectionResult removes failure codes from non-failed sections', () => {
  for (const status of ['success', 'skipped'] as const) {
    assertEquals(
      sanitizeSectionResult({
        section: 'qualityProfiles',
        status,
        itemsSynced: 0,
        error: SERVER_500,
        errorCode: 'serverError',
      }).errorCode,
      null
    );
  }
  assertEquals(
    sanitizeSectionResult({ section: 'qualityProfiles', status: 'failed', itemsSynced: 0, error: SERVER_500 })
      .errorCode,
    'serverError'
  );
});
