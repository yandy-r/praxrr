import { assert, assertEquals } from '@std/assert';
import { buildTrashGuideSyncFailure, isRetryableFailureCode } from '$jobs/trashguide/syncFailure.ts';
import type { TrashGuideSyncFailureCode } from '$jobs/queueTypes.ts';

/** The full closed vocabulary of failure codes (issue #238). */
const ALL_CODES: readonly TrashGuideSyncFailureCode[] = [
  'source_missing',
  'source_disabled',
  'network',
  'parser_failed',
  'sync_failed',
  'internal',
];

/** Substrings that would betray a raw diagnostic leaking into safe copy. */
const FORBIDDEN_SUBSTRINGS: readonly string[] = ['://', 'git', 'http', 'stack', 'Error'];

Deno.test('buildTrashGuideSyncFailure echoes the code and returns non-empty safe copy for every code', () => {
  for (const code of ALL_CODES) {
    const reason = buildTrashGuideSyncFailure(code);
    assertEquals(reason.code, code);
    assert(typeof reason.message === 'string' && reason.message.length > 0, `empty message for ${code}`);
    assert(
      typeof reason.recoveryAction === 'string' && reason.recoveryAction.length > 0,
      `empty recoveryAction for ${code}`
    );
  }
});

Deno.test('isRetryableFailureCode maps config failures to false and transient failures to true', () => {
  const table: readonly [TrashGuideSyncFailureCode, boolean][] = [
    ['source_missing', false],
    ['source_disabled', false],
    ['network', true],
    ['parser_failed', true],
    ['sync_failed', true],
    ['internal', true],
  ];

  for (const [code, expected] of table) {
    assertEquals(isRetryableFailureCode(code), expected, `unexpected retryability for ${code}`);
  }
});

Deno.test('safe copy never embeds raw-diagnostic shapes', () => {
  for (const code of ALL_CODES) {
    const { message, recoveryAction } = buildTrashGuideSyncFailure(code);
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      assert(!message.includes(forbidden), `message for ${code} contains forbidden token "${forbidden}"`);
      assert(
        !recoveryAction.includes(forbidden),
        `recoveryAction for ${code} contains forbidden token "${forbidden}"`
      );
    }
  }
});
