import { assertEquals } from '@std/assert';
import { JOB_TRANSPARENCY_AUDIT, type TransparencyAuditEntry } from '$jobs/transparencyAudit.ts';
import { JOB_TYPES, type JobType } from '$jobs/queueTypes.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';

// Import registration side effects only. This does not initialize the dispatcher,
// scheduler, or database; it registers the production handlers in the in-memory registry.
import '$jobs/handlers/index.ts';

const sorted = (values: readonly string[]): string[] => [...values].sort();

const DURABLE_EVIDENCE_SAFETY_URL = 'https://github.com/yandy-r/praxrr/issues/237' as const;
const SYNC_ENTITY_OUTCOMES_URL = 'https://github.com/yandy-r/praxrr/issues/232' as const;
const TRASHGUIDE_RUN_CORRELATION_URL = 'https://github.com/yandy-r/praxrr/issues/238' as const;

// Issue #237 (durable safe evidence) is resolved, so it no longer appears as a follow-up. Only
// the genuinely-remaining gaps stay: per-entity sync outcomes (#232) and TRaSH run correlation (#238).
const REMAINING_FOLLOW_UPS = {
  'arr.sync': [SYNC_ENTITY_OUTCOMES_URL],
  'arr.sync.qualityProfiles': [SYNC_ENTITY_OUTCOMES_URL],
  'arr.sync.delayProfiles': [SYNC_ENTITY_OUTCOMES_URL],
  'arr.sync.mediaManagement': [SYNC_ENTITY_OUTCOMES_URL],
  'arr.sync.metadataProfiles': [SYNC_ENTITY_OUTCOMES_URL],
  'trashguide.sync': [TRASHGUIDE_RUN_CORRELATION_URL],
} as const satisfies Partial<Record<JobType, readonly string[]>>;

Deno.test('queued-workflow transparency audit is exhaustive and matches production registrations', () => {
  const declared = sorted(JOB_TYPES);
  const audited = sorted(Object.keys(JOB_TRANSPARENCY_AUDIT));
  const registered = sorted(jobQueueRegistry.getAll().map(({ jobType }) => jobType));

  assertEquals(new Set(JOB_TYPES).size, JOB_TYPES.length, 'JOB_TYPES must not contain duplicates');
  assertEquals(audited, declared, 'every declared JobType must have exactly one audit entry');
  assertEquals(registered, declared, 'every declared JobType must have exactly one production handler');
});

Deno.test('queued-workflow transparency entries carry usable evidence', () => {
  for (const [jobType, entry] of Object.entries(JOB_TRANSPARENCY_AUDIT)) {
    assertEquals(entry.inputs.length > 0, true, `${jobType} must identify inputs`);
    assertEquals(entry.decisions.length > 0, true, `${jobType} must identify decisions`);
    assertEquals(entry.outputs.length > 0, true, `${jobType} must identify outputs`);
    assertEquals(entry.failureReasons.length > 0, true, `${jobType} must identify failure reasons`);
  }
});

Deno.test('queued ownership resolves durable evidence (#237) and keeps only genuinely-remaining follow-ups', () => {
  for (const jobType of JOB_TYPES) {
    const entry: TransparencyAuditEntry = JOB_TRANSPARENCY_AUDIT[jobType];
    const remaining = REMAINING_FOLLOW_UPS[jobType as keyof typeof REMAINING_FOLLOW_UPS];

    if (remaining) {
      assertEquals(entry.disposition, 'follow-up', `${jobType} still owns a remaining follow-up`);
      if (entry.disposition !== 'follow-up') continue;

      assertEquals(entry.followUpUrls, remaining, `${jobType} follow-up ownership must match the human audit`);
      assertEquals(entry.rationale.trim().length > 0, true, `${jobType} follow-up requires a rationale`);
      assertEquals(
        entry.followUpUrls.some((url) => url === DURABLE_EVIDENCE_SAFETY_URL),
        false,
        `${jobType} must no longer own the resolved durable-evidence follow-up (#237)`
      );
    } else {
      assertEquals(entry.disposition, 'pass', `${jobType} durable-evidence gap is resolved and must be pass`);
      if (entry.disposition !== 'pass') continue;

      assertEquals(entry.followUpUrls, null, `${jobType} pass entry must not carry follow-up ownership`);
      assertEquals((entry.rationale ?? '').trim().length > 0, true, `${jobType} pass requires a rationale`);
    }
  }
});
