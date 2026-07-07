/**
 * Quality definitions create operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { type OperationLayer, writeOperation } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { QualityDefinitionEntry } from '$shared/pcd/display.ts';
import {
  getQualityApiMappings,
  getQualityDefinitionsStorage,
} from '$pcd/entities/mediaManagement/quality-definitions/read.ts';

type QualityDefinitionsType = 'radarr' | 'sonarr' | 'lidarr';

const QUALITY_DEFINITION_UNMAPPED_ERROR_PREFIX = 'Unsupported quality names for quality definitions';
const QUALITY_DEFINITION_DUPLICATE_QUALITIES_ERROR = 'Quality definitions cannot contain duplicate quality names';

type QualityDefinitionsBadRequestCode =
  'quality_definitions_duplicate_qualities' | 'quality_definitions_duplicate_name' | 'quality_definitions_unmapped';

interface QualityDefinitionsBadRequestError extends Error {
  status: 400;
  code: QualityDefinitionsBadRequestCode;
}

export interface CreateQualityDefinitionsInput {
  name: string;
  entries: QualityDefinitionEntry[];
}

export interface CreateQualityDefinitionsOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  input: CreateQualityDefinitionsInput;
}

export function createRadarrQualityDefinitions(options: CreateQualityDefinitionsOptions) {
  return createQualityDefinitions(options, 'radarr');
}

export function createSonarrQualityDefinitions(options: CreateQualityDefinitionsOptions) {
  return createQualityDefinitions(options, 'sonarr');
}

export function createLidarrQualityDefinitions(options: CreateQualityDefinitionsOptions) {
  return createQualityDefinitions(options, 'lidarr');
}

function createBadRequestError(
  message: string,
  code: QualityDefinitionsBadRequestCode
): QualityDefinitionsBadRequestError {
  const err = new Error(message) as QualityDefinitionsBadRequestError;
  err.status = 400;
  err.code = code;
  return err;
}

function formatUnmappedError(qualityDefinitionsType: QualityDefinitionsType, unmappedEntries: string[]): string {
  return `${QUALITY_DEFINITION_UNMAPPED_ERROR_PREFIX} for ${qualityDefinitionsType}: ${unmappedEntries.join(', ')}`;
}

async function createQualityDefinitions(
  options: CreateQualityDefinitionsOptions,
  qualityDefinitionsType: QualityDefinitionsType
) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;
  const storageType = getQualityDefinitionsStorage(qualityDefinitionsType);
  const storageIdentityForDuplicates = storageType;
  const displayType =
    qualityDefinitionsType === 'radarr' ? 'Radarr' : qualityDefinitionsType === 'sonarr' ? 'Sonarr' : 'Lidarr';

  ensureUniqueEntries(input.entries);
  await ensureMappedEntries(cache, qualityDefinitionsType, input.entries);

  // Check if name already exists
  let existing: { name: string } | undefined;
  if (storageType === 'radarr') {
    existing = await db
      .selectFrom('radarr_quality_definitions')
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();
  } else if (storageType === 'sonarr') {
    existing = await db
      .selectFrom('sonarr_quality_definitions')
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();
  } else {
    existing = await db
      .selectFrom('lidarr_quality_definitions' as keyof PCDDatabase)
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();
  }

  if (existing) {
    throw createBadRequestError(
      `A ${storageIdentityForDuplicates} quality definitions config with name "${input.name}" already exists`,
      'quality_definitions_duplicate_name'
    );
  }

  const queries = input.entries.map((entry) => {
    if (storageType === 'radarr') {
      return db
        .insertInto('radarr_quality_definitions')
        .values({
          name: input.name,
          quality_name: entry.quality_name,
          min_size: entry.min_size,
          max_size: entry.max_size,
          preferred_size: entry.preferred_size,
        })
        .compile();
    }

    if (storageType === 'sonarr') {
      return db
        .insertInto('sonarr_quality_definitions')
        .values({
          name: input.name,
          quality_name: entry.quality_name,
          min_size: entry.min_size,
          max_size: entry.max_size,
          preferred_size: entry.preferred_size,
        })
        .compile();
    }

    return db
      .insertInto('lidarr_quality_definitions' as keyof PCDDatabase)
      .values({
        name: input.name,
        quality_name: entry.quality_name,
        min_size: entry.min_size,
        max_size: entry.max_size,
        preferred_size: entry.preferred_size,
      })
      .compile();
  });

  return writeOperation({
    databaseId,
    layer,
    description: `create-${qualityDefinitionsType}-quality-definitions-${input.name}`,
    queries,
    desiredState: {
      name: input.name,
      entries: input.entries,
    },
    metadata: {
      operation: 'create',
      entity:
        storageType === 'radarr'
          ? 'radarr_quality_definitions'
          : storageType === 'sonarr'
            ? 'sonarr_quality_definitions'
            : 'lidarr_quality_definitions',
      name: input.name,
      stableKey: {
        key:
          storageType === 'radarr'
            ? 'radarr_quality_definitions_name'
            : storageType === 'sonarr'
              ? 'sonarr_quality_definitions_name'
              : 'lidarr_quality_definitions_name',
        value: input.name,
      },
      summary: `Create ${displayType} quality definitions`,
      title: `Create ${displayType} quality definitions "${input.name}"`,
    },
  });
}

async function ensureMappedEntries(
  cache: PCDCache,
  qualityDefinitionsType: QualityDefinitionsType,
  entries: QualityDefinitionEntry[]
) {
  const { qualityToApiName } = await getQualityApiMappings(cache, qualityDefinitionsType);
  const unmappedEntries: string[] = [];
  const seenQualityNames = new Set<string>();

  for (const entry of entries) {
    const qualityName = entry.quality_name.trim();
    const normalizedQualityName = qualityName.toLowerCase();
    if (qualityToApiName.has(normalizedQualityName)) {
      continue;
    }

    if (!seenQualityNames.has(normalizedQualityName)) {
      unmappedEntries.push(qualityName);
      seenQualityNames.add(normalizedQualityName);
    }
  }

  if (unmappedEntries.length > 0) {
    unmappedEntries.sort((a, b) => a.localeCompare(b));
    throw createBadRequestError(
      formatUnmappedError(qualityDefinitionsType, unmappedEntries),
      'quality_definitions_unmapped'
    );
  }
}

function ensureUniqueEntries(entries: QualityDefinitionEntry[]) {
  const normalized = entries.map((entry) => entry.quality_name.trim().toLowerCase());
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw createBadRequestError(
      QUALITY_DEFINITION_DUPLICATE_QUALITIES_ERROR,
      'quality_definitions_duplicate_qualities'
    );
  }
}
