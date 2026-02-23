import { logger } from '$logger/logger.ts';
import { config, type PCDMigrationIngestionMode } from '$config';
import { buildContentHash, pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { extractOrderFromFilename, getBaseOpsPath } from '../utils/operations.ts';
import { SQL_ENTITY_STABLE_KEY_BY_ENTITY } from '$pcd/stableIdentity.ts';
import type { EntityType } from '$shared/pcd/portable.ts';
import {
  type MigrationEntityStableIdentity,
  type MigrationEntityCandidate,
  type MigrationReaderIssue,
  readMigrationEntitySources,
} from '$pcd/migration/reader.ts';
import { compile } from '../database/compiler.ts';
import { getCache } from '../database/registry.ts';
import { withRepoImportWriteContext } from './writer.ts';

const UNPREFIXED_SEQUENCE_BASE = 2_000_000_000;
const YAML_SEQUENCE_BASE = 4_000_000_000;
const YAML_SEQUENCE_STRIDE = 10_000;
const MIGRATION_OP_FILENAME_PREFIX = 'entities/';

const ENTITY_IMPORT_ORDER: readonly EntityType[] = [
  'regular_expression',
  'custom_format',
  'quality_profile',
  'delay_profile',
  'radarr_naming',
  'sonarr_naming',
  'lidarr_naming',
  'radarr_media_settings',
  'sonarr_media_settings',
  'lidarr_media_settings',
  'radarr_quality_definitions',
  'sonarr_quality_definitions',
  'lidarr_quality_definitions',
  'lidarr_metadata_profile',
] as const;

interface BaseImportSqlEntry {
  name: string;
  filepath: string;
  opNumber: number | null;
  sequence: number;
  cleanedSql: string;
  metadataJson: string | null;
  contentHash: string;
  stableIdentity: MigrationEntityStableIdentity | null;
}

type SourceType = 'sql' | 'migration';

interface SourceConflictRef {
  kind: SourceType;
  file: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStableIdentityFromText(raw: string): MigrationEntityStableIdentity | null {
  const value = asString(raw);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parseStableIdentityFromObject(parsed);
  } catch (error) {
    if (value.startsWith('{')) {
      const preview = value.length > 500 ? `${value.slice(0, 500)}...` : value;
      logger.warn('Failed to parse stable identity JSON text from migration metadata', {
        source: 'PCDImport',
        meta: { raw: preview, error: String(error) },
      });
    }

    const equalsIndex = value.indexOf('=');
    if (equalsIndex <= 0) return null;
    const key = asString(value.slice(0, equalsIndex));
    const stableValue = asString(value.slice(equalsIndex + 1));
    if (!key || !stableValue) return null;
    return { key, value: stableValue, kind: 'stable' };
  }
}

function parseStableIdentityFromObject(parsed: Record<string, unknown>): MigrationEntityStableIdentity | null {
  const key = asString(parsed.key);
  const value = asString(parsed.value);
  if (key && value) return { key, value, kind: 'stable' };

  const stableKey = parsed.stable_key;
  if (typeof stableKey === 'object' && stableKey !== null && !Array.isArray(stableKey)) {
    const nested = stableKey as Record<string, unknown>;
    const nestedKey = asString(nested.key);
    const nestedValue = asString(nested.value);
    if (nestedKey && nestedValue) {
      return { key: nestedKey, value: nestedValue, kind: 'stable' };
    }
  }

  return null;
}

function parseStableIdentityFromMetadata(parsed: Record<string, unknown>): MigrationEntityStableIdentity | null {
  const rawStableIdentity = asString(parsed.stable_key) ?? asString(parsed.stableKey);
  if (rawStableIdentity !== null) {
    const fromString = parseStableIdentityFromText(rawStableIdentity);
    if (fromString) return fromString;
  }

  const fromObject = parseStableIdentityFromObject(parsed);
  if (fromObject) return fromObject;

  const entity = asString(parsed.entity);
  const name = asString(parsed.name);
  if (!entity || !name) return null;

  return {
    kind: 'stable',
    key: SQL_ENTITY_STABLE_KEY_BY_ENTITY[entity.toLowerCase()] ?? `sql_${entity.toLowerCase()}_name`,
    value: name,
  };
}

function deriveSqlStableIdentity(metadataJson: string | null): MigrationEntityStableIdentity | null {
  if (!metadataJson) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(metadataJson) as Record<string, unknown>;
  } catch {
    throw new Error('Malformed SQL metadata JSON');
  }

  return parseStableIdentityFromMetadata(parsed);
}

function formatConflictIdentity(identity: MigrationEntityStableIdentity): string {
  return `${identity.key}=${identity.value}`;
}

function formatConflictPath(
  refs: [SourceConflictRef, SourceConflictRef],
  identity: MigrationEntityStableIdentity
): string {
  const [first, second] = refs;
  return `${formatConflictIdentity(identity)} in ${first.kind} (${first.file}) and ${second.kind} (${second.file})`;
}

export class MigrationReaderError extends Error {
  readonly issues: ReadonlyArray<MigrationReaderIssue>;

  constructor(pcdPath: string, issues: ReadonlyArray<MigrationReaderIssue>) {
    super(`Failed to read migration entity sources from ${pcdPath}/entities\n${formatMigrationIssueList(issues)}`);
    this.name = 'MigrationReaderError';
    this.issues = issues;
  }
}

function formatMigrationIssueList(issues: ReadonlyArray<MigrationReaderIssue>): string {
  return issues.map((issue) => `${issue.relativePath}: ${issue.kind} - ${issue.message}`).join('\n');
}

function validateStableIdentityConflicts(
  sqlEntries: BaseImportSqlEntry[],
  migrationEntries: ReadonlyArray<{
    readonly stableIdentity: MigrationEntityStableIdentity;
    readonly sourcePath: string;
  }>
): void {
  const seenSql = new Map<string, SourceConflictRef>();

  for (const entry of sqlEntries) {
    if (!entry.stableIdentity) continue;
    const identity = formatConflictIdentity(entry.stableIdentity);
    if (seenSql.has(identity)) {
      const other = seenSql.get(identity);
      if (!other) continue;
      throw new Error(
        `Ambiguous duplicate base import identity (sql/duplicate): ${formatConflictPath(
          [other, { kind: 'sql', file: entry.name }],
          entry.stableIdentity
        )}`
      );
    }

    seenSql.set(identity, { kind: 'sql', file: entry.name });
  }

  const migrationSeen = new Map<string, SourceConflictRef>();
  for (const entry of migrationEntries) {
    if (!entry.stableIdentity) continue;
    const identity = formatConflictIdentity(entry.stableIdentity);
    if (migrationSeen.has(identity)) {
      const other = migrationSeen.get(identity);
      if (!other) continue;
      throw new Error(
        `Ambiguous duplicate base import identity (migration/duplicate): ${formatConflictPath(
          [other, { kind: 'migration', file: entry.sourcePath }],
          entry.stableIdentity
        )}`
      );
    }

    migrationSeen.set(identity, { kind: 'migration', file: entry.sourcePath });
  }

  // Regression checks cover:
  // 1) SQL duplicate stable keys (same source)
  // 2) Migration duplicate stable keys (same source)
  // 3) Cross-source duplicate handling is resolved during import precedence
  //    (migration entities suppress overlapping SQL entries).
}

type TestOnlyStableIdentitySqlEntry = {
  readonly name: string;
  readonly filepath: string;
  readonly opNumber: number | null;
  readonly sequence: number;
  readonly cleanedSql: string;
  readonly metadataJson: string | null;
  readonly contentHash: string;
  readonly stableIdentity: MigrationEntityStableIdentity | null;
};

type TestOnlyStableIdentityMigrationEntry = {
  readonly stableIdentity: MigrationEntityStableIdentity | null;
  readonly sourcePath: string;
};

export function __testOnly_validateStableIdentityConflicts(
  sqlEntries: ReadonlyArray<TestOnlyStableIdentitySqlEntry>,
  migrationEntries: ReadonlyArray<TestOnlyStableIdentityMigrationEntry>
): void {
  validateStableIdentityConflicts(
    sqlEntries as BaseImportSqlEntry[],
    migrationEntries as Array<{
      readonly stableIdentity: MigrationEntityStableIdentity;
      readonly sourcePath: string;
    }>
  );
}

function collectMigrationStableIdentitySet(
  migrationEntries: ReadonlyArray<{
    readonly stableIdentity: MigrationEntityStableIdentity;
  }>
): Set<string> {
  const identities = new Set<string>();
  for (const entry of migrationEntries) {
    if (!entry.stableIdentity) continue;
    identities.add(formatConflictIdentity(entry.stableIdentity));
  }
  return identities;
}

function sortMigrationCandidatesByImportOrder(
  candidates: readonly MigrationEntityCandidate[]
): MigrationEntityCandidate[] {
  const entityOrder = new Map<EntityType, number>();
  for (let i = 0; i < ENTITY_IMPORT_ORDER.length; i++) {
    entityOrder.set(ENTITY_IMPORT_ORDER[i], i);
  }

  return [...candidates].sort((a, b) => {
    const aPriority = entityOrder.get(a.entityType) ?? Number.MAX_SAFE_INTEGER;
    const bPriority = entityOrder.get(b.entityType) ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.entityName.localeCompare(b.entityName);
  });
}

function parseMetadata(sql: string): { metadataJson: string | null; cleanedSql: string } {
  const lines = sql.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^--\s*@([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (match) {
      metadata[match[1]] = match[2].trim();
      continue;
    }
    cleanedLines.push(line);
  }

  const cleanedSql = cleanedLines.join('\n').trim();
  const hasRequired = !!(metadata.operation && metadata.entity && metadata.name);
  const metadataJson = hasRequired ? JSON.stringify(metadata) : null;

  return { metadataJson, cleanedSql };
}

export interface ImportBaseOpsResult {
  created: number;
  updated: number;
  orphaned: number;
}

export interface ImportBaseOpsOptions {
  pcdMigrationIngestionMode?: PCDMigrationIngestionMode;
}

export async function importBaseOps(
  databaseId: number,
  pcdPath: string,
  options: ImportBaseOpsOptions = {}
): Promise<ImportBaseOpsResult> {
  const basePath = getBaseOpsPath(pcdPath);
  if (!(await pathExists(basePath))) {
    return { created: 0, updated: 0, orphaned: 0 };
  }

  const migrationMode = options.pcdMigrationIngestionMode ?? config.pcdMigrationIngestionMode;
  const isHybridIngestion = migrationMode === 'hybrid';
  const migrationReaderResult = isHybridIngestion
    ? await readMigrationEntitySources(pcdPath)
    : { candidates: [], issues: [] };

  if (isHybridIngestion && migrationReaderResult.issues.length > 0) {
    throw new MigrationReaderError(pcdPath, migrationReaderResult.issues);
  }

  const migrationCandidates = migrationReaderResult.candidates.map((candidate) => ({
    stableIdentity: candidate.stableIdentity,
    sourcePath: candidate.sourcePath,
  }));

  const entries: Array<{ name: string; filepath: string; order: number }> = [];
  for await (const entry of Deno.readDir(basePath)) {
    if (!entry.isFile || !entry.name.endsWith('.sql')) continue;
    const filepath = `${basePath}/${entry.name}`;
    entries.push({
      name: entry.name,
      filepath,
      order: extractOrderFromFilename(entry.name),
    });
  }

  entries.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name);
  });

  const sqlEntries: BaseImportSqlEntry[] = [];
  let unprefixedIndex = 0;

  for (const entry of entries) {
    const opNumber = entry.order === Infinity ? null : entry.order;
    const sequence = opNumber === null ? UNPREFIXED_SEQUENCE_BASE + unprefixedIndex++ : opNumber;
    const rawSql = await Deno.readTextFile(entry.filepath);
    const { metadataJson, cleanedSql } = parseMetadata(rawSql);
    const contentHash = await buildContentHash(cleanedSql, metadataJson);

    sqlEntries.push({
      name: entry.name,
      filepath: entry.filepath,
      opNumber,
      sequence,
      cleanedSql,
      metadataJson,
      contentHash,
      stableIdentity: deriveSqlStableIdentity(metadataJson),
    });
  }

  let migrationIdentitySet = new Set<string>();
  if (isHybridIngestion) {
    validateStableIdentityConflicts(sqlEntries, migrationCandidates);
    migrationIdentitySet = collectMigrationStableIdentitySet(migrationCandidates);
  }

  const allowLegacySqlInHybrid = config.pcdMigrationAllowLegacyFallback;
  const effectiveSqlEntries =
    isHybridIngestion && !allowLegacySqlInHybrid
      ? []
      : isHybridIngestion
        ? sqlEntries.filter((entry) => {
            if (!entry.stableIdentity) return true;
            const identity = formatConflictIdentity(entry.stableIdentity);
            return !migrationIdentitySet.has(identity);
          })
        : sqlEntries;

  let created = 0;
  let updated = 0;
  const seenAt = new Date().toISOString();

  if (isHybridIngestion) {
    const existingRepoBaseOps = pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'base', {
      source: 'repo',
      states: ['published', 'draft'],
    });
    for (const op of existingRepoBaseOps) {
      if (!op.filename?.startsWith(MIGRATION_OP_FILENAME_PREFIX)) continue;
      pcdOpsQueries.update(op.id, {
        state: 'orphaned',
      });
    }
  }

  for (const entry of effectiveSqlEntries) {
    const existing = pcdOpsQueries.getBaseByFilename(databaseId, entry.name);
    if (existing) {
      pcdOpsQueries.update(existing.id, {
        state: 'published',
        source: 'repo',
        filename: entry.name,
        opNumber: entry.opNumber,
        sequence: entry.sequence,
        sql: entry.cleanedSql,
        metadata: entry.metadataJson,
        contentHash: entry.contentHash,
        lastSeenInRepoAt: seenAt,
      });
      updated += 1;
    } else {
      pcdOpsQueries.create({
        databaseId,
        origin: 'base',
        state: 'published',
        source: 'repo',
        filename: entry.name,
        opNumber: entry.opNumber,
        sequence: entry.sequence,
        sql: entry.cleanedSql,
        metadata: entry.metadataJson,
        contentHash: entry.contentHash,
        lastSeenInRepoAt: seenAt,
      });
      created += 1;
    }
  }

  let migrationImported = 0;
  if (isHybridIngestion && migrationReaderResult.candidates.length > 0) {
    await compile(pcdPath, databaseId);
    const sortedCandidates = sortMigrationCandidatesByImportOrder(migrationReaderResult.candidates);

    for (let i = 0; i < sortedCandidates.length; i++) {
      const candidate = sortedCandidates[i];
      const cache = getCache(databaseId);
      if (!cache) {
        throw new Error(`Cache not available while importing migration entity "${candidate.relativePath}"`);
      }

      await withRepoImportWriteContext(
        {
          filenamePrefix: `${MIGRATION_OP_FILENAME_PREFIX}${candidate.relativePath}`,
          sequenceStart: YAML_SEQUENCE_BASE + i * YAML_SEQUENCE_STRIDE,
          maxOperations: YAML_SEQUENCE_STRIDE,
          lastSeenInRepoAt: seenAt,
        },
        async () => {
          const result = await candidate.deserialize({
            databaseId,
            cache,
            layer: 'base',
            data: candidate.portable,
          });

          if (
            typeof result === 'object' &&
            result !== null &&
            'success' in result &&
            (result as { success?: boolean }).success === false
          ) {
            const error = (result as { error?: string }).error ?? 'unknown write failure';
            throw new Error(`Failed to import migration entity "${candidate.relativePath}": ${error}`);
          }
        }
      );

      migrationImported += 1;
    }

    await compile(pcdPath, databaseId);
  }

  const orphaned = pcdOpsQueries.markBaseOrphaned(databaseId, seenAt);

  await logger.debug('Imported base ops from repo', {
    source: 'PCDImporter',
    meta: {
      databaseId,
      basePath,
      created,
      updated,
      orphaned,
      migrationImported,
      sqlSuppressedByMigration: sqlEntries.length - effectiveSqlEntries.length,
    },
  });

  return { created, updated, orphaned };
}
