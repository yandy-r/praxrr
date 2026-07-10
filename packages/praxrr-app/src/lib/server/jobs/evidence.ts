/**
 * Safe durable job evidence — server-side classification, copy, and builder (issue #237).
 *
 * Mirrors the Sync Preview typed-closed-reason precedent (`$sync/preview/failureReason.ts`):
 * a total `FAILURE_COPY` map of pre-authored safe copy, a `classifyJobFailure` that is
 * anchored on error TYPE/status only, and a builder that produces the durable
 * {@link SafeJobEvidence} at the dispatcher boundary. Raw exception text is never read into
 * the evidence — callers log it through the sanitized logger instead.
 */

import { HttpError } from '$http/types.ts';
import { NotGitRepositoryError } from '$utils/git/errors.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import {
  boundString,
  JOB_EVIDENCE_BOUNDS,
  JOB_EVIDENCE_SCHEMA_VERSION,
  type JobFailureCode,
  type SafeJobEvidence,
} from '$shared/jobs/evidence.ts';
import type { AnyJobPayload, JobHandlerResult, JobPayloadByType, JobQueueRecord, JobType } from './queueTypes.ts';

/**
 * Pre-authored, SAFE copy for every closed job-failure code. Handlers never author
 * `message` — it is looked up here by code. `recovery` may be overridden by a handler only
 * with an equally static, pre-authored string. No entry embeds raw exception, response-body,
 * credential, or hostname text; full diagnostics stay in the logger.
 */
export const FAILURE_COPY: Record<JobFailureCode, { readonly message: string; readonly recovery: string }> = {
  invalidPayload: {
    message: 'The job could not run because its request data was malformed.',
    recovery: 'Re-trigger the job from its settings page; if it was scheduled, review the schedule configuration.',
  },
  targetNotFound: {
    message: 'The instance, database, or source this job targets no longer exists.',
    recovery: 'Confirm the target still exists in settings, then re-run the job. Stale schedules can be removed.',
  },
  unsupported: {
    message: 'This job is not supported for the selected target type.',
    recovery: 'Check that the target supports this operation, then re-run against a compatible instance.',
  },
  precondition: {
    message: 'A required condition for this job was not met, so it did not run.',
    recovery: 'Resolve the prerequisite shown on the target’s settings page, then run the job again.',
  },
  credential: {
    message: 'The target rejected Praxrr’s credentials.',
    recovery: 'Update the API key or connection credentials for this target in its settings, then re-run the job.',
  },
  upstream: {
    message: 'The upstream service returned an error or could not be reached.',
    recovery: 'Confirm the target is online and reachable from Praxrr, then re-run the job once it recovers.',
  },
  timeout: {
    message: 'The job was cancelled because the target did not respond in time.',
    recovery: 'Check the target’s load and network latency, then re-run the job.',
  },
  gitNetwork: {
    message: 'A Git operation failed while contacting or reading the source repository.',
    recovery: 'Verify the repository URL and network access, then re-run the sync.',
  },
  filesystem: {
    message: 'The job could not read or write a required file or directory.',
    recovery: 'Check the data directory’s free space and permissions, then re-run the job.',
  },
  database: {
    message: 'A database operation failed while the job was running.',
    recovery: 'Retry the job; if it keeps failing, check server logs and available disk space.',
  },
  validation: {
    message: 'The job produced results that failed validation and were not applied.',
    recovery: 'Review the target configuration for conflicts, then re-run the job.',
  },
  handlerNotFound: {
    message: 'No handler is registered for this job type, so it could not run.',
    recovery: 'This is likely a version mismatch — update Praxrr, then remove or re-create the schedule.',
  },
  internalError: {
    message: 'The job failed with an unexpected error.',
    recovery: 'Re-run the job; if the problem persists, check the server logs for details.',
  },
};

/** Map an `HttpError`'s numeric status to a closed job-failure code (never substring-based). */
function classifyHttpStatus(status: number): JobFailureCode {
  if (status === 408) return 'timeout';
  if (status === 401 || status === 403) return 'credential';
  if (status === 404) return 'targetNotFound';
  // 0 (unreachable), 5xx (server error), and other 4xx all collapse to the transport code.
  return 'upstream';
}

/**
 * Classify an unknown thrown error into a closed, SAFE {@link JobFailureCode}.
 *
 * Anchored on error TYPE / numeric status ONLY — message text is never inspected, so no raw
 * exception or secret-shaped string can influence the code. This is the catch-all for
 * thrown, untyped-at-the-callsite errors; handlers set the more specific codes
 * (`invalidPayload`, `targetNotFound`, `precondition`, `unsupported`, `validation`,
 * `filesystem`, `database`) explicitly when they detect the condition.
 */
export function classifyJobFailure(error: unknown): JobFailureCode {
  if (error instanceof HttpError) return classifyHttpStatus(error.status);
  if (error instanceof NotGitRepositoryError) return 'gitNetwork';
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'timeout';
  return 'internalError';
}

/**
 * One descriptor per job type; `resolveTarget` is typed against that type's exact payload
 * (`JobPayloadByType[K]`). The mapped type is the compile-time exhaustiveness gate: adding a
 * `JobType` without a descriptor fails to build. Global sweep/cleanup jobs have no single
 * subject and return `null`.
 */
type JobEvidenceDescriptors = {
  readonly [K in JobType]: {
    readonly resolveTarget: (payload: JobPayloadByType[K]) => string | null;
  };
};

const resolveArrInstance = (payload: { instanceId: number }): string | null =>
  arrInstancesQueries.getById(payload.instanceId)?.name ?? null;

export const JOB_EVIDENCE_DESCRIPTORS: JobEvidenceDescriptors = {
  'arr.upgrade': { resolveTarget: resolveArrInstance },
  'arr.rename': { resolveTarget: resolveArrInstance },
  'arr.sync': { resolveTarget: resolveArrInstance },
  'arr.sync.qualityProfiles': { resolveTarget: resolveArrInstance },
  'arr.sync.delayProfiles': { resolveTarget: resolveArrInstance },
  'arr.sync.mediaManagement': { resolveTarget: resolveArrInstance },
  'arr.sync.metadataProfiles': { resolveTarget: resolveArrInstance },
  'arr.pull.startup': { resolveTarget: () => null },
  'pcd.sync': {
    resolveTarget: (payload) => databaseInstancesQueries.getById(payload.databaseId)?.name ?? null,
  },
  'trashguide.sync': {
    resolveTarget: (payload) => trashGuideSourcesQueries.getById(payload.sourceId)?.name ?? null,
  },
  'backup.create': { resolveTarget: () => null },
  'backup.cleanup': { resolveTarget: () => null },
  'logs.cleanup': { resolveTarget: () => null },
  'drift.check': { resolveTarget: () => null },
  'sync.history.cleanup': { resolveTarget: () => null },
  'sync.canary.rollout': {
    resolveTarget: (payload) => canaryRolloutQueries.getById(payload.rolloutId)?.canaryInstanceName ?? null,
  },
  'config-health.snapshot': { resolveTarget: () => null },
  'config-health.cleanup': { resolveTarget: () => null },
};

function resolveTargetForJob(job: JobQueueRecord): string | null {
  // job.jobType is unvalidated runtime data (job_queue.job_type is a bare TEXT column), so a
  // legacy/orphan type has no descriptor. This is exactly the handler-not-found case — degrade the
  // target to null instead of dereferencing an undefined descriptor and crashing evidence capture.
  const descriptor = JOB_EVIDENCE_DESCRIPTORS[job.jobType];
  if (!descriptor) return null;
  // Dispatch is runtime-dynamic (payload is the widened union), so the per-key resolver is
  // called through a widened signature. Type safety lives at the descriptor DEFINITION above.
  const resolve = descriptor.resolveTarget as (payload: AnyJobPayload) => string | null;
  try {
    return resolve(job.payload);
  } catch {
    // A target lookup must never break evidence capture for the run itself.
    return null;
  }
}

/**
 * Build the durable {@link SafeJobEvidence} from a handler result at the dispatcher boundary.
 *
 * Fail-fast on the WRITE path: constructs a known-good shape from typed inputs. `target`
 * comes from the handler's own value or the per-JobType descriptor; all interpolated strings
 * are bounded; on failure the `message`/`recovery` are the pre-authored copy for the typed
 * code (never handler free text). No raw exception/sub-result text can enter this record.
 */
export function buildSafeJobEvidence(job: JobQueueRecord, result: JobHandlerResult): SafeJobEvidence {
  const rawTarget = result.target ?? resolveTargetForJob(job);
  const target = rawTarget != null ? boundString(rawTarget, JOB_EVIDENCE_BOUNDS.target) : null;
  const decision = result.decision != null ? boundString(result.decision, JOB_EVIDENCE_BOUNDS.decision) : null;
  const output = result.output != null ? boundString(result.output, JOB_EVIDENCE_BOUNDS.output) : null;

  if (result.status === 'failure') {
    const copy = FAILURE_COPY[result.failureCode] ?? FAILURE_COPY.internalError;
    return {
      schemaVersion: JOB_EVIDENCE_SCHEMA_VERSION,
      target,
      decision,
      output,
      failure: { code: result.failureCode, message: copy.message },
      recovery: boundString(result.recovery ?? copy.recovery, JOB_EVIDENCE_BOUNDS.recovery),
    };
  }

  return {
    schemaVersion: JOB_EVIDENCE_SCHEMA_VERSION,
    target,
    decision,
    output,
    failure: null,
    recovery: null,
  };
}
