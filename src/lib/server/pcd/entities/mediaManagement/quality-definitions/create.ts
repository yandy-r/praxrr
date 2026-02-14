/**
 * Quality definitions create operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { QualityDefinitionEntry } from '$shared/pcd/display.ts';
import {
  getQualityApiMappings,
  getQualityDefinitionsStorage,
} from '$pcd/entities/mediaManagement/quality-definitions/read.ts';

type QualityDefinitionsType = 'radarr' | 'sonarr' | 'lidarr';

const QUALITY_DEFINITION_UNMAPPED_ERROR_PREFIX = 'Unsupported quality names for quality definitions';

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

async function createQualityDefinitions(
  options: CreateQualityDefinitionsOptions,
  qualityDefinitionsType: QualityDefinitionsType
) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;
  const storageType = getQualityDefinitionsStorage(qualityDefinitionsType);
  const configTypeForMessages = storageType === 'radarr' ? 'radarr' : 'sonarr';
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
  } else {
    existing = await db
      .selectFrom('sonarr_quality_definitions')
      .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
      .select('name')
      .executeTakeFirst();
  }

  if (existing) {
    throw new Error(`A ${configTypeForMessages} quality definitions config with name "${input.name}" already exists`);
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
      entity: storageType === 'radarr' ? 'radarr_quality_definitions' : 'sonarr_quality_definitions',
      name: input.name,
      stableKey: {
        key: storageType === 'radarr' ? 'radarr_quality_definitions_name' : 'sonarr_quality_definitions_name',
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
    throw new Error(
      `${QUALITY_DEFINITION_UNMAPPED_ERROR_PREFIX} for ${qualityDefinitionsType}: ${unmappedEntries.join(', ')}`
    );
  }
}

function ensureUniqueEntries(entries: QualityDefinitionEntry[]) {
  const normalized = entries.map((entry) => entry.quality_name.trim().toLowerCase());
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw new Error('Quality definitions cannot contain duplicate quality names');
  }
}
