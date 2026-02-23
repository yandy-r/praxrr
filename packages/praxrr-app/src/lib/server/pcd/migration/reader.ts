/**
 * Migration Reader
 *
 * Loads JSON/YAML entity source documents and returns validated
 * migration candidates for downstream deserialization.
 * No persistence or side-effectful writes are performed.
 */

import { parse as parseYaml } from 'yaml';
import type { EntityType, PortableMigrationFormat, PortableMigrationMetadata } from '$shared/pcd/portable.ts';
import { PORTABLE_MIGRATION_MIN_VERSION } from '$shared/pcd/portable.ts';
import { PORTABLE_ENTITY_STABLE_KEY_BY_TYPE } from '$pcd/stableIdentity.ts';
import type { EntityDeserializer } from '$pcd/entities/deserialize.ts';
import { getEntityDeserializer } from '$pcd/entities/deserialize.ts';
import { validatePortableData } from '$pcd/entities/validate.ts';

type ReaderInputRecord = Record<string, unknown>;

interface MigrationSourceEntry {
  sourcePath: string;
  relativePath: string;
}

export interface MigrationEntityStableIdentity {
  readonly key: string;
  readonly value: string;
  readonly kind: 'stable';
}

interface MigrationEntityIdentity {
  readonly key: string;
  readonly value: string;
  readonly kind: 'identity';
}

interface TopLevelEntityPath {
  entityType: EntityType;
  kind: 'top-level';
}

interface NestedEntityPath {
  entityType: EntityType;
  kind: 'media-management' | 'metadata-profiles';
}

type EntityPathResolution = TopLevelEntityPath | NestedEntityPath | null;

const ENTITY_FORMAT_BY_DIR: Readonly<Record<string, EntityType>> = {
  'regular-expressions': 'regular_expression',
  'custom-formats': 'custom_format',
  'quality-profiles': 'quality_profile',
  'delay-profiles': 'delay_profile',
};

const ENTITY_FORMAT_BY_MEDIA_DIR: Readonly<Record<string, EntityType>> = {
  'radarr-naming': 'radarr_naming',
  'sonarr-naming': 'sonarr_naming',
  'lidarr-naming': 'lidarr_naming',
  'radarr-media-settings': 'radarr_media_settings',
  'sonarr-media-settings': 'sonarr_media_settings',
  'lidarr-media-settings': 'lidarr_media_settings',
  'radarr-quality-definitions': 'radarr_quality_definitions',
  'sonarr-quality-definitions': 'sonarr_quality_definitions',
  'lidarr-quality-definitions': 'lidarr_quality_definitions',
};

const KNOWN_NON_ENTITY_TOP_LEVEL_FILES = new Set(['tags.yaml', 'quality-api-mappings.yaml']);

export interface MigrationEntityCandidate {
  readonly sourcePath: string;
  readonly relativePath: string;
  readonly entityType: EntityType;
  readonly migration: PortableMigrationMetadata;
  readonly portable: ReaderInputRecord;
  readonly entityName: string;
  readonly identity: MigrationEntityIdentity;
  readonly stableIdentity: MigrationEntityStableIdentity;
  readonly deserialize: EntityDeserializer;
}

export interface MigrationReaderIssue {
  readonly relativePath: string;
  readonly kind: 'unsupported-format' | 'unsupported-path' | 'read-error' | 'parse-error' | 'validation-error';
  readonly message: string;
}

export interface MigrationReaderResult {
  readonly candidates: MigrationEntityCandidate[];
  readonly issues: MigrationReaderIssue[];
}

export async function readMigrationEntitySources(pcdPath: string): Promise<MigrationReaderResult> {
  const entitiesPath = `${pcdPath}/entities`;

  if (!(await pathExists(entitiesPath))) {
    return { candidates: [], issues: [] };
  }

  const filePaths = await listEntityFiles(entitiesPath);
  const sortedPaths = filePaths.sort((a, b) => a.localeCompare(b));

  const candidates: MigrationEntityCandidate[] = [];
  const issues: MigrationReaderIssue[] = [];

  for (const sourcePath of sortedPaths) {
    const relativePath = toRelativePath(sourcePath, entitiesPath);
    const parsed = await readMigrationEntitySource({
      sourcePath,
      relativePath,
    });

    if (!parsed.ok) {
      issues.push(parsed.error);
      continue;
    }

    candidates.push(parsed.candidate);
  }

  return { candidates, issues };
}

async function readMigrationEntitySource(entry: MigrationSourceEntry): Promise<
  | { ok: true; candidate: MigrationEntityCandidate }
  | {
      ok: false;
      error: MigrationReaderIssue;
    }
> {
  const format = inferFormatFromPath(entry.sourcePath);
  if (!format) {
    return {
      ok: false,
      error: {
        relativePath: entry.relativePath,
        kind: 'unsupported-format',
        message: 'Unsupported entity source extension. Expected .json, .yaml, or .yml',
      },
    };
  }

  const resolution = resolveEntityType(entry.relativePath);
  if (!resolution) {
    return {
      ok: false,
      error: {
        relativePath: entry.relativePath,
        kind: 'unsupported-path',
        message: KNOWN_NON_ENTITY_TOP_LEVEL_FILES.has(entry.relativePath.toLowerCase())
          ? 'Known top-level migration seed file that is not yet mapped to portable entity import'
          : 'Unsupported entity source path',
      },
    };
  }

  let raw: string;
  try {
    raw = await Deno.readTextFile(entry.sourcePath);
  } catch (error) {
    return {
      ok: false,
      error: {
        relativePath: entry.relativePath,
        kind: 'read-error',
        message: `Failed to read entity source file: ${String(error)}`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = parseSource(raw, format);
  } catch (error) {
    return {
      ok: false,
      error: {
        relativePath: entry.relativePath,
        kind: 'parse-error',
        message: `Failed to parse ${format.toUpperCase()} entity source: ${String(error)}`,
      },
    };
  }

  const portable = isolatePortablePayload(parsed);
  if (!portable) {
    return {
      ok: false,
      error: {
        relativePath: entry.relativePath,
        kind: 'parse-error',
        message: 'Entity source payload must be a non-null object',
      },
    };
  }

  const candidateName = extractEntityName(portable);
  if (!candidateName) {
    return {
      ok: false,
      error: {
        relativePath: entry.relativePath,
        kind: 'validation-error',
        message: 'Entity source payload must include a non-empty string field "name"',
      },
    };
  }

  const migration = resolveMigrationMetadata(format, entry.relativePath);

  const validationError = validatePortableData(resolution.entityType, portable);
  if (validationError) {
    return {
      ok: false,
      error: {
        relativePath: entry.relativePath,
        kind: 'validation-error',
        message: validationError,
      },
    };
  }

  return {
    ok: true,
    candidate: {
      sourcePath: entry.sourcePath,
      relativePath: entry.relativePath,
      entityType: resolution.entityType,
      migration,
      portable,
      entityName: candidateName,
      identity: {
        kind: 'identity',
        key: `migration:${resolution.entityType}`,
        value: candidateName,
      },
      stableIdentity: resolveMigrationStableIdentity(resolution.entityType, candidateName),
      deserialize: getEntityDeserializer(resolution.entityType),
    },
  };
}

function extractEntityName(portable: ReaderInputRecord): string | null {
  const nameValue = portable.name;
  if (typeof nameValue !== 'string') return null;
  if (!nameValue.trim()) return null;
  return nameValue;
}

function inferFormatFromPath(sourcePath: string): PortableMigrationFormat | null {
  const name = sourcePath.toLowerCase();
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.yaml')) return 'yaml';
  if (name.endsWith('.yml')) return 'yaml';
  return null;
}

function resolveEntityType(relativePath: string): EntityPathResolution {
  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/').filter((part) => part.length > 0);

  if (parts.length === 2) {
    const pathType = ENTITY_FORMAT_BY_DIR[parts[0].toLowerCase()];
    if (pathType) return { entityType: pathType, kind: 'top-level' };
  }

  if (parts.length === 3 && parts[0].toLowerCase() === 'media-management') {
    const pathType = ENTITY_FORMAT_BY_MEDIA_DIR[parts[1].toLowerCase()];
    if (pathType) return { entityType: pathType, kind: 'media-management' };
  }

  if (parts.length === 3 && parts[0].toLowerCase() === 'metadata-profiles') {
    if (parts[1].toLowerCase() === 'lidarr') {
      return {
        entityType: 'lidarr_metadata_profile',
        kind: 'metadata-profiles',
      };
    }
  }

  return null;
}

function parseSource(raw: string, format: PortableMigrationFormat): unknown {
  if (format === 'json') {
    return JSON.parse(raw);
  }

  return parseYaml(raw) as unknown;
}

function isolatePortablePayload(input: unknown): ReaderInputRecord | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }

  if (!Object.hasOwn(input, 'migration')) {
    return input as ReaderInputRecord;
  }

  const portable = { ...(input as ReaderInputRecord) };
  delete (portable as { migration?: unknown }).migration;

  return portable;
}

function resolveMigrationMetadata(format: PortableMigrationFormat, relativePath: string): PortableMigrationMetadata {
  return {
    source: `entities/${relativePath}`,
    format,
    version: PORTABLE_MIGRATION_MIN_VERSION,
  };
}

const STABLE_KEYS_BY_ENTITY = PORTABLE_ENTITY_STABLE_KEY_BY_TYPE;

function resolveStableEntityType(entityType: EntityType): keyof typeof STABLE_KEYS_BY_ENTITY {
  switch (entityType) {
    case 'delay_profile':
    case 'regular_expression':
    case 'custom_format':
    case 'quality_profile':
    case 'radarr_naming':
    case 'sonarr_naming':
    case 'lidarr_naming':
    case 'radarr_media_settings':
    case 'sonarr_media_settings':
    case 'lidarr_media_settings':
    case 'radarr_quality_definitions':
    case 'sonarr_quality_definitions':
    case 'lidarr_quality_definitions':
    case 'lidarr_metadata_profile':
      return entityType;
    default:
      const _unreachable = entityType satisfies never;
      throw new Error(`Unsupported entity type: ${String(_unreachable)}`);
  }
}

export function resolveMigrationStableIdentity(
  entityType: EntityType,
  entityName: string
): MigrationEntityStableIdentity {
  const stableKey = STABLE_KEYS_BY_ENTITY[resolveStableEntityType(entityType)];
  return {
    kind: 'stable',
    key: stableKey,
    value: entityName,
  };
}

async function listEntityFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of Deno.readDir(dirPath)) {
    const fullPath = `${dirPath}/${entry.name}`;

    if (entry.isDirectory) {
      const nestedFiles = await listEntityFiles(fullPath);
      files.push(...nestedFiles);
      continue;
    }

    if (!entry.isFile) continue;

    files.push(fullPath);
  }

  return files;
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

function toRelativePath(sourcePath: string, entitiesPath: string): string {
  const normalizedSource = sourcePath.replaceAll('\\', '/');
  const normalizedEntitiesPath = entitiesPath.replaceAll('\\', '/');
  const prefix = `${normalizedEntitiesPath}/`;

  if (normalizedSource.startsWith(prefix)) {
    return normalizedSource.slice(prefix.length);
  }

  return normalizedSource;
}
