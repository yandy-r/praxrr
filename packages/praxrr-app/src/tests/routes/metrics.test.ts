// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { isPublicPath } from '$lib/server/utils/auth/middleware.ts';
import { collectMetrics, resetShieldCacheForTest } from '$lib/server/metrics/collect.ts';
import { createDnsTransportResolver, overrideDnsTransportResolverForTest } from '$lib/server/security/dnsTransport.ts';
import { GET } from '../../routes/api/v1/metrics/+server.ts';

type MetricsGetEvent = Parameters<typeof GET>[0];

/**
 * Mirrors securityPosture.test.ts: point the db singleton at a scratch SQLite file under a fresh
 * temp base path, run the full migration chain, invoke the handler, then tear down. The metrics
 * collector reads app tables only; the DNS resolver seam is overridden so a scrape can never do
 * real DNS work in tests.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/metrics-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        resetShieldCacheForTest();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function metricsEvent(): MetricsGetEvent {
  return {} as unknown as MetricsGetEvent;
}

async function getMetrics(): Promise<{
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  body: string;
}> {
  const response = await GET(metricsEvent());
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  };
}

/** Toggle the feature flag like mcp.test.ts does; always restore in finally. */
async function withMetricsEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const flag = config as unknown as { metricsEnabled: boolean };
  const original = flag.metricsEnabled;
  flag.metricsEnabled = true;
  try {
    return await fn();
  } finally {
    flag.metricsEnabled = original;
  }
}

const SECRET_URL = 'http://user:secret@10.0.0.9:7878';
// Plain api_key values are rejected by a DB trigger (keys live encrypted in
// arr_instance_credentials, which metrics never reads); the fingerprint stands in as the
// sensitive per-instance value that must not leak.
const SECRET_API_KEY = 'super-secret-api-key-fingerprint';
// Instance names flow into label values; quotes and backslashes must be escaped.
const TRICKY_NAME = 'Radarr "main"\\LAN';

function seedInstance(): number {
  db.execute(
    `INSERT INTO arr_instances (name, type, url, external_url, api_key, api_key_fingerprint, tags, enabled, source)
     VALUES (?, 'radarr', ?, NULL, '', ?, NULL, 1, 'ui')`,
    TRICKY_NAME,
    SECRET_URL,
    SECRET_API_KEY
  );
  const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
  return row?.id ?? 0;
}

function seedHistory(instanceId: number): void {
  const insertJobRun = (jobType: string, status: string, durationMs: number) =>
    db.execute(
      `INSERT INTO job_run_history (queue_id, job_type, status, started_at, finished_at, duration_ms)
       VALUES (NULL, ?, ?, '2026-10-08T10:00:00Z', '2026-10-08T10:00:01Z', ?)`,
      jobType,
      status,
      durationMs
    );
  insertJobRun('backup', 'success', 1500);
  insertJobRun('backup', 'failure', 500);
  insertJobRun('cleanup', 'success', 100);

  const insertSyncRun = (status: string, durationMs: number) =>
    db.execute(
      `INSERT INTO sync_history (
				 arr_instance_id, instance_name, arr_type, job_id, trigger, trigger_event,
				 sections_attempted, status, sections_run, items_synced, failure_count,
				 entity_change_count, entity_outcome_count, section_results, changes, entity_outcomes,
				 preview_id, error, started_at, finished_at, duration_ms
			 ) VALUES (?, ?, 'radarr', NULL, 'manual', NULL, '[]', ?, 1, 0, 0, 0, 0, '[]', '[]', '[]', NULL, NULL,
				 '2026-10-08T10:00:00Z', '2026-10-08T10:00:02Z', ?)`,
      instanceId,
      TRICKY_NAME,
      status,
      durationMs
    );
  insertSyncRun('success', 2000);
  insertSyncRun('success', 3000);
  insertSyncRun('failed', 1000);

  db.execute(
    `INSERT INTO drift_instance_status (
			 arr_instance_id, arr_type, status, reason, drifted_count, missing_count, unmanaged_count,
			 drift_signature, notified_signature, detected_version, changes, checked_at, content_checked_at, duration_ms
		 ) VALUES (?, 'radarr', 'drifted', NULL, 3, 2, 1, NULL, NULL, NULL, '[]', '2026-10-08T10:00:00Z', NULL, 500)`,
    instanceId
  );

  const insertSnapshot = (score: number, band: string, generatedAt: string) =>
    db.execute(
      `INSERT INTO config_health_snapshots (
				 arr_instance_id, instance_name, arr_type, engine_version, overall_score, band,
				 criteria_scores, profile_scores, generated_at
			 ) VALUES (?, ?, 'radarr', '1', ?, ?, '[]', '[]', ?)`,
      instanceId,
      TRICKY_NAME,
      score,
      band,
      generatedAt
    );
  insertSnapshot(40, 'attention', '2026-10-07T10:00:00Z');
  insertSnapshot(95, 'healthy', '2026-10-08T10:00:00Z');

  // notification_history.service_id has an FK to notification_services.
  for (const id of ['discord', 'email']) {
    db.execute(
      `INSERT INTO notification_services (id, name, service_type, enabled, config, enabled_types)
       VALUES (?, ?, ?, 1, '{}', '[]')`,
      id,
      id,
      id
    );
  }
  const insertNotification = (serviceId: string, status: string) =>
    db.execute(
      `INSERT INTO notification_history (service_id, notification_type, title, message, metadata, status, error, sent_at)
       VALUES (?, 'job.backup.success', 't', 'm', NULL, ?, NULL, '2026-10-08T10:00:00Z')`,
      serviceId,
      status
    );
  insertNotification('discord', 'success');
  insertNotification('discord', 'success');
  insertNotification('email', 'failed');
}

migratedTest('GET /api/v1/metrics returns 404 while METRICS_ENABLED is off', async () => {
  const { status } = await getMetrics();
  assertEquals(status, 404);
});

migratedTest('GET /api/v1/metrics is not a public path (auth-gated)', () => {
  assert(!isPublicPath('/api/v1/metrics'), 'metrics must stay behind the central auth hook');
});

migratedTest('GET /api/v1/metrics renders Prometheus exposition without leaking secrets', async () => {
  const dnsCalls: string[] = [];
  const stubResolver = createDnsTransportResolver({
    resolveDns: (hostname) => {
      dnsCalls.push(hostname);
      return Promise.resolve([]);
    },
  });
  const restoreResolver = overrideDnsTransportResolverForTest(stubResolver);

  try {
    const instanceId = seedInstance();
    seedHistory(instanceId);
    const result = await withMetricsEnabled(getMetrics);

    assertEquals(result.status, 200);
    assertEquals(result.contentType, 'text/plain; version=0.0.4; charset=utf-8');
    assertEquals(result.cacheControl, 'no-store');

    const lines = result.body.split('\n').filter((line) => line !== '');

    // Expected sample lines (escaped instance name: `\` -> `\\`, `"` -> `\"`).
    const escapedName = 'Radarr \\"main\\"\\\\LAN';
    for (const expected of [
      `praxrr_sync_runs_total{instance_id="${instanceId}",instance_name="${escapedName}",arr_type="radarr",status="success"} 2`,
      `praxrr_sync_runs_total{instance_id="${instanceId}",instance_name="${escapedName}",arr_type="radarr",status="failed"} 1`,
      `praxrr_job_runs_total{job_type="backup",status="success"} 1`,
      `praxrr_job_runs_total{job_type="backup",status="failure"} 1`,
      `praxrr_job_run_duration_seconds_count{job_type="backup"} 2`,
      `praxrr_drift_instance_status{instance_id="${instanceId}",arr_type="radarr",status="drifted"} 1`,
      `praxrr_drift_items{instance_id="${instanceId}",arr_type="radarr",kind="drifted"} 3`,
      `praxrr_drift_items{instance_id="${instanceId}",arr_type="radarr",kind="missing"} 2`,
      `praxrr_drift_items{instance_id="${instanceId}",arr_type="radarr",kind="unmanaged"} 1`,
      `praxrr_config_health_score{instance_id="${instanceId}",instance_name="${escapedName}",arr_type="radarr"} 95`,
      `praxrr_config_health_band{instance_id="${instanceId}",instance_name="${escapedName}",arr_type="radarr",band="healthy"} 1`,
      'praxrr_notifications_total{service_id="discord",status="success"} 2',
      'praxrr_notifications_total{service_id="email",status="failed"} 1',
      'praxrr_parser_up 0',
      'praxrr_metrics_collector_up{collector="sync_runs"} 1',
      'praxrr_metrics_collector_up{collector="job_runs"} 1',
      'praxrr_metrics_collector_up{collector="drift"} 1',
      'praxrr_metrics_collector_up{collector="config_health"} 1',
      'praxrr_metrics_collector_up{collector="notifications"} 1',
    ]) {
      assert(lines.includes(expected), `missing sample line: ${expected}`);
    }
    assert(lines.some((line) => /^praxrr_build_info\{version="[^"]+"\} 1$/.test(line)));
    assert(lines.some((line) => /^praxrr_security_posture_score \d+$/.test(line)));
    assert(
      lines.some((line) => /^praxrr_job_run_duration_seconds_bucket\{job_type="backup",le="\+Inf"\} 2$/.test(line))
    );

    // Histogram buckets are cumulative and le-labeled.
    const bucketValues = lines
      .filter((line) => line.startsWith('praxrr_job_run_duration_seconds_bucket{job_type="backup"'))
      .map((line) => Number(line.split(' ').at(-1)));
    assertEquals(bucketValues.length, 9);
    assert(bucketValues.every((value, index) => index === 0 || value >= bucketValues[index - 1]));

    // Every non-comment line is a well-formed sample line: name{labels} value.
    const sampleLine = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{.*\})? -?\d+(\.\d+)?([eE][+-]?\d+)?$/;
    for (const line of lines) {
      if (line.startsWith('#')) {
        assert(/^# (HELP|TYPE) /.test(line), `malformed comment line: ${line}`);
      } else {
        assert(sampleLine.test(line), `malformed sample line: ${line}`);
      }
    }

    // Secrets never cross the response boundary: url, credentials, and api_key value stay out.
    for (const forbidden of [SECRET_URL, SECRET_API_KEY, 'user:secret@', '10.0.0.9', 'secret@', 'api_key']) {
      assert(!result.body.includes(forbidden), `response leaked ${forbidden}`);
    }

    // No DNS lookups happened on the scrape path.
    assertEquals(dnsCalls.length, 0);
  } finally {
    restoreResolver();
  }
});

migratedTest('config health emits one series per deleted instance (no duplicate series)', async () => {
  const restoreResolver = overrideDnsTransportResolverForTest(
    createDnsTransportResolver({ resolveDns: () => Promise.resolve([]) })
  );
  try {
    const instanceId = seedInstance();
    for (const [score, band, at] of [
      [40, 'attention', '2026-10-07T10:00:00Z'],
      [95, 'healthy', '2026-10-08T10:00:00Z'],
    ] as const) {
      db.execute(
        `INSERT INTO config_health_snapshots (
           arr_instance_id, instance_name, arr_type, engine_version, overall_score, band,
           criteria_scores, profile_scores, generated_at
         ) VALUES (?, 'gone', 'radarr', '1', ?, ?, '[]', '[]', ?)`,
        instanceId,
        score,
        band,
        at
      );
    }
    // ON DELETE SET NULL leaves every snapshot of a deleted instance with a NULL id.
    db.execute('UPDATE config_health_snapshots SET arr_instance_id = NULL');
    const body = await withMetricsEnabled(() => collectMetrics());
    const scoreLines = body.split('\n').filter((l) => l.startsWith('praxrr_config_health_score{'));
    assertEquals(scoreLines, ['praxrr_config_health_score{instance_id="",instance_name="gone",arr_type="radarr"} 95']);
  } finally {
    restoreResolver();
  }
});

migratedTest('collectMetrics never throws when collectors fail', async () => {
  // Shield collector exercises the resolver seam; keep it stubbed, then collect without any
  // seeded state — empty tables must render header-only families, not errors.
  const restoreResolver = overrideDnsTransportResolverForTest(
    createDnsTransportResolver({ resolveDns: () => Promise.resolve([]) })
  );
  try {
    const body = await withMetricsEnabled(() => collectMetrics());
    assert(body.includes('praxrr_metrics_collector_up{collector="build"} 1'));
    assert(body.endsWith('\n'));
  } finally {
    restoreResolver();
  }
});
