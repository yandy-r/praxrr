import { logger } from '$logger/logger.ts';
import { config } from '$config';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { extractOrderFromFilename, getBaseOpsPath } from '../utils/operations.ts';
import {
  type MigrationEntityStableIdentity,
  type MigrationReaderIssue,
  readMigrationEntitySources,
} from '$pcd/migration/reader.ts';

const UNPREFIXED_SEQUENCE_BASE = 2_000_000_000;

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

const SQL_ENTITY_STABLE_KEY_BY_ENTITY: Readonly<Record<string, string>> = {
  batch: 'batch_name',
  quality_profile: 'quality_profile_name',
  regular_expression: 'regular_expression_name',
  custom_format: 'custom_format_name',
  delay_profile: 'delay_profile_name',
  radarr_naming: 'radarr_naming_name',
  sonarr_naming: 'sonarr_naming_name',
  lidarr_naming: 'lidarr_naming_name',
  radarr_media_settings: 'radarr_media_settings_name',
  sonarr_media_settings: 'sonarr_media_settings_name',
  lidarr_media_settings: 'lidarr_media_settings_name',
  radarr_quality_definitions: 'radarr_quality_definitions_name',
  sonarr_quality_definitions: 'sonarr_quality_definitions_name',
  lidarr_quality_definitions: 'lidarr_quality_definitions_name',
  lidarr_metadata_profile: 'metadata_profile_name',
  metadata_profile: 'metadata_profile_name',
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
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
  } catch {
    const equalsIndex = value.indexOf('=');
    if (equalsIndex <= 0) return null;
    const key = asString(value.slice(0, equalsIndex));
    const stableValue = asString(value.slice(equalsIndex + 1));
    if (!key || !stableValue) return null;
    return { key, value: stableValue };
  }
}

function parseStableIdentityFromObject(parsed: Record<string, unknown>): MigrationEntityStableIdentity | null {
  const key = asString(parsed.key);
  const value = asString(parsed.value);
  if (key && value) return { key, value };

  const stableKey = parsed.stable_key;
  if (typeof stableKey === 'object' && stableKey !== null && !Array.isArray(stableKey)) {
    const nested = stableKey as Record<string, unknown>;
    const nestedKey = asString(nested.key);
    const nestedValue = asString(nested.value);
    if (nestedKey && nestedValue) {
      return { key: nestedKey, value: nestedValue };
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
    return null;
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

function formatMigrationIssueList(issues: MigrationReaderIssue[]): string {
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

  for (const entry of migrationEntries) {
    if (!entry.stableIdentity) continue;
    const identity = formatConflictIdentity(entry.stableIdentity);
    if (!seenSql.has(identity)) continue;
    const existing = seenSql.get(identity);
    if (!existing) continue;

    throw new Error(
      `Ambiguous duplicate base import identity (cross-source): ${formatConflictPath(
        [existing, { kind: 'migration', file: entry.sourcePath }],
        entry.stableIdentity
      )}`
    );
  }

  // Regression checks cover:
  // 1) SQL duplicate stable keys (same source)
  // 2) Migration duplicate stable keys (same source)
  // 3) SQL + migration duplicate stable keys (cross source)
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

async function hashContent(sql: string, metadataJson: string | null): Promise<string> {
  const payload = `${sql}\n${metadataJson ?? ''}`;
  const data = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ImportBaseOpsResult {
  created: number;
  updated: number;
  orphaned: number;
}

export async function importBaseOps(databaseId: number, pcdPath: string): Promise<ImportBaseOpsResult> {
  const basePath = getBaseOpsPath(pcdPath);
  if (!(await pathExists(basePath))) {
    return { created: 0, updated: 0, orphaned: 0 };
  }

  const isHybridIngestion = config.pcdMigrationIngestionMode === 'hybrid';
  const migrationReaderResult = isHybridIngestion
    ? await readMigrationEntitySources(pcdPath)
    : { candidates: [], issues: [] };

  if (isHybridIngestion && migrationReaderResult.issues.length > 0) {
    throw new Error(
      `Failed to read migration entity sources from ${pcdPath}/entities\n${formatMigrationIssueList(
        migrationReaderResult.issues
      )}`
    );
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
    const contentHash = await hashContent(cleanedSql, metadataJson);

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

  if (isHybridIngestion) {
    validateStableIdentityConflicts(sqlEntries, migrationCandidates);
  }

  let created = 0;
  let updated = 0;
  const seenAt = new Date().toISOString();

  for (const entry of sqlEntries) {
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

  const orphaned = pcdOpsQueries.markBaseOrphaned(databaseId, seenAt);

  await logger.debug('Imported base ops from repo', {
    source: 'PCDImporter',
    meta: {
      databaseId,
      basePath,
      created,
      updated,
      orphaned,
    },
  });

  return { created, updated, orphaned };
}
