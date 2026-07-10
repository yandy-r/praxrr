import { assert, assertEquals } from '@std/assert';
import { buildSafeJobEvidence, classifyJobFailure, FAILURE_COPY, JOB_EVIDENCE_DESCRIPTORS } from '$jobs/evidence.ts';
import { JOB_TYPES, type JobHandlerResult, type JobQueueRecord, type JobType } from '$jobs/queueTypes.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';
import {
  boundString,
  isSafeJobEvidence,
  JOB_EVIDENCE_BOUNDS,
  JOB_EVIDENCE_SCHEMA_VERSION,
  parseSafeJobEvidence,
  type JobFailureCode,
  type SafeJobEvidence,
} from '$shared/jobs/evidence.ts';
import { HttpError } from '$http/types.ts';
import { NotGitRepositoryError } from '$utils/git/errors.ts';

// Register production handlers (side-effect only) so the registry-drift assertion is meaningful.
import '$jobs/handlers/index.ts';

const ALL_CODES: JobFailureCode[] = [
  'invalidPayload',
  'targetNotFound',
  'unsupported',
  'precondition',
  'credential',
  'upstream',
  'timeout',
  'gitNetwork',
  'filesystem',
  'database',
  'validation',
  'handlerNotFound',
  'internalError',
];

// Secret-shaped fixtures mirroring lib/tests/logger/sanitizerRegression.test.ts. If any of these
// were ever copied into a persisted evidence record, the durable safety guarantee would be broken.
const SECRETS = {
  hex32: 'deadbeefdeadbeefdeadbeefdeadbeef',
  skToken: 'sk-ABCDEFGHIJKLMNOPQRSTUVWX',
  bearer: 'Bearer sk-ABCDEFGHIJKLMNOPQRSTUVWX',
  jwt: 'aaaa.bbbb.cccc',
  gitPat: 'https://x-access-token:ghp_ABCDEFedcba0123456789@github.com/o/r.git',
  keyUrl: 'https://arr.example/api?apikey=deadbeefdeadbeefdeadbeefdeadbeef&mode=x',
};

function makeJob(jobType: JobType, payload: Record<string, unknown> = {}): JobQueueRecord {
  return {
    id: 1,
    jobType,
    status: 'running',
    runAt: '2026-07-10T00:00:00.000Z',
    payload: payload as JobQueueRecord['payload'],
    source: 'schedule',
    dedupeKey: null,
    cooldownUntil: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}

// A job with a null-target descriptor keeps buildSafeJobEvidence DB-free.
const GLOBAL_JOB = makeJob('backup.cleanup');

Deno.test('evidence descriptors are exhaustive over JobType and match production registrations', () => {
  const descriptorKeys = Object.keys(JOB_EVIDENCE_DESCRIPTORS).sort();
  const declared = [...JOB_TYPES].sort();
  const registered = jobQueueRegistry
    .getAll()
    .map(({ jobType }) => jobType)
    .sort();

  assertEquals(descriptorKeys, declared, 'every JobType must have exactly one evidence descriptor');
  assertEquals(registered, declared, 'every JobType must have exactly one registered handler');

  for (const jobType of JOB_TYPES) {
    assertEquals(
      typeof JOB_EVIDENCE_DESCRIPTORS[jobType].resolveTarget,
      'function',
      `${jobType} descriptor must expose a resolveTarget`
    );
  }
});

Deno.test('buildSafeJobEvidence tolerates an unknown/legacy jobType without throwing', () => {
  // The dispatcher's handler-not-found branch runs for a jobType with no registered handler —
  // exactly when JOB_EVIDENCE_DESCRIPTORS has no descriptor. Evidence capture must degrade the
  // target to null, never crash on an undefined descriptor.
  const orphan = { ...GLOBAL_JOB, jobType: 'foo.legacy.removed' as JobType };
  const evidence = buildSafeJobEvidence(orphan, { status: 'failure', failureCode: 'handlerNotFound' });
  assertEquals(evidence.target, null);
  assertEquals(evidence.failure?.code, 'handlerNotFound');
  assertEquals(evidence.failure?.message, FAILURE_COPY.handlerNotFound.message);
  assertEquals(evidence.schemaVersion, JOB_EVIDENCE_SCHEMA_VERSION);
});

Deno.test('FAILURE_COPY provides safe non-empty copy for every failure code', () => {
  for (const code of ALL_CODES) {
    const copy = FAILURE_COPY[code];
    assert(copy, `missing FAILURE_COPY for ${code}`);
    assert(copy.message.trim().length > 0, `${code} needs a message`);
    assert(copy.recovery.trim().length > 0, `${code} needs a recovery hint`);
  }
  assertEquals(Object.keys(FAILURE_COPY).sort(), [...ALL_CODES].sort(), 'FAILURE_COPY must be total');
});

Deno.test('classifyJobFailure is anchored on error type/status only', () => {
  assertEquals(classifyJobFailure(new HttpError('x', 401)), 'credential');
  assertEquals(classifyJobFailure(new HttpError('x', 403)), 'credential');
  assertEquals(classifyJobFailure(new HttpError('x', 404)), 'targetNotFound');
  assertEquals(classifyJobFailure(new HttpError('x', 408)), 'timeout');
  assertEquals(classifyJobFailure(new HttpError('x', 500)), 'upstream');
  assertEquals(classifyJobFailure(new HttpError('x', 400)), 'upstream');
  assertEquals(classifyJobFailure(new HttpError('x', 0)), 'upstream');

  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assertEquals(classifyJobFailure(abort), 'timeout');

  assertEquals(classifyJobFailure(new NotGitRepositoryError('not a repo')), 'gitNetwork');
  assertEquals(classifyJobFailure(new Error('anything')), 'internalError');
  assertEquals(classifyJobFailure('a bare string'), 'internalError');
});

Deno.test('buildSafeJobEvidence produces a typed record for success, skip, cancel, and failure', () => {
  const success = buildSafeJobEvidence(GLOBAL_JOB, { status: 'success', output: 'Pruned 3 rows' });
  assertEquals(success.schemaVersion, JOB_EVIDENCE_SCHEMA_VERSION);
  assertEquals(success.failure, null);
  assertEquals(success.recovery, null);
  assertEquals(success.output, 'Pruned 3 rows');

  const skipped = buildSafeJobEvidence(GLOBAL_JOB, { status: 'skipped', decision: 'Nothing to prune' });
  assertEquals(skipped.decision, 'Nothing to prune');
  assertEquals(skipped.failure, null);

  const cancelled = buildSafeJobEvidence(GLOBAL_JOB, { status: 'cancelled', decision: 'Backups disabled' });
  assertEquals(cancelled.decision, 'Backups disabled');

  const failure = buildSafeJobEvidence(GLOBAL_JOB, { status: 'failure', failureCode: 'filesystem' });
  assertEquals(failure.failure?.code, 'filesystem');
  assertEquals(failure.failure?.message, FAILURE_COPY.filesystem.message);
  assertEquals(failure.recovery, FAILURE_COPY.filesystem.recovery);
});

Deno.test('buildSafeJobEvidence honors a static recovery override', () => {
  const evidence = buildSafeJobEvidence(GLOBAL_JOB, {
    status: 'failure',
    failureCode: 'precondition',
    recovery: 'Enable Dry Run first.',
  });
  assertEquals(evidence.recovery, 'Enable Dry Run first.');
  assertEquals(evidence.failure?.message, FAILURE_COPY.precondition.message);
});

Deno.test('buildSafeJobEvidence bounds every interpolated string field', () => {
  const long = 'x'.repeat(5000);
  const evidence = buildSafeJobEvidence(GLOBAL_JOB, {
    status: 'failure',
    failureCode: 'internalError',
    target: long,
    decision: long,
    output: long,
    recovery: long,
  });
  assert((evidence.target?.length ?? 0) <= JOB_EVIDENCE_BOUNDS.target);
  assert((evidence.decision?.length ?? 0) <= JOB_EVIDENCE_BOUNDS.decision);
  assert((evidence.output?.length ?? 0) <= JOB_EVIDENCE_BOUNDS.output);
  assert((evidence.recovery?.length ?? 0) <= JOB_EVIDENCE_BOUNDS.recovery);
});

Deno.test('durable evidence never carries raw exception or secret-shaped content', () => {
  // The dispatcher's catch path: an exception whose message is stuffed with secrets is
  // classified by TYPE only, so nothing from the message reaches the persisted record.
  const cases: JobHandlerResult[] = [
    { status: 'failure', failureCode: classifyJobFailure(new Error(`boom ${SECRETS.skToken} ${SECRETS.hex32}`)) },
    { status: 'failure', failureCode: classifyJobFailure(new HttpError(SECRETS.gitPat, 500)) },
    { status: 'failure', failureCode: classifyJobFailure(new NotGitRepositoryError(SECRETS.keyUrl)) },
    { status: 'failure', failureCode: 'credential' },
    { status: 'failure', failureCode: 'gitNetwork' },
  ];

  for (const result of cases) {
    const serialized = JSON.stringify(buildSafeJobEvidence(GLOBAL_JOB, result));
    for (const secret of Object.values(SECRETS)) {
      assert(!serialized.includes(secret), `secret leaked into evidence: ${secret}`);
    }
    // ...and the raw NotGitRepositoryError / HttpError message bodies are absent too.
    assert(!serialized.includes('boom'), 'raw exception message must not be persisted');
  }
});

Deno.test('boundString is code-point safe and appends an ellipsis only when truncating', () => {
  assertEquals(boundString('short', 20), 'short');
  assertEquals(boundString('', 5), '');
  const bounded = boundString('x'.repeat(100), 10);
  assert(bounded.length <= 10);
  assert(bounded.endsWith('…'));
  // A surrogate-pair emoji must never be split into a lone code unit.
  const emojiBounded = boundString('😀'.repeat(50), 11);
  assert(!emojiBounded.includes('�'), 'must not split a surrogate pair');
});

Deno.test('parseSafeJobEvidence is tolerant on the read path', () => {
  assertEquals(parseSafeJobEvidence(null), null, 'legacy NULL column');
  assertEquals(parseSafeJobEvidence(''), null, 'empty column');
  assertEquals(parseSafeJobEvidence('{not json'), null, 'malformed JSON');
  assertEquals(parseSafeJobEvidence(JSON.stringify({ schemaVersion: 999 })), null, 'wrong schema version');
  assertEquals(parseSafeJobEvidence(JSON.stringify({ target: 'x' })), null, 'missing schemaVersion');

  const valid: SafeJobEvidence = {
    schemaVersion: JOB_EVIDENCE_SCHEMA_VERSION,
    target: 'Radarr Main',
    decision: null,
    output: 'Pulled 2 update(s)',
    failure: null,
    recovery: null,
  };
  assertEquals(parseSafeJobEvidence(JSON.stringify(valid)), valid, 'valid blob round-trips');
});

Deno.test('isSafeJobEvidence tolerates an unknown failure code written by a newer server', () => {
  const forwardCompat = {
    schemaVersion: JOB_EVIDENCE_SCHEMA_VERSION,
    target: null,
    decision: null,
    output: null,
    failure: { code: 'someFutureCode', message: 'A future failure occurred.' },
    recovery: 'Update Praxrr.',
  };
  assert(isSafeJobEvidence(forwardCompat), 'must accept an unknown code string on read');
});
