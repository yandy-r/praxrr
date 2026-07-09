/**
 * Exhaustive transparency inventory for queued automation workflows (issue #21).
 *
 * This is evidence metadata only. It does not participate in scheduling,
 * dispatch, execution, or result classification. The human audit adds direct
 * mutators that do not have a {@link JobType}.
 */

import type { JobType } from './queueTypes.ts';

interface TransparencyAuditEvidence {
  readonly inputs: readonly string[];
  readonly decisions: readonly string[];
  readonly outputs: readonly string[];
  readonly failureReasons: readonly string[];
  readonly userSurface: string | null;
}

export interface TransparencyPassEntry extends TransparencyAuditEvidence {
  readonly disposition: 'pass';
  readonly rationale: string | null;
  readonly followUpUrls: null;
}

export interface TransparencyNotApplicableEntry extends TransparencyAuditEvidence {
  readonly disposition: 'not-applicable';
  readonly rationale: string;
  readonly followUpUrls: null;
}

export type TransparencyFollowUpUrl = `https://github.com/yandy-r/praxrr/issues/${number}`;

/** A follow-up disposition always owns at least one concrete engineering issue. */
export type TransparencyFollowUpUrls = readonly [...TransparencyFollowUpUrl[], TransparencyFollowUpUrl];

export interface TransparencyFollowUpEntry extends TransparencyAuditEvidence {
  readonly disposition: 'follow-up';
  readonly rationale: string;
  readonly followUpUrls: TransparencyFollowUpUrls;
}

/**
 * The disposition union makes invalid ownership states unrepresentable:
 * follow-ups require a non-empty issue tuple, while pass/not-applicable entries
 * cannot carry follow-up ownership.
 */
export type TransparencyAuditEntry = TransparencyPassEntry | TransparencyNotApplicableEntry | TransparencyFollowUpEntry;

const DURABLE_EVIDENCE_SAFETY_URL = 'https://github.com/yandy-r/praxrr/issues/237' as const;
const SYNC_ENTITY_OUTCOMES_URL = 'https://github.com/yandy-r/praxrr/issues/232' as const;
const TRASHGUIDE_RUN_CORRELATION_URL = 'https://github.com/yandy-r/praxrr/issues/238' as const;

function queuedFollowUp(
  evidence: TransparencyAuditEvidence,
  specializedFollowUps: readonly TransparencyFollowUpUrl[] = []
): TransparencyFollowUpEntry {
  const followUpUrls: TransparencyFollowUpUrls = [...specializedFollowUps, DURABLE_EVIDENCE_SAFETY_URL];

  return {
    ...evidence,
    disposition: 'follow-up',
    rationale: 'The human audit assigns each unresolved gap to the linked engineering issue.',
    followUpUrls,
  };
}

const SYNC_FAILURES = [
  'Disabled, unsupported, missing-config, and already-claimed branches return explicit skip/cancel reasons.',
  'Section failures retain the section name and sanitized SyncResult error in job and Sync History evidence.',
] as const;

function syncEntry(section: string): TransparencyFollowUpEntry {
  return queuedFollowUp(
    {
      inputs: [
        `The queue payload identifies the Arr instance and ${section} scope.`,
        'Job source records whether the run was manual, scheduled, or system-triggered.',
      ],
      decisions: [
        'The handler records capability, enabled/configured state, scheduling, and atomic claim decisions.',
        `The explicit section registry resolves ${section}; no sibling-Arr fallback is used.`,
      ],
      outputs: [
        'Job history records terminal status, item counts, output, timing, and next scheduled run.',
        'Sync History provides durable run and per-section outcome evidence when enabled.',
      ],
      failureReasons: SYNC_FAILURES,
      userSurface: '/settings/jobs and /sync-history',
    },
    [SYNC_ENTITY_OUTCOMES_URL]
  );
}

/**
 * One entry per {@link JobType}. `satisfies Record` is the compile-time gate;
 * the focused test independently compares these keys with production handler
 * registrations.
 */
export const JOB_TRANSPARENCY_AUDIT = {
  'arr.upgrade': queuedFollowUp({
    inputs: ['The payload identifies the Arr instance; job source and upgrade settings expose schedule and filters.'],
    decisions: ['The handler records disabled, unsupported, cooldown, no-candidate, and selected-candidate branches.'],
    outputs: ['Upgrade run history and job history expose result counts, timing, output, and next run.'],
    failureReasons: ['Missing instance, processor failure, and unsupported Arr reasons are retained explicitly.'],
    userSurface: '/arr/{instanceId}/upgrades and /settings/jobs',
  }),
  'arr.rename': queuedFollowUp({
    inputs: ['The payload identifies the Arr instance; rename settings expose schedule, dry-run, and rename scope.'],
    decisions: ['The handler records disabled, unsupported, dry-run, and eligible-item decisions.'],
    outputs: ['Rename run history and job history expose counts, sample results, timing, output, and next run.'],
    failureReasons: [
      'Missing instance, unsupported Arr, disabled config, and processor failures have explicit reasons.',
    ],
    userSurface: '/arr/{instanceId}/rename and /settings/jobs',
  }),
  'arr.sync': syncEntry('selected sections'),
  'arr.sync.qualityProfiles': syncEntry('Quality Profiles'),
  'arr.sync.delayProfiles': syncEntry('Delay Profiles'),
  'arr.sync.mediaManagement': syncEntry('Media Management'),
  'arr.sync.metadataProfiles': syncEntry('Metadata Profiles'),
  'arr.pull.startup': queuedFollowUp({
    inputs: ['The system job records startup trigger time and evaluates every enabled Arr instance.'],
    decisions: ['Per-instance results distinguish imported, default-skipped, unmatched, conflicted, and failed items.'],
    outputs: ['Startup-pull run results retain per-instance and aggregate counters plus terminal status and timing.'],
    failureReasons: ['Disabled startup pull and per-instance failures are preserved as skipped/failure evidence.'],
    userSurface: '/settings/jobs and startup-pull run history',
  }),
  'pcd.sync': queuedFollowUp({
    inputs: ['The payload identifies the database; database settings expose enabled state and sync interval.'],
    decisions: ['The handler records disabled, auto-sync-disabled, not-due, no-change, and update branches.'],
    outputs: ['Job history exposes pull/update result, output, timing, and rescheduled run time.'],
    failureReasons: ['Invalid database, git/pull failure, and snapshot failure paths retain explicit reasons.'],
    userSurface: '/databases/{databaseId} and /settings/jobs',
  }),
  'trashguide.sync': queuedFollowUp(
    {
      inputs: [
        'The payload identifies source, manual/scheduled trigger, and request time; source settings expose schedule.',
      ],
      decisions: [
        'The handler records source existence, enabled/schedule state, due time, retry, and no-update decisions.',
      ],
      outputs: ['Job history exposes fetched/applied counts, status, output, timing, and retry/next-run time.'],
      failureReasons: ['Invalid payload, missing/disabled source, metadata, fetch, and apply failures retain reasons.'],
      userSurface: '/databases/trash/{sourceId} and /settings/jobs',
    },
    [TRASHGUIDE_RUN_CORRELATION_URL]
  ),
  'backup.create': queuedFollowUp({
    inputs: ['Backup settings and job source expose whether creation is scheduled, manual, or system-triggered.'],
    decisions: ['The handler records the backups-disabled branch before attempting creation.'],
    outputs: ['Job history exposes terminal status, backup output, timing, and next scheduled run.'],
    failureReasons: ['Disabled backup, service failure, and unexpected error paths return explicit reasons.'],
    userSurface: '/settings/backups and /settings/jobs',
  }),
  'backup.cleanup': queuedFollowUp({
    inputs: ['Backup retention settings and job source expose cleanup policy and trigger.'],
    decisions: ['The handler records disabled, no-files, retained, deleted, and delete-failure decisions.'],
    outputs: ['Job history exposes removed counts, retained counts, status, output, timing, and next run.'],
    failureReasons: ['Invalid backup directory and per-file or handler failures retain explicit reasons.'],
    userSurface: '/settings/backups and /settings/jobs',
  }),
  'logs.cleanup': queuedFollowUp({
    inputs: ['Logging retention settings and job source expose cleanup policy and trigger.'],
    decisions: ['The handler records file-logging-disabled, no-files, retained, and deleted branches.'],
    outputs: ['Job history exposes removed counts, terminal status, output, timing, and next run.'],
    failureReasons: ['Retention and filesystem failures return explicit failure reasons.'],
    userSurface: '/settings/logs and /settings/jobs',
  }),
  'drift.check': queuedFollowUp({
    inputs: ['Drift settings expose enabled state and interval; continuation payload records sweep cursor and start.'],
    decisions: [
      'The handler records disabled, chunk continuation, per-instance classification, and retry/backoff decisions.',
    ],
    outputs: ['Drift dashboard/detail and job history expose counts, status, reasons, timing, and next run.'],
    failureReasons: ['Closed drift reason codes and handler errors preserve user-facing recovery evidence.'],
    userSurface: '/drift and /settings/jobs',
  }),
  'sync.history.cleanup': queuedFollowUp({
    inputs: ['Sync History retention settings and job source expose age/count policy and trigger.'],
    decisions: ['The handler records history-disabled, no-rows, retained, and pruned branches.'],
    outputs: ['Job history exposes pruned counts, terminal status, output, timing, and next run.'],
    failureReasons: ['Cleanup query and handler failures return explicit reasons.'],
    userSurface: '/sync-history and /settings/jobs',
  }),
  'sync.canary.rollout': queuedFollowUp({
    inputs: [
      'The payload identifies a persisted rollout whose target type, canary, and remaining instances are inspectable.',
    ],
    decisions: [
      'The coordinator records canary classification, promotion, batching, stop, cancellation, and failure decisions.',
    ],
    outputs: [
      'Canary detail, linked Sync History rows, and job history expose per-target results and terminal status.',
    ],
    failureReasons: [
      'Missing/stale rollout, canary failure, target failure, and cancellation retain explicit reasons.',
    ],
    userSurface: '/canary/{rolloutId} and /settings/jobs',
  }),
  'config-health.snapshot': queuedFollowUp({
    inputs: ['Config Health settings expose enabled state and interval; continuation payload records sweep progress.'],
    decisions: ['The handler records disabled, empty, chunk continuation, scoring, and retry/backoff branches.'],
    outputs: [
      'Config Health surfaces and job history expose scores, criteria, suggestions, trend snapshots, and timing.',
    ],
    failureReasons: ['Per-instance scoring and handler failures retain criterion or sanitized handler reasons.'],
    userSurface: '/config-health and /settings/jobs',
  }),
  'config-health.cleanup': queuedFollowUp({
    inputs: ['Config Health retention settings and job source expose age/count policy and trigger.'],
    decisions: ['The handler records scoring-disabled, no-snapshots, retained, and pruned branches.'],
    outputs: ['Job history exposes pruned counts, terminal status, output, timing, and next run.'],
    failureReasons: ['Cleanup query and handler failures return explicit reasons.'],
    userSurface: '/config-health and /settings/jobs',
  }),
} as const satisfies Record<JobType, TransparencyAuditEntry>;
