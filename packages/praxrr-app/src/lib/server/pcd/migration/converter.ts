import type { PCDCache } from '$pcd/database/cache.ts';
import {
  PORTABLE_MIGRATION_MIN_VERSION,
  PORTABLE_MIGRATION_SOURCE_EXPORT,
  type EntityType,
  type PortableMigrationFormat,
} from '$shared/pcd/portable.ts';
import type {
  EnumeratedMigrationEntityDescriptor,
  MigrationEntityStableIdentity,
} from '$pcd/migration/enumerateEntities.ts';
import { enumerateMigrationEntities } from '$pcd/migration/enumerateEntities.ts';
import {
  serializeCustomFormat,
  serializeDelayProfile,
  serializeLidarrMetadataProfile,
  serializeLidarrMediaSettings,
  serializeLidarrNaming,
  serializeLidarrQualityDefinitions,
  serializeQualityProfile,
  serializeRadarrMediaSettings,
  serializeRadarrNaming,
  serializeRadarrQualityDefinitions,
  serializeRegularExpression,
  serializeSonarrMediaSettings,
  serializeSonarrNaming,
  serializeSonarrQualityDefinitions,
} from '$pcd/entities/serialize.ts';
import { formatDeterministicYaml } from '$pcd/migration/yamlFormatter.ts';
import { resolveEntitySlug } from '$pcd/migration/slug.ts';

type SerializableRecord = Readonly<Record<string, unknown>>;

type PortableEntitySerializer = (cache: PCDCache, name: string) => Promise<unknown>;

interface ConverterFailure {
  readonly entityType: EntityType;
  readonly entityName: string;
  readonly stableIdentity: MigrationEntityStableIdentity;
  readonly path: string;
  readonly stage: 'serialize' | 'format' | 'write';
  readonly message: string;
}

export interface ConvertEntitySummary {
  readonly entityType: EntityType;
  readonly relativeDir: string;
  readonly total: number;
  readonly written: number;
  readonly failed: number;
}

export interface ConvertOptions {
  readonly cache: PCDCache;
  readonly outputDir: string;
  readonly format: PortableMigrationFormat;
  readonly overwrite: boolean;
  readonly entityTypes?: readonly EntityType[];
  readonly includeMigrationMetadata: boolean;
}

export interface ConvertReport {
  readonly outputDir: string;
  readonly format: PortableMigrationFormat;
  readonly overwrite: boolean;
  readonly includeMigrationMetadata: boolean;
  readonly entitySummaries: readonly ConvertEntitySummary[];
  readonly writtenFiles: number;
  readonly failedFiles: number;
  readonly totalFiles: number;
}

const ENTITY_DIRECTORY_BY_TYPE: Readonly<Record<EntityType, string>> = {
  regular_expression: 'regular-expressions',
  custom_format: 'custom-formats',
  quality_profile: 'quality-profiles',
  delay_profile: 'delay-profiles',
  radarr_naming: 'media-management/radarr-naming',
  sonarr_naming: 'media-management/sonarr-naming',
  lidarr_naming: 'media-management/lidarr-naming',
  radarr_media_settings: 'media-management/radarr-media-settings',
  sonarr_media_settings: 'media-management/sonarr-media-settings',
  lidarr_media_settings: 'media-management/lidarr-media-settings',
  radarr_quality_definitions: 'media-management/radarr-quality-definitions',
  sonarr_quality_definitions: 'media-management/sonarr-quality-definitions',
  lidarr_quality_definitions: 'media-management/lidarr-quality-definitions',
  lidarr_metadata_profile: 'metadata-profiles/lidarr',
} as const;

const ENTITY_SERIALIZERS: Readonly<Record<EntityType, PortableEntitySerializer>> = {
  regular_expression: serializeRegularExpression,
  custom_format: serializeCustomFormat,
  quality_profile: serializeQualityProfile,
  delay_profile: serializeDelayProfile,
  radarr_naming: serializeRadarrNaming,
  sonarr_naming: serializeSonarrNaming,
  lidarr_naming: serializeLidarrNaming,
  radarr_media_settings: serializeRadarrMediaSettings,
  sonarr_media_settings: serializeSonarrMediaSettings,
  lidarr_media_settings: serializeLidarrMediaSettings,
  radarr_quality_definitions: serializeRadarrQualityDefinitions,
  sonarr_quality_definitions: serializeSonarrQualityDefinitions,
  lidarr_quality_definitions: serializeLidarrQualityDefinitions,
  lidarr_metadata_profile: serializeLidarrMetadataProfile,
} as const;

function normalizeOutputFormat(format: PortableMigrationFormat | string): PortableMigrationFormat {
  if (format !== 'json' && format !== 'yaml') {
    throw new ConverterConfigError(`Unsupported output format: ${format}`);
  }

  return format;
}

function normalizeOutputDir(outputDir: string): string {
  const trimmed = outputDir.trim();
  if (!trimmed) {
    throw new ConverterConfigError('outputDir must be a non-empty string');
  }

  return trimTrailingSeparators(trimmed);
}

function trimLeadingSeparators(value: string): string {
  return value.replace(/^[\\/]+/u, '');
}

function trimTrailingSeparators(value: string): string {
  if (value === '/' || value === '\\') {
    return value;
  }

  return value.replace(/[\\/]+$/u, '');
}

function joinManagedPath(outputDir: string, relativePath: string): string {
  return `${trimTrailingSeparators(outputDir)}/${trimLeadingSeparators(relativePath)}`;
}

function resolveOutputExtension(format: PortableMigrationFormat): 'json' | 'yaml' {
  return format === 'json' ? 'json' : 'yaml';
}

function resolveMigrationMetadata(format: PortableMigrationFormat): {
  format: PortableMigrationFormat;
  version: number;
  source: string;
} {
  return {
    format,
    version: PORTABLE_MIGRATION_MIN_VERSION,
    source: PORTABLE_MIGRATION_SOURCE_EXPORT,
  };
}

function toFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPortablePayload(value: unknown): value is SerializableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return true;
}

function formatEntityPayloadForJson(
  portable: SerializableRecord,
  metadata: {
    readonly format: PortableMigrationFormat;
    readonly version: number;
    readonly source: string;
  } | null
): string {
  if (Object.hasOwn(portable, 'migration')) {
    throw new Error('portable payload must not include top-level migration metadata');
  }

  const payload = {};
  if (metadata) {
    (payload as Record<string, unknown>).migration = metadata;
  }

  for (const [key, value] of Object.entries(portable)) {
    if (key === 'migration') {
      throw new Error('portable payload must not include top-level migration metadata');
    }

    (payload as Record<string, unknown>)[key] = value;
  }

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function formatEntityPayload(
  portable: SerializableRecord,
  format: PortableMigrationFormat,
  includeMigrationMetadata: boolean
): string {
  if (format === 'yaml') {
    const migration = includeMigrationMetadata ? resolveMigrationMetadata(format) : null;
    return formatDeterministicYaml(portable, migration === null ? undefined : { migration });
  }

  const metadata = includeMigrationMetadata ? resolveMigrationMetadata(format) : null;
  return formatEntityPayloadForJson(portable, metadata);
}

function initializeSummaries(
  descriptors: readonly EnumeratedMigrationEntityDescriptor[]
): Map<EntityType, ConvertEntitySummary> {
  const summaries = new Map<EntityType, ConvertEntitySummary>();

  for (const descriptor of descriptors) {
    const current = summaries.get(descriptor.entityType);
    const relativeDir = ENTITY_DIRECTORY_BY_TYPE[descriptor.entityType];
    if (!current) {
      summaries.set(descriptor.entityType, {
        entityType: descriptor.entityType,
        relativeDir,
        total: 1,
        written: 0,
        failed: 0,
      });
      continue;
    }

    summaries.set(descriptor.entityType, {
      ...current,
      total: current.total + 1,
    });
  }

  return summaries;
}

function markSummary(
  summaries: Map<EntityType, ConvertEntitySummary>,
  entityType: EntityType,
  status: 'written' | 'failed'
): void {
  const summary = summaries.get(entityType);
  if (!summary) return;

  if (status === 'written') {
    summaries.set(entityType, {
      ...summary,
      written: summary.written + 1,
    });
    return;
  }

  summaries.set(entityType, {
    ...summary,
    failed: summary.failed + 1,
  });
}

function toSortedSummaries(summaries: Map<EntityType, ConvertEntitySummary>): ConvertEntitySummary[] {
  const values = [...summaries.values()];
  values.sort((a, b) => {
    const dirDiff = a.relativeDir.localeCompare(b.relativeDir);
    return dirDiff !== 0 ? dirDiff : a.entityType.localeCompare(b.entityType);
  });

  return values;
}

function countReportValues(summaries: readonly ConvertEntitySummary[]): {
  total: number;
  written: number;
  failed: number;
} {
  return summaries.reduce(
    (acc, summary) => ({
      total: acc.total + summary.total,
      written: acc.written + summary.written,
      failed: acc.failed + summary.failed,
    }),
    { total: 0, written: 0, failed: 0 }
  );
}

async function ensureOutputDirectory(outputDir: string, overwrite: boolean): Promise<void> {
  const info = await getPathInfo(outputDir);
  if (info === 'file') {
    throw new ConverterConfigError(`outputDir exists but is not a directory: ${outputDir}`);
  }

  if (info === 'directory' && !overwrite) {
    throw new ConverterConfigError(`outputDir already exists and overwrite is disabled: ${outputDir}`);
  }

  if (info === 'directory') return;

  await Deno.mkdir(outputDir, { recursive: true });
}

type PathType = 'missing' | 'file' | 'directory';

async function getPathInfo(path: string): Promise<PathType> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory ? 'directory' : 'file';
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return 'missing';
    }

    throw error;
  }
}

export class ConverterConfigError extends Error {
  constructor(
    message: string,
    public readonly path?: string
  ) {
    super(message);
    this.name = 'ConverterConfigError';
  }
}

export class ConverterSerializationError extends Error {
  constructor(
    message: string,
    public readonly failures: readonly ConverterFailure[],
    public readonly report: ConvertReport
  ) {
    super(message);
    this.name = 'ConverterSerializationError';
  }
}

export class ConverterWriteError extends Error {
  constructor(
    message: string,
    public readonly failures: readonly ConverterFailure[],
    public readonly report: ConvertReport
  ) {
    super(message);
    this.name = 'ConverterWriteError';
  }
}

/**
 * Convert all (or a filtered subset of) entities from a compiled PCD cache to portable files on disk.
 *
 * Serializes each entity using its registered serializer, formats the payload as JSON or YAML, and
 * writes it to `outputDir/<entityFamily>/<slug>.<ext>`. Throws on config errors, serialization
 * failures, or write failures, each including a partial `ConvertReport`.
 *
 * @param options - Conversion options including cache, output dir, format, overwrite flag, and entity filter
 * @returns A full report of written, failed, and total files per entity type
 * @throws {ConverterConfigError} When the output directory cannot be prepared
 * @throws {ConverterSerializationError} When one or more entities fail to serialize or format
 * @throws {ConverterWriteError} When one or more entity files cannot be written to disk
 */
export async function convertCompiledCacheToEntities(options: ConvertOptions): Promise<ConvertReport> {
  const outputDir = normalizeOutputDir(options.outputDir);
  const format = normalizeOutputFormat(options.format);
  const overwrite = options.overwrite;
  const cache = options.cache;

  if (!cache.isBuilt()) {
    throw new ConverterConfigError('Provided cache must be fully built before conversion');
  }

  const descriptors = enumerateMigrationEntities(cache, {
    entityTypes: options.entityTypes,
  });

  const summaries = initializeSummaries(descriptors);
  const serializationsFailures: ConverterFailure[] = [];
  const writeFailures: ConverterFailure[] = [];
  const slugCacheByDirectory = new Map<string, Set<string>>();

  try {
    await ensureOutputDirectory(outputDir, overwrite);
  } catch (error) {
    const summary = toSortedSummaries(summaries);
    const counts = countReportValues(summary);
    const report: ConvertReport = {
      outputDir,
      format,
      overwrite,
      includeMigrationMetadata: options.includeMigrationMetadata,
      entitySummaries: summary,
      totalFiles: counts.total,
      writtenFiles: 0,
      failedFiles: 0,
    };

    if (error instanceof ConverterConfigError) {
      throw error;
    }

    throw new ConverterWriteError(`Failed to prepare output directory ${outputDir}`, [], report);
  }

  for (const descriptor of descriptors) {
    const relativeDir = ENTITY_DIRECTORY_BY_TYPE[descriptor.entityType];
    const outputDirectory = joinManagedPath(outputDir, relativeDir);
    const existingSlugs = slugCacheByDirectory.get(relativeDir) ?? new Set<string>();

    let portable: SerializableRecord;
    try {
      const serializer = ENTITY_SERIALIZERS[descriptor.entityType];
      const rawPayload = await serializer(cache, descriptor.entityName);
      if (!isPortablePayload(rawPayload)) {
        throw new Error('Serializer did not return a portable object payload');
      }
      portable = rawPayload;
    } catch (error) {
      const message = toFailure(error);
      const relativePath = `${relativeDir}/${descriptor.entityName}`;
      const failure: ConverterFailure = {
        entityType: descriptor.entityType,
        entityName: descriptor.entityName,
        stableIdentity: descriptor.stableIdentity,
        stage: 'serialize',
        path: relativePath,
        message,
      };
      serializationsFailures.push(failure);
      markSummary(summaries, descriptor.entityType, 'failed');
      continue;
    }

    let payload: string;
    try {
      payload = formatEntityPayload(portable, format, options.includeMigrationMetadata);
    } catch (error) {
      const message = toFailure(error);
      const relativePath = `${relativeDir}/${descriptor.entityName}`;
      const failure: ConverterFailure = {
        entityType: descriptor.entityType,
        entityName: descriptor.entityName,
        stableIdentity: descriptor.stableIdentity,
        stage: 'format',
        path: relativePath,
        message,
      };
      serializationsFailures.push(failure);
      markSummary(summaries, descriptor.entityType, 'failed');
      continue;
    }

    const slug = resolveEntitySlug(descriptor.entityName, existingSlugs);
    existingSlugs.add(slug);
    slugCacheByDirectory.set(relativeDir, existingSlugs);

    const fileName = `${slug}.${resolveOutputExtension(format)}`;
    const relativePath = `${relativeDir}/${fileName}`;
    const filePath = joinManagedPath(outputDir, relativePath);

    try {
      await Deno.mkdir(outputDirectory, { recursive: true });
      await Deno.writeTextFile(filePath, payload);
    } catch (error) {
      const failure: ConverterFailure = {
        entityType: descriptor.entityType,
        entityName: descriptor.entityName,
        stableIdentity: descriptor.stableIdentity,
        stage: 'write',
        path: relativePath,
        message: toFailure(error),
      };
      writeFailures.push(failure);
      markSummary(summaries, descriptor.entityType, 'failed');
      continue;
    }

    markSummary(summaries, descriptor.entityType, 'written');
  }

  const sortedSummaries = toSortedSummaries(summaries);
  const counts = countReportValues(sortedSummaries);
  const report: ConvertReport = {
    outputDir,
    format,
    overwrite,
    includeMigrationMetadata: options.includeMigrationMetadata,
    entitySummaries: sortedSummaries,
    totalFiles: counts.total,
    writtenFiles: counts.written,
    failedFiles: counts.failed,
  };

  if (serializationsFailures.length > 0) {
    throw new ConverterSerializationError(
      `Failed to serialize ${serializationsFailures.length} entities`,
      serializationsFailures,
      report
    );
  }

  if (writeFailures.length > 0) {
    throw new ConverterWriteError(`Failed to write ${writeFailures.length} entity files`, writeFailures, report);
  }

  return report;
}
