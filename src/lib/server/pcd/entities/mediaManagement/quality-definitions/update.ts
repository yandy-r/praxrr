/**
 * Quality definitions update operations
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import type { QualityDefinitionEntry, QualityDefinitionsConfig } from '$shared/pcd/display.ts';
import {
  getQualityApiMappings,
  getQualityDefinitionsStorage,
} from '$pcd/entities/mediaManagement/quality-definitions/read.ts';

type QualityDefinitionsType = 'radarr' | 'sonarr' | 'lidarr';

const QUALITY_DEFINITION_UNMAPPED_ERROR_PREFIX = 'Unsupported quality names for quality definitions';
const QUALITY_DEFINITION_DUPLICATE_QUALITIES_ERROR = 'Quality definitions cannot contain duplicate quality names';

type QualityDefinitionsBadRequestCode =
  | 'quality_definitions_duplicate_qualities'
  | 'quality_definitions_duplicate_name'
  | 'quality_definitions_unmapped';

interface QualityDefinitionsBadRequestError extends Error {
  status: 400;
  code: QualityDefinitionsBadRequestCode;
}

export interface UpdateQualityDefinitionsInput {
  name: string;
  entries: QualityDefinitionEntry[];
}

export interface UpdateQualityDefinitionsOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  current: QualityDefinitionsConfig;
  input: UpdateQualityDefinitionsInput;
}

export function updateRadarrQualityDefinitions(options: UpdateQualityDefinitionsOptions) {
  return updateQualityDefinitions(options, 'radarr');
}

export function updateSonarrQualityDefinitions(options: UpdateQualityDefinitionsOptions) {
  return updateQualityDefinitions(options, 'sonarr');
}

export function updateLidarrQualityDefinitions(options: UpdateQualityDefinitionsOptions) {
  return updateQualityDefinitions(options, 'lidarr');
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

async function updateQualityDefinitions(
  options: UpdateQualityDefinitionsOptions,
  qualityDefinitionsType: QualityDefinitionsType
) {
  const { databaseId, cache, layer, current, input } = options;
  const db = cache.kb;
  const storageType = getQualityDefinitionsStorage(qualityDefinitionsType);
  // Lidarr shares Sonarr-backed identity; duplicate checks must collide with Sonarr names.
  const storageIdentityForDuplicates = storageType === 'radarr' ? 'radarr' : 'sonarr';
  const displayType =
    qualityDefinitionsType === 'radarr' ? 'Radarr' : qualityDefinitionsType === 'sonarr' ? 'Sonarr' : 'Lidarr';

  ensureUniqueEntries(input.entries);
  await ensureMappedEntries(cache, qualityDefinitionsType, input.entries);

  // If renaming, check if new name already exists
  if (input.name !== current.name) {
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
      throw createBadRequestError(
        `A ${storageIdentityForDuplicates} quality definitions config with name "${input.name}" already exists`,
        'quality_definitions_duplicate_name'
      );
    }
  }

  if (isSameEntries(current.entries, input.entries) && current.name === input.name) {
    return { success: true };
  }

  const queries = [];
  const entriesToDelete =
    qualityDefinitionsType === 'lidarr'
      ? await db
          .selectFrom('sonarr_quality_definitions')
          .where('name', '=', current.name)
          .select(['quality_name', 'min_size', 'max_size', 'preferred_size'])
          .execute()
      : current.entries;

  // Delete existing entries with value guards
  for (const entry of entriesToDelete) {
    if (storageType === 'radarr') {
      queries.push(
        db
          .deleteFrom('radarr_quality_definitions')
          .where('name', '=', current.name)
          .where('quality_name', '=', entry.quality_name)
          .where('min_size', '=', entry.min_size)
          .where('max_size', '=', entry.max_size)
          .where('preferred_size', '=', entry.preferred_size)
          .compile()
      );
    } else {
      queries.push(
        db
          .deleteFrom('sonarr_quality_definitions')
          .where('name', '=', current.name)
          .where('quality_name', '=', entry.quality_name)
          .where('min_size', '=', entry.min_size)
          .where('max_size', '=', entry.max_size)
          .where('preferred_size', '=', entry.preferred_size)
          .compile()
      );
    }
  }

  // Insert all new entries
  for (const entry of input.entries) {
    if (storageType === 'radarr') {
      queries.push(
        db
          .insertInto('radarr_quality_definitions')
          .values({
            name: input.name,
            quality_name: entry.quality_name,
            min_size: entry.min_size,
            max_size: entry.max_size,
            preferred_size: entry.preferred_size,
          })
          .compile()
      );
    } else {
      queries.push(
        db
          .insertInto('sonarr_quality_definitions')
          .values({
            name: input.name,
            quality_name: entry.quality_name,
            min_size: entry.min_size,
            max_size: entry.max_size,
            preferred_size: entry.preferred_size,
          })
          .compile()
      );
    }
  }

  const changedFields: string[] = [];
  const desiredState: Record<string, unknown> = {};
  if (current.name !== input.name) {
    changedFields.push('name');
    desiredState.name = { from: current.name, to: input.name };
  }
  if (!isSameEntries(current.entries, input.entries)) {
    changedFields.push('entries');
    desiredState.entries = { from: current.entries, to: input.entries };
  }

  return writeOperation({
    databaseId,
    layer,
    description: `update-${qualityDefinitionsType}-quality-definitions-${input.name}`,
    queries,
    desiredState,
    metadata: {
      operation: 'update',
      entity: storageType === 'radarr' ? 'radarr_quality_definitions' : 'sonarr_quality_definitions',
      name: input.name,
      ...(current.name !== input.name && { previousName: current.name }),
      stableKey: {
        key: storageType === 'radarr' ? 'radarr_quality_definitions_name' : 'sonarr_quality_definitions_name',
        value: current.name,
      },
      changedFields,
      summary: `Update ${displayType} quality definitions`,
      title: `Update ${displayType} quality definitions "${input.name}"`,
    },
  });
}

function isSameEntries(current: QualityDefinitionEntry[], next: QualityDefinitionEntry[]): boolean {
  const normalize = (entries: QualityDefinitionEntry[]) =>
    entries
      .map((entry) => ({
        quality_name: entry.quality_name,
        min_size: entry.min_size,
        max_size: entry.max_size,
        preferred_size: entry.preferred_size,
      }))
      .sort((a, b) => a.quality_name.localeCompare(b.quality_name));

  return JSON.stringify(normalize(current)) === JSON.stringify(normalize(next));
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
