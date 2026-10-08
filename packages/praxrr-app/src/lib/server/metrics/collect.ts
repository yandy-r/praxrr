/**
 * Prometheus metrics collection for GET /api/v1/metrics.
 *
 * Each collector is wrapped in try/catch so one failure never breaks the scrape;
 * per-collector health is exposed via `praxrr_metrics_collector_up{collector}`.
 * Reads from the app DB only — never from Arr instances (no url/api_key labels).
 */

import { db } from '$db/db.ts';
import { appInfoQueries } from '$db/queries/appInfo.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { getCache, getCachedDatabaseIds } from '$pcd/index.ts';
import { isParserHealthy } from '$lib/server/utils/arr/parser/index.ts';
import { computeShield } from '$lib/server/security/service.ts';
import { logger } from '$logger/logger.ts';
import { header, sample } from './format.ts';

const HISTOGRAM_BUCKETS = [0.1, 0.5, 1, 5, 15, 60, 300, 900] as const;

const PARSER_PROBE_TIMEOUT_MS = 2000;

const startTimeSeconds = Math.floor(Date.now() / 1000);

interface ShieldCache {
  value: { score: number; band: string } | null;
  at: number;
}

const shieldCache: ShieldCache = { value: null, at: 0 };
const SHIELD_CACHE_TTL_MS = 60_000;

// ponytail: in-process cache (60s) avoids DNS lookups per scrape; upgrade to a shared
// cache keyed by instance set when multiple workers serve /metrics concurrently.
async function cachedShield(): Promise<{ score: number; band: string }> {
  const now = Date.now();
  if (shieldCache.value !== null && now - shieldCache.at < SHIELD_CACHE_TTL_MS) {
    return shieldCache.value;
  }
  // Uses the process-wide resolver seam (overridable in tests); the resolver's own
  // in-process cache plus this 60s cache keep DNS lookups off the scrape path.
  const report = await computeShield(undefined);
  const value = { score: report.score, band: report.band };
  shieldCache.value = value;
  shieldCache.at = now;
  return value;
}

/** Test seam: reset the in-process shield cache. */
export function resetShieldCacheForTest(): void {
  shieldCache.value = null;
  shieldCache.at = 0;
}

async function collectBuild(lines: string[]): Promise<void> {
  const version = appInfoQueries.getVersion();
  lines.push(
    header('praxrr_build_info', 'Build version of the running Praxrr instance.', 'gauge'),
    sample('praxrr_build_info', { version }, 1),
    header('praxrr_process_start_time_seconds', 'Unix timestamp when this process started.', 'gauge'),
    sample('praxrr_process_start_time_seconds', {}, startTimeSeconds)
  );
}

async function collectJobRuns(lines: string[]): Promise<void> {
  const counts = db.query<{ job_type: string; status: string; count: number }>(
    'SELECT job_type, status, COUNT(*) AS count FROM job_run_history GROUP BY job_type, status'
  );
  lines.push(header('praxrr_job_runs_total', 'Total job runs by type and status.', 'counter'));
  for (const row of counts) {
    lines.push(sample('praxrr_job_runs_total', { job_type: row.job_type, status: row.status }, row.count));
  }

  // Cumulative bucket counts aggregated in SQL so history size never lands in memory.
  const bucketCols = HISTOGRAM_BUCKETS.map(
    (bound, i) => `SUM(CASE WHEN duration_ms <= ${bound * 1000} THEN 1 ELSE 0 END) AS b${i}`
  ).join(', ');
  const histogram = db.query<Record<string, number> & { job_type: string }>(
    `SELECT job_type, COUNT(*) AS count, COALESCE(SUM(duration_ms), 0) AS sum_ms, ${bucketCols}
		 FROM job_run_history GROUP BY job_type`
  );
  lines.push(header('praxrr_job_run_duration_seconds', 'Job run duration in seconds.', 'histogram'));
  for (const row of histogram) {
    const jobType = row.job_type;
    HISTOGRAM_BUCKETS.forEach((bound, i) => {
      lines.push(
        sample('praxrr_job_run_duration_seconds_bucket', { job_type: jobType, le: String(bound) }, row[`b${i}`])
      );
    });
    lines.push(sample('praxrr_job_run_duration_seconds_bucket', { job_type: jobType, le: '+Inf' }, row.count));
    lines.push(sample('praxrr_job_run_duration_seconds_sum', { job_type: jobType }, row.sum_ms / 1000));
    lines.push(sample('praxrr_job_run_duration_seconds_count', { job_type: jobType }, row.count));
  }
}

async function collectSyncRuns(lines: string[]): Promise<void> {
  const counts = db.query<{
    arr_instance_id: number | null;
    instance_name: string;
    arr_type: string;
    status: string;
    count: number;
  }>(
    'SELECT arr_instance_id, instance_name, arr_type, status, COUNT(*) AS count FROM sync_history GROUP BY arr_instance_id, instance_name, arr_type, status'
  );
  lines.push(header('praxrr_sync_runs_total', 'Total sync runs by instance and status.', 'counter'));
  for (const row of counts) {
    lines.push(
      sample(
        'praxrr_sync_runs_total',
        {
          instance_id: String(row.arr_instance_id ?? ''),
          instance_name: row.instance_name,
          arr_type: row.arr_type,
          status: row.status,
        },
        row.count
      )
    );
  }
}

async function collectDrift(lines: string[]): Promise<void> {
  const rows = driftStatusQueries.getAllForSummary();
  lines.push(
    header('praxrr_drift_instance_status', 'Current drift status per instance (1 marks the active status).', 'gauge')
  );
  for (const row of rows) {
    lines.push(
      sample(
        'praxrr_drift_instance_status',
        {
          instance_id: String(row.arrInstanceId),
          arr_type: row.arrType,
          status: row.status,
        },
        1
      )
    );
  }
  lines.push(header('praxrr_drift_items', 'Drifted/missing/unmanaged item counts per instance.', 'gauge'));
  for (const row of rows) {
    const base = { instance_id: String(row.arrInstanceId), arr_type: row.arrType };
    lines.push(sample('praxrr_drift_items', { ...base, kind: 'drifted' }, row.counts.drifted));
    lines.push(sample('praxrr_drift_items', { ...base, kind: 'missing' }, row.counts.missing));
    lines.push(sample('praxrr_drift_items', { ...base, kind: 'unmanaged' }, row.counts.unmanaged));
  }
}

async function collectConfigHealth(lines: string[]): Promise<void> {
  // Window partition treats NULL arr_instance_id (deleted instances) as one group, so each
  // partition yields exactly one latest row; duplicate series would fail the whole scrape.
  const rows = db.query<{
    arr_instance_id: number | null;
    instance_name: string;
    arr_type: string;
    overall_score: number;
    band: string;
  }>(`SELECT arr_instance_id, instance_name, arr_type, overall_score, band FROM (
		SELECT *, ROW_NUMBER() OVER (
			PARTITION BY arr_instance_id ORDER BY generated_at DESC, id DESC
		) AS rn FROM config_health_snapshots
	) WHERE rn = 1`);
  lines.push(header('praxrr_config_health_score', 'Latest config health score per instance.', 'gauge'));
  for (const row of rows) {
    lines.push(
      sample(
        'praxrr_config_health_score',
        {
          instance_id: String(row.arr_instance_id ?? ''),
          instance_name: row.instance_name,
          arr_type: row.arr_type,
        },
        row.overall_score
      )
    );
  }
  lines.push(
    header('praxrr_config_health_band', 'Latest config health band per instance (1 marks the active band).', 'gauge')
  );
  for (const row of rows) {
    lines.push(
      sample(
        'praxrr_config_health_band',
        {
          instance_id: String(row.arr_instance_id ?? ''),
          instance_name: row.instance_name,
          arr_type: row.arr_type,
          band: row.band,
        },
        1
      )
    );
  }
}

async function collectShield(lines: string[]): Promise<void> {
  const shield = await cachedShield();
  lines.push(header('praxrr_security_posture_score', 'Current security posture score (0-100).', 'gauge'));
  lines.push(sample('praxrr_security_posture_score', {}, shield.score));
  lines.push(
    header('praxrr_security_posture_band', 'Current security posture band (1 marks the active band).', 'gauge')
  );
  lines.push(sample('praxrr_security_posture_band', { band: shield.band }, 1));
}

async function collectParser(lines: string[]): Promise<void> {
  // Short cap: a hung parser must report 0 well inside Prometheus' default 10s scrape timeout.
  const up = await isParserHealthy(PARSER_PROBE_TIMEOUT_MS);
  lines.push(header('praxrr_parser_up', 'Whether the release title parser service is reachable.', 'gauge'));
  lines.push(sample('praxrr_parser_up', {}, up ? 1 : 0));
}

async function collectNotifications(lines: string[]): Promise<void> {
  const counts = db.query<{ service_id: string; status: string; count: number }>(
    'SELECT service_id, status, COUNT(*) AS count FROM notification_history GROUP BY service_id, status'
  );
  lines.push(header('praxrr_notifications_total', 'Total notification deliveries by service and status.', 'counter'));
  for (const row of counts) {
    lines.push(sample('praxrr_notifications_total', { service_id: row.service_id, status: row.status }, row.count));
  }
}

async function collectPcd(lines: string[]): Promise<void> {
  const ids = getCachedDatabaseIds();
  lines.push(header('praxrr_pcd_cache_built', 'Whether the PCD cache is built per database.', 'gauge'));
  for (const id of ids) {
    const cache = getCache(id);
    lines.push(sample('praxrr_pcd_cache_built', { database_id: String(id) }, cache?.isBuilt() ? 1 : 0));
  }
}

const COLLECTORS: ReadonlyArray<{ name: string; run: (lines: string[]) => Promise<void> }> = [
  { name: 'build', run: collectBuild },
  { name: 'job_runs', run: collectJobRuns },
  { name: 'sync_runs', run: collectSyncRuns },
  { name: 'drift', run: collectDrift },
  { name: 'config_health', run: collectConfigHealth },
  { name: 'security_posture', run: collectShield },
  { name: 'parser', run: collectParser },
  { name: 'notifications', run: collectNotifications },
  { name: 'pcd', run: collectPcd },
];

/** Collect the full Prometheus exposition text. Never throws: failures degrade to collector_up 0. */
export async function collectMetrics(): Promise<string> {
  const lines: string[] = [];
  const up: Record<string, number> = {};
  for (const collector of COLLECTORS) {
    try {
      await collector.run(lines);
      up[collector.name] = 1;
    } catch (error) {
      up[collector.name] = 0;
      await logger.warn('Metrics collector failed', {
        source: 'MetricsCollector',
        meta: { collector: collector.name, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  lines.push(header('praxrr_metrics_collector_up', 'Whether each metrics collector succeeded.', 'gauge'));
  for (const collector of COLLECTORS) {
    lines.push(sample('praxrr_metrics_collector_up', { collector: collector.name }, up[collector.name] ?? 0));
  }
  return `${lines.join('\n')}\n`;
}
