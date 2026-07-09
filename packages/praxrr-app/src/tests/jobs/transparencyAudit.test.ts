import { assertEquals, assertMatch } from '@std/assert';
import { JOB_TRANSPARENCY_AUDIT, type TransparencyAuditEntry } from '$jobs/transparencyAudit.ts';
import { JOB_TYPES } from '$jobs/queueTypes.ts';
import { jobQueueRegistry } from '$jobs/queueRegistry.ts';

// Import registration side effects only. This does not initialize the dispatcher,
// scheduler, or database; it registers the production handlers in the in-memory registry.
import '$jobs/handlers/index.ts';

const sorted = (values: readonly string[]): string[] => [...values].sort();

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

Deno.test('follow-up and not-applicable dispositions enforce ownership invariants', () => {
  const entries: readonly TransparencyAuditEntry[] = Object.values(JOB_TRANSPARENCY_AUDIT);

  for (const entry of entries) {
    if (entry.disposition === 'follow-up') {
      assertMatch(entry.followUpUrl, /^https:\/\/github\.com\/yandy-r\/praxrr\/issues\/\d+$/);
      assertEquals(entry.rationale.trim().length > 0, true, 'follow-up entries require a rationale');
    } else if (entry.disposition === 'not-applicable') {
      assertEquals(entry.rationale.trim().length > 0, true, 'not-applicable entries require a rationale');
      assertEquals(entry.followUpUrl, null);
    } else {
      assertEquals(entry.followUpUrl, null);
    }
  }
});
