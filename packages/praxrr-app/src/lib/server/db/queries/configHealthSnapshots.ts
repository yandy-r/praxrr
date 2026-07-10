import type { CriterionResult, HealthArrType, HealthBand, HealthReport } from '$shared/health/index.ts';
import { db } from '../db.ts';

/**
 * Row shape for config_health_snapshots (byte-aligned to the migration columns).
 */
export interface ConfigHealthSnapshotRow {
  id: number;
  arr_instance_id: number | null;
  instance_name: string;
  arr_type: string;
  engine_version: string;
  overall_score: number;
  band: string;
  criteria_scores: string;
  profile_scores: string;
  generated_at: string;
  created_at: string;
}

/** A light per-profile score carried in a snapshot (the full breakdown is recomputed live). */
export interface SnapshotProfileScore {
  name: string;
  score: number;
  band: HealthBand;
}

/**
 * Parsed, camelCased snapshot with the `criteria_scores` / `profile_scores` JSON blobs decoded.
 */
export interface ConfigHealthSnapshotDetail {
  id: number;
  arrInstanceId: number | null;
  instanceName: string;
  arrType: HealthArrType;
  engineVersion: string;
  overallScore: number;
  band: HealthBand;
  criteriaScores: CriterionResult[];
  profileScores: SnapshotProfileScore[];
  generatedAt: string;
  createdAt: string;
}

/** Snapshot detail used by historical analysis, including whether stored arrays were valid JSON. */
export interface ConfigHealthTrendSnapshotDetail extends ConfigHealthSnapshotDetail {
  criteriaScoresValid: boolean;
  profileScoresValid: boolean;
}

/** Inclusive canonical UTC bounds and the exact maximum rows the caller wants fetched. */
export interface ConfigHealthTrendSearchOptions {
  from?: string;
  to?: string;
  limit: number;
}

interface ConfigHealthDegradationSnapshotRow {
  id: number;
  arr_instance_id: number | null;
  instance_name: string;
  arr_type: string;
  engine_version: string;
  overall_score: number;
  band: string;
  criteria_scores: string;
  generated_at: string;
}

/** Persisted subset required by Config Health degradation assessment. */
export interface ConfigHealthDegradationSnapshotDetail {
  id: number;
  arrInstanceId: number | null;
  instanceName: string;
  arrType: HealthArrType;
  engineVersion: string;
  overallScore: number;
  band: HealthBand;
  criteriaScores: CriterionResult[];
  generatedAt: string;
}

function parseJsonArray<T>(raw: string): T[] {
  return parseJsonArrayEvidence<T>(raw).values;
}

function parseJsonArrayEvidence<T>(raw: string): { values: T[]; valid: boolean } {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { values: parsed as T[], valid: true } : { values: [], valid: false };
  } catch {
    return { values: [], valid: false };
  }
}

function rowToDetail(row: ConfigHealthSnapshotRow): ConfigHealthSnapshotDetail {
  return {
    id: row.id,
    arrInstanceId: row.arr_instance_id,
    instanceName: row.instance_name,
    arrType: row.arr_type as HealthArrType,
    engineVersion: row.engine_version,
    overallScore: row.overall_score,
    band: row.band as HealthBand,
    criteriaScores: parseJsonArray<CriterionResult>(row.criteria_scores),
    profileScores: parseJsonArray<SnapshotProfileScore>(row.profile_scores),
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

function rowToTrendDetail(row: ConfigHealthSnapshotRow): ConfigHealthTrendSnapshotDetail {
  const criteriaScores = parseJsonArrayEvidence<CriterionResult>(row.criteria_scores);
  const profileScores = parseJsonArrayEvidence<SnapshotProfileScore>(row.profile_scores);

  return {
    id: row.id,
    arrInstanceId: row.arr_instance_id,
    instanceName: row.instance_name,
    arrType: row.arr_type as HealthArrType,
    engineVersion: row.engine_version,
    overallScore: row.overall_score,
    band: row.band as HealthBand,
    criteriaScores: criteriaScores.values,
    profileScores: profileScores.values,
    criteriaScoresValid: criteriaScores.valid,
    profileScoresValid: profileScores.valid,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

function rowToDegradationDetail(row: ConfigHealthDegradationSnapshotRow): ConfigHealthDegradationSnapshotDetail {
  return {
    id: row.id,
    arrInstanceId: row.arr_instance_id,
    instanceName: row.instance_name,
    arrType: row.arr_type as HealthArrType,
    engineVersion: row.engine_version,
    overallScore: row.overall_score,
    band: row.band as HealthBand,
    criteriaScores: parseJsonArray<CriterionResult>(row.criteria_scores),
    generatedAt: row.generated_at,
  };
}

/**
 * All queries for config_health_snapshots (append-only trend history).
 */
export const configHealthSnapshotsQueries = {
  /**
   * Append one snapshot from a computed report. Returns the new row id.
   *
   * Deliberately a bare `db.execute` (no `db.transaction`): a single INSERT is statement-atomic,
   * and the snapshot sweep runs under `processBatches` where a nested bare `BEGIN` is not
   * re-entrancy-safe (see the drift persist rationale).
   */
  insert(report: HealthReport): number {
    const profileScores: SnapshotProfileScore[] = report.profiles.map((p) => ({
      name: p.name,
      score: p.score,
      band: p.band,
    }));
    db.execute(
      `INSERT INTO config_health_snapshots (
				arr_instance_id, instance_name, arr_type, engine_version,
				overall_score, band, criteria_scores, profile_scores, generated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      report.instanceId,
      report.instanceName,
      report.arrType,
      report.engineVersion,
      report.overall.score,
      report.overall.band,
      JSON.stringify(report.overall.criteria),
      JSON.stringify(profileScores),
      report.generatedAt
    );
    const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
    return row?.id ?? 0;
  },

  /**
   * Immediately preceding persisted snapshot for one instance, based on append order.
   *
   * The current snapshot id is part of the boundary so an overlapping later insert cannot change
   * which persisted row preceded the caller's snapshot.
   */
  getPrevious(instanceId: number, currentSnapshotId: number): ConfigHealthDegradationSnapshotDetail | undefined {
    const row = db.queryFirst<ConfigHealthDegradationSnapshotRow>(
      `SELECT id, arr_instance_id, instance_name, arr_type, engine_version,
					overall_score, band, criteria_scores, generated_at
			 FROM config_health_snapshots
			 WHERE arr_instance_id = ? AND id < ?
			 ORDER BY id DESC
			 LIMIT 1`,
      instanceId,
      currentSnapshotId
    );
    return row ? rowToDegradationDetail(row) : undefined;
  },

  /**
   * Trend series for one instance, oldest → newest for charting. Bounded to the last `days` when
   * provided (retention compares wrap `generated_at` in `datetime(...)` since it is ISO UTC).
   */
  getTrend(instanceId: number, days?: number): ConfigHealthSnapshotDetail[] {
    if (days !== undefined && days > 0) {
      const rows = db.query<ConfigHealthSnapshotRow>(
        `SELECT * FROM config_health_snapshots
				 WHERE arr_instance_id = ? AND datetime(generated_at) >= datetime('now', '-' || ? || ' days')
				 ORDER BY datetime(generated_at) ASC, id ASC`,
        instanceId,
        days
      );
      return rows.map(rowToDetail);
    }
    const rows = db.query<ConfigHealthSnapshotRow>(
      `SELECT * FROM config_health_snapshots WHERE arr_instance_id = ?
			 ORDER BY datetime(generated_at) ASC, id ASC`,
      instanceId
    );
    return rows.map(rowToDetail);
  },

  /**
   * Evidence-aware trend rows for one instance in canonical chronological order.
   *
   * Bounds are inclusive canonical ISO timestamps supplied by the shared filter parser. The SQL
   * variants are fixed and parameterized so optional bounds never require interpolating values or
   * wrapping the indexed `generated_at` column in a conversion function.
   */
  searchTrend(instanceId: number, options: ConfigHealthTrendSearchOptions): ConfigHealthTrendSnapshotDetail[] {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      throw new RangeError('Config Health trend limit must be a positive safe integer');
    }

    let rows: ConfigHealthSnapshotRow[];
    if (options.from !== undefined && options.to !== undefined) {
      rows = db.query<ConfigHealthSnapshotRow>(
        `SELECT * FROM config_health_snapshots
			 WHERE arr_instance_id = ? AND generated_at >= ? AND generated_at <= ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.from,
        options.to,
        options.limit
      );
    } else if (options.from !== undefined) {
      rows = db.query<ConfigHealthSnapshotRow>(
        `SELECT * FROM config_health_snapshots
			 WHERE arr_instance_id = ? AND generated_at >= ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.from,
        options.limit
      );
    } else if (options.to !== undefined) {
      rows = db.query<ConfigHealthSnapshotRow>(
        `SELECT * FROM config_health_snapshots
			 WHERE arr_instance_id = ? AND generated_at <= ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.to,
        options.limit
      );
    } else {
      rows = db.query<ConfigHealthSnapshotRow>(
        `SELECT * FROM config_health_snapshots
			 WHERE arr_instance_id = ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.limit
      );
    }

    return rows.map(rowToTrendDetail);
  },

  /** Delete snapshots older than `days`. Returns rows deleted. */
  pruneOlderThan(days: number): number {
    return db.execute(
      `DELETE FROM config_health_snapshots WHERE datetime(generated_at) < datetime('now', '-' || ? || ' days')`,
      days
    );
  },

  /**
   * Keep only the newest `max` snapshots overall; delete the rest. `max <= 0` disables the cap
   * (age-only retention) and is a no-op. Returns rows deleted.
   */
  pruneBeyondMaxEntries(max: number): number {
    if (max <= 0) {
      return 0;
    }
    return db.execute(
      `DELETE FROM config_health_snapshots
			 WHERE id NOT IN (SELECT id FROM config_health_snapshots ORDER BY datetime(generated_at) DESC, id DESC LIMIT ?)`,
      max
    );
  },
};
