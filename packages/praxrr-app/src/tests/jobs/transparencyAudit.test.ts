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

const SPECIALIZED_FOLLOW_UPS = {
  'arr.sync': [SYNC_ENTITY_OUTCOMES_URL, DURABLE_EVIDENCE_SAFETY_URL],
  'arr.sync.qualityProfiles': [SYNC_ENTITY_OUTCOMES_URL, DURABLE_EVIDENCE_SAFETY_URL],
  'arr.sync.delayProfiles': [SYNC_ENTITY_OUTCOMES_URL, DURABLE_EVIDENCE_SAFETY_URL],
  'arr.sync.mediaManagement': [SYNC_ENTITY_OUTCOMES_URL, DURABLE_EVIDENCE_SAFETY_URL],
  'arr.sync.metadataProfiles': [SYNC_ENTITY_OUTCOMES_URL, DURABLE_EVIDENCE_SAFETY_URL],
  'trashguide.sync': [TRASHGUIDE_RUN_CORRELATION_URL, DURABLE_EVIDENCE_SAFETY_URL],
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

Deno.test('queued ownership matches the audit and never misclassifies an unresolved job as pass', () => {
  for (const jobType of JOB_TYPES) {
    const entry: TransparencyAuditEntry = JOB_TRANSPARENCY_AUDIT[jobType];
    const specialized = SPECIALIZED_FOLLOW_UPS[jobType as keyof typeof SPECIALIZED_FOLLOW_UPS];
    const expected = specialized ?? [DURABLE_EVIDENCE_SAFETY_URL];

    assertEquals(entry.disposition, 'follow-up', `${jobType} has unresolved follow-up ownership`);
    if (entry.disposition !== 'follow-up') continue;

    assertEquals(entry.followUpUrls, expected, `${jobType} follow-up ownership must match the human audit`);
    assertEquals(entry.rationale.trim().length > 0, true, `${jobType} follow-up requires a rationale`);
  }
});
