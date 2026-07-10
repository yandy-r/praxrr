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

/** Snapshot subset used by historical analysis; names/creation metadata never enter trend queries. */
export interface ConfigHealthTrendSnapshotDetail extends Omit<
  ConfigHealthSnapshotDetail,
  'instanceName' | 'createdAt'
> {
  criteriaScoresValid: boolean;
  profileScoresValid: boolean;
  criteriaScoresBytes: number;
  profileScoresBytes: number;
}

/** Resource ceilings applied before trend evidence is decoded or returned. */
export interface ConfigHealthTrendEvidenceBudget {
  maxBytesPerRow: number;
  maxTotalBytes: number;
  maxCriteriaPerRow: number;
  maxProfilesPerRow: number;
}

/**
 * A request may return many compact points, but one row cannot monopolize memory and the complete
 * exact selection cannot make the server parse more than 16 MiB of stored JSON. Nested caps are
 * deliberately above the current five-criterion engine and normal profile counts, leaving room for
 * compatible historical engines while rejecting corrupt or hostile stored evidence.
 */
export const CONFIG_HEALTH_TREND_EVIDENCE_BUDGET: ConfigHealthTrendEvidenceBudget = {
  maxBytesPerRow: 256 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxCriteriaPerRow: 64,
  maxProfilesPerRow: 1_000,
};

/** Storage-level budget failure translated by the health service into a typed HTTP 422. */
export class ConfigHealthTrendEvidenceLimitError extends Error {
  constructor() {
    super('Stored Config Health trend evidence exceeds the safe request budget');
    this.name = 'ConfigHealthTrendEvidenceLimitError';
  }
}

/** Inclusive canonical UTC bounds and the exact maximum rows the caller wants fetched. */
export interface ConfigHealthTrendSearchOptions {
  from?: string;
  to?: string;
  limit: number;
  evidenceBudget?: ConfigHealthTrendEvidenceBudget;
}

/** Exact maximum distinct historical profile names the caller wants returned. */
export interface ConfigHealthTrendProfileNameOptions {
  limit: number;
  evidenceBudget?: ConfigHealthTrendEvidenceBudget;
}

interface ConfigHealthTrendSnapshotRow {
  id: number;
  arr_instance_id: number | null;
  arr_type: string;
  engine_version: string;
  overall_score: number;
  band: string;
  criteria_scores: string;
  profile_scores: string;
  generated_at: string;
  criteria_scores_bytes: number;
  profile_scores_bytes: number;
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

function parseJsonArrayEvidence<T>(raw: string, maxItems = Number.POSITIVE_INFINITY): { values: T[]; valid: boolean } {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > maxItems) throw new ConfigHealthTrendEvidenceLimitError();
    return Array.isArray(parsed) ? { values: parsed as T[], valid: true } : { values: [], valid: false };
  } catch (error) {
    if (error instanceof ConfigHealthTrendEvidenceLimitError) throw error;
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

function rowToTrendDetail(
  row: ConfigHealthTrendSnapshotRow,
  budget: ConfigHealthTrendEvidenceBudget
): ConfigHealthTrendSnapshotDetail {
  const criteriaScores = parseJsonArrayEvidence<CriterionResult>(row.criteria_scores, budget.maxCriteriaPerRow);
  const profileScores = parseJsonArrayEvidence<SnapshotProfileScore>(row.profile_scores, budget.maxProfilesPerRow);

  return {
    id: row.id,
    arrInstanceId: row.arr_instance_id,
    arrType: row.arr_type as HealthArrType,
    engineVersion: row.engine_version,
    overallScore: row.overall_score,
    band: row.band as HealthBand,
    criteriaScores: criteriaScores.values,
    profileScores: profileScores.values,
    criteriaScoresValid: criteriaScores.valid,
    profileScoresValid: profileScores.valid,
    criteriaScoresBytes: row.criteria_scores_bytes,
    profileScoresBytes: row.profile_scores_bytes,
    generatedAt: row.generated_at,
  };
}

function validateEvidenceBudget(budget: ConfigHealthTrendEvidenceBudget): void {
  for (const value of Object.values(budget)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError('Config Health trend evidence budgets must be positive safe integers');
    }
  }
}

function assertRowsWithinEvidenceBudget(
  rows: readonly ConfigHealthTrendSnapshotRow[],
  budget: ConfigHealthTrendEvidenceBudget
): void {
  let totalBytes = 0;
  for (const row of rows) {
    const rowBytes = row.criteria_scores_bytes + row.profile_scores_bytes;
    if (!Number.isSafeInteger(rowBytes) || rowBytes > budget.maxBytesPerRow) {
      throw new ConfigHealthTrendEvidenceLimitError();
    }
    totalBytes += rowBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > budget.maxTotalBytes) {
      throw new ConfigHealthTrendEvidenceLimitError();
    }
  }
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
    const evidenceBudget = options.evidenceBudget ?? CONFIG_HEALTH_TREND_EVIDENCE_BUDGET;
    validateEvidenceBudget(evidenceBudget);

    let rows: ConfigHealthTrendSnapshotRow[];
    if (options.from !== undefined && options.to !== undefined) {
      rows = db.query<ConfigHealthTrendSnapshotRow>(
        `SELECT id, arr_instance_id, arr_type, engine_version, overall_score, band,
				        criteria_scores, profile_scores, generated_at,
				        length(CAST(criteria_scores AS BLOB)) AS criteria_scores_bytes,
				        length(CAST(profile_scores AS BLOB)) AS profile_scores_bytes
				 FROM config_health_snapshots
				 WHERE arr_instance_id = ? AND generated_at >= ? AND generated_at <= ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.from,
        options.to,
        options.limit
      );
    } else if (options.from !== undefined) {
      rows = db.query<ConfigHealthTrendSnapshotRow>(
        `SELECT id, arr_instance_id, arr_type, engine_version, overall_score, band,
				        criteria_scores, profile_scores, generated_at,
				        length(CAST(criteria_scores AS BLOB)) AS criteria_scores_bytes,
				        length(CAST(profile_scores AS BLOB)) AS profile_scores_bytes
				 FROM config_health_snapshots
			 WHERE arr_instance_id = ? AND generated_at >= ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.from,
        options.limit
      );
    } else if (options.to !== undefined) {
      rows = db.query<ConfigHealthTrendSnapshotRow>(
        `SELECT id, arr_instance_id, arr_type, engine_version, overall_score, band,
				        criteria_scores, profile_scores, generated_at,
				        length(CAST(criteria_scores AS BLOB)) AS criteria_scores_bytes,
				        length(CAST(profile_scores AS BLOB)) AS profile_scores_bytes
				 FROM config_health_snapshots
			 WHERE arr_instance_id = ? AND generated_at <= ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.to,
        options.limit
      );
    } else {
      rows = db.query<ConfigHealthTrendSnapshotRow>(
        `SELECT id, arr_instance_id, arr_type, engine_version, overall_score, band,
				        criteria_scores, profile_scores, generated_at,
				        length(CAST(criteria_scores AS BLOB)) AS criteria_scores_bytes,
				        length(CAST(profile_scores AS BLOB)) AS profile_scores_bytes
				 FROM config_health_snapshots
			 WHERE arr_instance_id = ?
			 ORDER BY generated_at ASC, id ASC
			 LIMIT ?`,
        instanceId,
        options.limit
      );
    }

    // Validate the complete selected set before parsing any row, so callers receive all or a typed
    // failure and aggregate JSON work remains bounded even when every individual row is small.
    assertRowsWithinEvidenceBudget(rows, evidenceBudget);
    return rows.map((row) => rowToTrendDetail(row, evidenceBudget));
  },

  /** Whether retained history contains evidence for this instance under another Arr domain. */
  hasTrendArrTypeMismatch(instanceId: number, arrType: HealthArrType): boolean {
    return (
      db.queryFirst<{ present: number }>(
        `SELECT 1 AS present
				 FROM config_health_snapshots
				 WHERE arr_instance_id = ? AND arr_type <> ?
				 LIMIT 1`,
        instanceId,
        arrType
      ) !== undefined
    );
  },

  /** Deterministic bounded union of usable exact profile names across all retained history. */
  listTrendProfileNames(
    instanceId: number,
    arrType: HealthArrType,
    options: ConfigHealthTrendProfileNameOptions
  ): string[] {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      throw new RangeError('Config Health trend profile name limit must be a positive safe integer');
    }
    const evidenceBudget = options.evidenceBudget ?? CONFIG_HEALTH_TREND_EVIDENCE_BUDGET;
    validateEvidenceBudget(evidenceBudget);
    const rows = db.query<{ name: string | null; over_budget: number }>(
      `WITH evidence AS MATERIALIZED (
			   SELECT profile_scores,
			          length(CAST(profile_scores AS BLOB)) AS evidence_bytes
				   FROM config_health_snapshots
				   WHERE arr_instance_id = ?
				     AND arr_type = ?
				 ), budget AS MATERIALIZED (
				   SELECT CASE
				     WHEN COALESCE(SUM(evidence_bytes), 0) > ? THEN 0
				     WHEN COALESCE(MAX(evidence_bytes), 0) > ? THEN 0
				     WHEN COALESCE(MAX(CASE
				       WHEN evidence_bytes <= ?
				        AND json_valid(profile_scores)
				        AND json_type(profile_scores) = 'array'
				       THEN json_array_length(profile_scores)
				       ELSE 0
				     END), 0) > ? THEN 0
				     ELSE 1
				   END AS within_budget
				   FROM evidence
				 ), usable_snapshots AS MATERIALIZED (
				   SELECT evidence.profile_scores
				   FROM evidence
				   JOIN budget ON budget.within_budget = 1
				     AND json_valid(profile_scores)
				     AND json_type(profile_scores) = 'array'
				     AND NOT EXISTS (
				       SELECT 1
				       FROM json_each(profile_scores) AS candidate
				       WHERE candidate.type <> 'object'
				          OR CASE WHEN candidate.type = 'object' THEN NOT (
				               json_type(candidate.value, '$.name') = 'text'
				               AND json_type(candidate.value, '$.score') IN ('integer', 'real')
				               AND json_extract(candidate.value, '$.score') BETWEEN 0 AND 100
				               AND json_extract(candidate.value, '$.score') = CAST(json_extract(candidate.value, '$.score') AS INTEGER)
				               AND json_extract(candidate.value, '$.band') IN ('healthy', 'attention', 'needs-review', 'unknown')
				             ) ELSE 0 END
				     )
				 ), profile_names AS MATERIALIZED (
				   SELECT json_extract(profile.value, '$.name') AS name
				   FROM usable_snapshots
				   JOIN json_each(usable_snapshots.profile_scores) AS profile
				 ), names AS (
				   SELECT DISTINCT name
				   FROM profile_names
				   ORDER BY name COLLATE BINARY ASC
				   LIMIT ?
				 )
				 SELECT name, 0 AS over_budget FROM names
				 UNION ALL
				 SELECT NULL AS name, 1 AS over_budget FROM budget WHERE within_budget = 0
				 ORDER BY over_budget DESC, name COLLATE BINARY ASC`,
      instanceId,
      arrType,
      evidenceBudget.maxTotalBytes,
      evidenceBudget.maxBytesPerRow,
      evidenceBudget.maxBytesPerRow,
      evidenceBudget.maxProfilesPerRow,
      options.limit
    );
    if (rows[0]?.over_budget === 1) throw new ConfigHealthTrendEvidenceLimitError();
    return rows.flatMap((row) => (row.name === null ? [] : [row.name]));
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
