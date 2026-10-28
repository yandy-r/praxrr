// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import { actions } from '../../routes/settings/general/+page.server.ts';

type ActionEvent = Parameters<NonNullable<(typeof actions)['updateBackups']>>[0];
type ActionFailure = { status: number; data?: { error?: string } };

/** Real scratch SQLite DB per test with the full migration chain (seeds singleton rows). */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/backup-schedule-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      // Stub the dispatcher wake so scheduling a due-now job never fires a run under test.
      const originalNotify = jobDispatcher.notifyJobEnqueued;
      jobDispatcher.notifyJobEnqueued = () => {};

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.notifyJobEnqueued = originalNotify;
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function formEvent(form: (fd: FormData) => void): ActionEvent {
  const fd = new FormData();
  form(fd);
  return {
    request: new Request('http://localhost/settings/general', { method: 'POST', body: fd }),
  } as unknown as ActionEvent;
}

function run(name: keyof typeof actions, event: ActionEvent) {
  const action = actions[name];
  assert(action, `action ${String(name)} must exist`);
  return action(event);
}

migratedTest('updateBackups rejects legacy and malformed schedules without persisting', async () => {
  const before = backupSettingsQueries.get()?.schedule;
  assert(before);

  for (const schedule of [
    '*/6 hours',
    '*/12 hours',
    'garbage schedule',
    '0 0 * * 0',
    '2020-01-01T00:00:00',
    '0 0 31 2 *',
    '* * * * * *',
  ]) {
    const result = (await run(
      'updateBackups',
      formEvent((fd) => {
        fd.set('schedule', schedule);
        fd.set('retention_days', '30');
        fd.set('enabled', 'on');
        fd.set('compression_enabled', 'on');
      })
    )) as ActionFailure;

    assertEquals(result.status, 400, `${schedule} must be rejected with 400`);
    assert(result.data?.error, `${schedule} rejection must carry an error message`);
  }

  assertEquals(backupSettingsQueries.get()?.schedule, before, 'a rejected save must not touch the stored schedule');
});

migratedTest('updateBackups accepts the 6h/12h cron values and keywords', async () => {
  for (const schedule of ['0 */6 * * *', '0 */12 * * *', 'daily', 'weekly', 'monthly', 'hourly']) {
    const result = await run(
      'updateBackups',
      formEvent((fd) => {
        fd.set('schedule', schedule);
        fd.set('retention_days', '30');
        fd.set('enabled', 'on');
        fd.set('compression_enabled', 'on');
      })
    );

    assertEquals(result, { success: true }, `${schedule} should save`);
    assertEquals(backupSettingsQueries.get()?.schedule, schedule);
  }
});
