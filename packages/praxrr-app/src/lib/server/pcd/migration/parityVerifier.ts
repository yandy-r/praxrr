import type { PCDCache } from '$pcd/database/cache.ts';
import { compile, invalidate } from '$pcd/database/compiler.ts';
import { getCache } from '$pcd/database/registry.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { importBaseOps } from '$pcd/ops/importBaseOps.ts';
import { readMigrationEntitySources } from '$pcd/migration/reader.ts';
import { formatStableJson, sortMigrationCandidatesByImportOrder } from '$pcd/migration/migrationImportUtils.ts';

const PARITY_COMPARISON_TABLES = [
  'tags',
  'regular_expressions',
  'regular_expression_tags',
  'custom_formats',
  'custom_format_conditions',
  'condition_patterns',
  'condition_languages',
  'condition_sources',
  'condition_resolutions',
  'condition_quality_modifiers',
  'condition_indexer_flags',
  'condition_sizes',
  'condition_years',
  'custom_format_tags',
  'custom_format_tests',
  'quality_profiles',
  'quality_groups',
  'quality_group_members',
  'quality_profile_qualities',
  'quality_profile_tags',
  'quality_profile_languages',
  'quality_profile_custom_formats',
  'delay_profiles',
  'radarr_naming',
  'sonarr_naming',
  'lidarr_naming',
  'radarr_media_settings',
  'sonarr_media_settings',
  'lidarr_media_settings',
  'radarr_quality_definitions',
  'sonarr_quality_definitions',
  'lidarr_quality_definitions',
  'lidarr_metadata_profiles',
  'lidarr_metadata_profile_primary_types',
  'lidarr_metadata_profile_secondary_types',
  'lidarr_metadata_profile_release_statuses',
] as const satisfies readonly string[];

type ParityTable = (typeof PARITY_COMPARISON_TABLES)[number];

const NON_DETERMINISTIC_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

const TABLE_SORT_KEYS: Readonly<Record<ParityTable, readonly string[]>> = {
  tags: ['name'],
  regular_expressions: ['name'],
  regular_expression_tags: ['regular_expression_name', 'tag_name'],
  custom_formats: ['name'],
  custom_format_conditions: ['custom_format_name', 'name'],
  condition_patterns: ['custom_format_name', 'condition_name', 'regular_expression_name'],
  condition_languages: ['custom_format_name', 'condition_name', 'language_name'],
  condition_sources: ['custom_format_name', 'condition_name', 'source'],
  condition_resolutions: ['custom_format_name', 'condition_name', 'resolution'],
  condition_quality_modifiers: ['custom_format_name', 'condition_name', 'quality_modifier'],
  condition_indexer_flags: ['custom_format_name', 'condition_name', 'flag'],
  condition_sizes: ['custom_format_name', 'condition_name', 'min_bytes', 'max_bytes'],
  condition_years: ['custom_format_name', 'condition_name', 'min_year', 'max_year'],
  custom_format_tags: ['custom_format_name', 'tag_name'],
  custom_format_tests: ['custom_format_name', 'title', 'type'],
  quality_profiles: ['name'],
  quality_groups: ['quality_profile_name', 'name'],
  quality_group_members: ['quality_profile_name', 'quality_group_name', 'quality_name'],
  quality_profile_qualities: ['quality_profile_name', 'position', 'quality_name', 'quality_group_name'],
  quality_profile_tags: ['quality_profile_name', 'tag_name'],
  quality_profile_languages: ['quality_profile_name', 'language_name'],
  quality_profile_custom_formats: ['quality_profile_name', 'custom_format_name', 'arr_type'],
  delay_profiles: ['name'],
  radarr_naming: ['name'],
  sonarr_naming: ['name'],
  lidarr_naming: ['name'],
  radarr_media_settings: ['name'],
  sonarr_media_settings: ['name'],
  lidarr_media_settings: ['name'],
  radarr_quality_definitions: ['name', 'quality_name'],
  sonarr_quality_definitions: ['name', 'quality_name'],
  lidarr_quality_definitions: ['name', 'quality_name'],
  lidarr_metadata_profiles: ['name'],
  lidarr_metadata_profile_primary_types: ['metadata_profile_name', 'type_id'],
  lidarr_metadata_profile_secondary_types: ['metadata_profile_name', 'type_id'],
  lidarr_metadata_profile_release_statuses: ['metadata_profile_name', 'status_id'],
};

const NUMERIC_STRING_RE = /^[+-]?(?:\d+|\d+\.\d+|\.\d+)(?:[eE][+-]?\d+)?$/;

export interface ParityDiff {
  readonly table: ParityTable;
  readonly kind: 'missing_in_b' | 'missing_in_a' | 'field_mismatch';
  readonly naturalKey: Record<string, unknown>;
  readonly field?: string;
  readonly valueA?: unknown;
  readonly valueB?: unknown;
}

export interface ParityReport {
  readonly pass: boolean;
  readonly tablesCompared: number;
  readonly totalRowsA: number;
  readonly totalRowsB: number;
  readonly diffs: readonly ParityDiff[];
}

export interface ParityVerifierOptions {
  readonly pcdPath: string;
}

interface BuildResult {
  readonly snapshots: Map<ParityTable, readonly Record<string, unknown>[]>;
}

function stableKeyString(naturalKey: Record<string, unknown>): string {
  return formatStableJson(naturalKey);
}

function isTruthyBooleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeScalarValue(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return trimmed;
    if (trimmed === 'true' || trimmed === 'false') {
      return isTruthyBooleanValue(trimmed) ? 1 : 0;
    }
    if (NUMERIC_STRING_RE.test(trimmed)) {
      return Number(trimmed);
    }
    return trimmed;
  }

  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (NON_DETERMINISTIC_COLUMNS.has(key)) continue;
    normalized[key] = normalizeScalarValue(value);
  }

  return normalized;
}

function getSortValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return value;
  return formatStableJson(value);
}

function compareRowsBySortKeys(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  keys: readonly string[]
): number {
  for (const key of keys) {
    const aValue = getSortValue(a[key]);
    const bValue = getSortValue(b[key]);

    if (aValue === bValue) continue;
    if (aValue === null) return -1;
    if (bValue === null) return 1;

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return aValue - bValue;
    }

    const aString = String(aValue);
    const bString = String(bValue);
    const lexical = aString.localeCompare(bString);
    if (lexical !== 0) return lexical;
  }

  return 0;
}

function sortRows(table: ParityTable, rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const sortKeys = TABLE_SORT_KEYS[table];
  return [...rows].sort((a, b) => {
    const cmp = compareRowsBySortKeys(a, b, sortKeys);
    if (cmp !== 0) return cmp;

    return formatStableJson(a).localeCompare(formatStableJson(b));
  });
}

function extractNaturalKey(row: Record<string, unknown>, table: ParityTable): Record<string, unknown> {
  const keyColumns = TABLE_SORT_KEYS[table];
  const natural: Record<string, unknown> = {};

  for (const column of keyColumns) {
    if (!(column in row)) {
      throw new Error(`Missing required natural key column "${column}" in table "${table}" row`);
    }
    natural[column] = normalizeScalarValue(row[column]);
  }

  return natural;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return formatStableJson(a) === formatStableJson(b);
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return formatStableJson(a) === formatStableJson(b);
  }

  return false;
}

function compareTableRows(
  table: ParityTable,
  rowsA: readonly Record<string, unknown>[],
  rowsB: readonly Record<string, unknown>[],
  diffs: ParityDiff[]
): void {
  const mapA = new Map<string, Record<string, unknown>>();
  const mapB = new Map<string, Record<string, unknown>>();
  const keysA = new Map<string, Record<string, unknown>>();
  const keysB = new Map<string, Record<string, unknown>>();

  for (const row of rowsA) {
    const naturalKey = extractNaturalKey(row, table);
    const key = stableKeyString(naturalKey);
    if (mapA.has(key)) {
      throw new Error(`Duplicate row key in table "${table}": ${key}`);
    }
    mapA.set(key, row);
    keysA.set(key, naturalKey);
  }

  for (const row of rowsB) {
    const naturalKey = extractNaturalKey(row, table);
    const key = stableKeyString(naturalKey);
    if (mapB.has(key)) {
      throw new Error(`Duplicate row key in table "${table}": ${key}`);
    }
    mapB.set(key, row);
    keysB.set(key, naturalKey);
  }

  for (const [key, rowA] of mapA.entries()) {
    const rowB = mapB.get(key);
    if (!rowB) {
      diffs.push({
        table,
        kind: 'missing_in_b',
        naturalKey: keysA.get(key) ?? {},
      });
      continue;
    }

    const fieldSet = new Set<string>([...Object.keys(rowA), ...Object.keys(rowB)]);
    for (const field of fieldSet) {
      const normalizedA = normalizeScalarValue(rowA[field]);
      const normalizedB = normalizeScalarValue(rowB[field]);

      if (!valuesEqual(normalizedA, normalizedB)) {
        diffs.push({
          table,
          kind: 'field_mismatch',
          naturalKey: keysA.get(key) ?? keysB.get(key) ?? {},
          field,
          valueA: normalizedA,
          valueB: normalizedB,
        });
      }
    }
  }

  for (const key of mapB.keys()) {
    if (!mapA.has(key)) {
      diffs.push({
        table,
        kind: 'missing_in_a',
        naturalKey: keysB.get(key) ?? {},
      });
    }
  }
}

function snapshotRequiredTables(cache: PCDCache): Map<ParityTable, readonly Record<string, unknown>[]> {
  const snapshots = new Map<ParityTable, readonly Record<string, unknown>[]>();

  for (const table of PARITY_COMPARISON_TABLES) {
    const exists = cache.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      table
    );
    if (!exists) {
      throw new Error(`Parity verifier failed: required table "${table}" is missing`);
    }

    const rawRows = cache.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    const normalizedRows = rawRows.map((row) => normalizeRow(row));
    snapshots.set(table, sortRows(table, normalizedRows));
  }

  return snapshots;
}

async function withIsolatedInstance<T>(
  pcdPath: string,
  purpose: string,
  callback: (databaseId: number) => Promise<T>
): Promise<T> {
  const databaseId = databaseInstancesQueries.create({
    uuid: crypto.randomUUID(),
    name: `pcd-parity-${purpose}-${Date.now()}`,
    repositoryUrl: pcdPath,
    localPath: pcdPath,
    syncStrategy: 0,
    enabled: true,
    localOpsEnabled: false,
    autoPull: false,
    conflictStrategy: 'override',
  });

  let callbackResult: T | undefined;
  let callbackError: unknown;

  try {
    callbackResult = await callback(databaseId);
  } catch (error) {
    callbackError = error;
  } finally {
    try {
      invalidate(databaseId);
    } catch (error) {
      console.error(`Failed to invalidate parity verifier instance ${databaseId} for ${pcdPath}/${purpose}:`, error);
    }

    try {
      databaseInstancesQueries.delete(databaseId);
    } catch (error) {
      if (callbackError === undefined) {
        throw error;
      }
      console.error(`Failed to delete parity verifier instance ${databaseId}:`, error);
    }
  }

  if (callbackError !== undefined) {
    throw callbackError;
  }

  if (callbackResult === undefined) {
    throw new Error(`Parity verifier callback failed for ${pcdPath}/${purpose} without returning a value`);
  }

  return callbackResult;
}

async function buildSqlOnlySnapshot(pcdPath: string): Promise<BuildResult> {
  return withIsolatedInstance(pcdPath, 'sql', async (databaseId) => {
    await importBaseOps(databaseId, pcdPath, {
      pcdMigrationIngestionMode: 'sql-only',
    });
    await compile(pcdPath, databaseId);

    const cache = getCache(databaseId);
    if (!cache) {
      throw new Error(`No cache available after SQL-only compile for instance ${databaseId}`);
    }

    return {
      snapshots: snapshotRequiredTables(cache),
    };
  });
}

async function buildEntitySnapshot(pcdPath: string): Promise<BuildResult> {
  const candidates = await readMigrationEntitySources(pcdPath);
  const sortedCandidates = sortMigrationCandidatesByImportOrder(candidates.candidates);

  if (candidates.issues.length > 0) {
    const issueText = candidates.issues
      .map((issue) => `${issue.relativePath}: ${issue.kind} ${issue.message}`)
      .join('\n');
    throw new Error(`Unable to read migration entities from ${pcdPath}:\n${issueText}`);
  }

  return withIsolatedInstance(pcdPath, 'entity', async (databaseId) => {
    await compile(pcdPath, databaseId);
    const cache = getCache(databaseId);
    if (!cache) {
      throw new Error(`No cache available after schema-only compile for instance ${databaseId}`);
    }

    for (const candidate of sortedCandidates) {
      await candidate.deserialize({
        databaseId,
        cache,
        layer: 'user',
        data: candidate.portable,
      });
    }

    return {
      snapshots: snapshotRequiredTables(cache),
    };
  });
}

function compareParitySnapshots(
  sqlSnapshots: Map<ParityTable, readonly Record<string, unknown>[]>,
  entitySnapshots: Map<ParityTable, readonly Record<string, unknown>[]>
): ParityReport {
  const diffs: ParityDiff[] = [];
  let totalRowsA = 0;
  let totalRowsB = 0;

  for (const table of PARITY_COMPARISON_TABLES) {
    const rowsA = sqlSnapshots.get(table);
    const rowsB = entitySnapshots.get(table);

    if (!rowsA || !rowsB) {
      throw new Error(`Parity verification incomplete: missing snapshot table "${table}"`);
    }

    totalRowsA += rowsA.length;
    totalRowsB += rowsB.length;

    compareTableRows(table, rowsA, rowsB, diffs);
  }

  return {
    pass: diffs.length === 0,
    tablesCompared: PARITY_COMPARISON_TABLES.length,
    totalRowsA,
    totalRowsB,
    diffs,
  };
}

export function formatParityReport(report: ParityReport): string {
  const lines = [
    `Parity report: ${report.pass ? 'PASS' : 'FAIL'}`,
    `Tables compared: ${report.tablesCompared}`,
    `Rows in SQL snapshot: ${report.totalRowsA}`,
    `Rows in entity snapshot: ${report.totalRowsB}`,
    `Differences: ${report.diffs.length}`,
  ];

  if (report.diffs.length > 0) {
    lines.push('');
    for (const diff of report.diffs) {
      const key = stableKeyString(diff.naturalKey);
      if (diff.kind === 'field_mismatch') {
        lines.push(`- ${diff.table}: field_mismatch ${key}`);
        lines.push(`  ${diff.field}: ${formatStableJson(diff.valueA)} vs ${formatStableJson(diff.valueB)}`);
      } else if (diff.kind === 'missing_in_b') {
        lines.push(`- ${diff.table}: missing_in_b ${key}`);
      } else {
        lines.push(`- ${diff.table}: missing_in_a ${key}`);
      }
    }
  }

  return lines.join('\n');
}

export async function verifyPcdParity(options: ParityVerifierOptions): Promise<ParityReport> {
  if (!options.pcdPath) {
    throw new Error('pcdPath is required');
  }

  const sql = await buildSqlOnlySnapshot(options.pcdPath);
  const entities = await buildEntitySnapshot(options.pcdPath);

  return compareParitySnapshots(sql.snapshots, entities.snapshots);
}

export function compareRowsByNaturalKey(
  a: readonly Record<string, unknown>[],
  b: readonly Record<string, unknown>[],
  table: ParityTable
): ParityDiff[] {
  const diffs: ParityDiff[] = [];
  compareTableRows(table, a, b, diffs);
  return diffs;
}
