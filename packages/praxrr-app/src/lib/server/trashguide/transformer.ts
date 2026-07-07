import type { ConditionData } from '$shared/pcd/display.ts';
import type {
  PortableCustomFormat,
  PortableQualityDefinitions,
  PortableQualityProfile,
  PortableRadarrNaming,
  PortableSonarrNaming,
} from '$shared/pcd/portable.ts';
import type {
  TrashIdMapping,
  TrashIdMappingEntityType,
  TrashIdMappingInput,
  TrashIdMappingRename,
} from '$db/queries/trashIdMappings.ts';
import type {
  TrashGuideCustomFormatEntity,
  TrashGuideCustomFormatSpecification,
  TrashGuideEntityType,
  TrashGuideParseResult,
  TrashGuideParsedEntity,
  TrashGuideSupportedArrType,
} from './types.ts';
import {
  type TrashGuideQualityProfileTransformContext,
  toPortableQualityDefinitions,
  toPortableQualityProfile,
} from './transformers/qualityProfiles.ts';
import { toPortableNaming } from './transformers/mediaManagement.ts';

export type TrashGuideTransformErrorCode =
  'arr_type_mismatch' | 'identity_collision' | 'unsupported_spec_implementation' | 'ambiguous_mapping';

export class TrashGuideTransformError extends Error {
  readonly code: TrashGuideTransformErrorCode;

  constructor(code: TrashGuideTransformErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TrashGuideTransformError';
    this.code = code;
  }
}

export interface TrashGuideTransformInput {
  sourceId: number;
  arrType: TrashGuideSupportedArrType;
  parsed: TrashGuideParseResult;
  existingMappings?: readonly TrashIdMapping[];
}

export interface TrashGuideTransformIdentity {
  sourceId: number;
  arrType: TrashGuideSupportedArrType;
  entityType: TrashGuideEntityType;
  trashId: string;
  entityName: string;
}

export type TrashGuideTransformedOperation =
  | {
      identity: TrashGuideTransformIdentity;
      previousName: string | null;
      portableEntityType: 'custom_format';
      data: PortableCustomFormat;
    }
  | {
      identity: TrashGuideTransformIdentity;
      previousName: string | null;
      portableEntityType: 'quality_profile';
      data: PortableQualityProfile;
    }
  | {
      identity: TrashGuideTransformIdentity;
      previousName: string | null;
      portableEntityType: 'radarr_quality_definitions' | 'sonarr_quality_definitions';
      data: PortableQualityDefinitions;
    }
  | {
      identity: TrashGuideTransformIdentity;
      previousName: string | null;
      portableEntityType: 'radarr_naming';
      data: PortableRadarrNaming;
    }
  | {
      identity: TrashGuideTransformIdentity;
      previousName: string | null;
      portableEntityType: 'sonarr_naming';
      data: PortableSonarrNaming;
    };

export interface TrashGuideRemovedEntity {
  identity: TrashGuideTransformIdentity;
  reason: 'upstream_deleted';
}

export interface TrashGuideSkippedEntity {
  identity: TrashGuideTransformIdentity;
  reason: 'unsupported_entity_type';
}

export interface TrashGuideTransformResult {
  activeOperations: readonly TrashGuideTransformedOperation[];
  removedEntities: readonly TrashGuideRemovedEntity[];
  renamedEntities: readonly TrashIdMappingRename[];
  skippedEntities: readonly TrashGuideSkippedEntity[];
  mappingWrites: readonly TrashIdMappingInput[];
}

interface UniqueEntityEntry {
  entity: TrashGuideParsedEntity;
  signature: string;
}

const TRANSFORMABLE_ENTITY_TYPES: ReadonlySet<TrashGuideEntityType> = new Set<TrashGuideEntityType>([
  'custom_format',
  'custom_format_group',
  'quality_profile',
  'quality_size',
  'naming',
]);

const ENTITY_TYPE_ORDER: Record<TrashGuideEntityType, number> = {
  custom_format: 0,
  custom_format_group: 1,
  quality_profile: 2,
  quality_size: 3,
  naming: 4,
};

export function transformTrashGuideEntities(input: TrashGuideTransformInput): TrashGuideTransformResult {
  if (input.parsed.arr_type !== input.arrType) {
    throw new TrashGuideTransformError(
      'arr_type_mismatch',
      `Transformer arr_type "${input.arrType}" does not match parsed arr_type "${input.parsed.arr_type}"`
    );
  }

  const existing = (input.existingMappings ?? []).filter(
    (row) => row.sourceId === input.sourceId && row.arrType === input.arrType
  );
  const existingByKey = new Map<string, TrashIdMapping>();
  for (const row of existing) {
    existingByKey.set(buildIdentityKey(row.entityType, row.trashId), row);
  }

  const uniqueEntries = dedupeAndValidateEntities(input.parsed.ordered_entities, input.arrType);
  const customFormatsByTrashId = buildCustomFormatLookup(uniqueEntries);
  const customFormatsByName = buildCustomFormatLookupByName(uniqueEntries);
  const qualityProfileContext: TrashGuideQualityProfileTransformContext = {
    arrType: input.arrType,
    customFormatsByTrashId,
    customFormatsByName,
  };

  const mappingWrites = uniqueEntries
    .map((entry) => toMappingInput(input.sourceId, input.arrType, entry.entity))
    .sort(compareMappings);
  const mappingKeys = new Set(mappingWrites.map((row) => buildIdentityKey(row.entityType, row.trashId)));

  const renamedEntities = mappingWrites
    .flatMap((row) => {
      const key = buildIdentityKey(row.entityType, row.trashId);
      const prev = existingByKey.get(key);
      if (!prev || prev.entityName === row.entityName) {
        return [];
      }

      return [
        {
          sourceId: row.sourceId,
          arrType: row.arrType,
          entityType: row.entityType,
          trashId: row.trashId,
          previousName: prev.entityName,
          nextName: row.entityName,
        } satisfies TrashIdMappingRename,
      ];
    })
    .sort((a, b) => {
      if (a.entityType !== b.entityType) {
        return compareEntityTypes(a.entityType, b.entityType);
      }
      return a.trashId.localeCompare(b.trashId);
    });

  const removedEntities = existing
    .filter((row) => !mappingKeys.has(buildIdentityKey(row.entityType, row.trashId)))
    .map(
      (row) =>
        ({
          identity: {
            sourceId: row.sourceId,
            arrType: row.arrType,
            entityType: row.entityType,
            trashId: row.trashId,
            entityName: row.entityName,
          },
          reason: 'upstream_deleted',
        }) satisfies TrashGuideRemovedEntity
    )
    .sort(compareByIdentity);

  const activeOperations: TrashGuideTransformedOperation[] = [];
  const skippedEntities: TrashGuideSkippedEntity[] = [];

  for (const { entity } of uniqueEntries) {
    const identity: TrashGuideTransformIdentity = {
      sourceId: input.sourceId,
      arrType: input.arrType,
      entityType: entity.entity_type,
      trashId: entity.trash_id,
      entityName: entity.name,
    };

    if (!TRANSFORMABLE_ENTITY_TYPES.has(entity.entity_type)) {
      skippedEntities.push({
        identity,
        reason: 'unsupported_entity_type',
      });
      continue;
    }

    const previous = existingByKey.get(buildIdentityKey(entity.entity_type, entity.trash_id));

    try {
      switch (entity.entity_type) {
        case 'custom_format':
          activeOperations.push({
            identity,
            previousName: previous?.entityName ?? null,
            portableEntityType: 'custom_format',
            data: toPortableCustomFormat(entity),
          });
          break;
        case 'custom_format_group':
          // CF groups are metadata-only entities used by the score simulator.
          // They don't produce portable operations but are cached for runtime use.
          break;
        case 'quality_profile':
          activeOperations.push({
            identity,
            previousName: previous?.entityName ?? null,
            portableEntityType: 'quality_profile',
            data: toPortableQualityProfile(entity, qualityProfileContext),
          });
          break;
        case 'quality_size': {
          const transformed = toPortableQualityDefinitions(entity, input.arrType);
          activeOperations.push({
            identity,
            previousName: previous?.entityName ?? null,
            portableEntityType: transformed.portableEntityType,
            data: transformed.data,
          });
          break;
        }
        case 'naming': {
          const transformed = toPortableNaming(entity, input.arrType);
          if (transformed.portableEntityType === 'radarr_naming') {
            activeOperations.push({
              identity,
              previousName: previous?.entityName ?? null,
              portableEntityType: 'radarr_naming',
              data: transformed.data,
            });
          } else {
            activeOperations.push({
              identity,
              previousName: previous?.entityName ?? null,
              portableEntityType: 'sonarr_naming',
              data: transformed.data,
            });
          }
          break;
        }
        default: {
          const exhaustiveCheck: never = entity;
          throw new Error(`Unsupported transform mapping for entity "${JSON.stringify(exhaustiveCheck)}"`);
        }
      }
    } catch (error) {
      if (error instanceof TrashGuideTransformError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : `Unknown transformer failure: ${String(error)}`;
      throw new TrashGuideTransformError('ambiguous_mapping', message, { cause: error });
    }
  }

  activeOperations.sort((a, b) => compareByIdentity(a, b));
  skippedEntities.sort(compareByIdentity);

  return {
    activeOperations,
    removedEntities,
    renamedEntities,
    skippedEntities,
    mappingWrites,
  };
}

function dedupeAndValidateEntities(
  entities: readonly TrashGuideParsedEntity[],
  arrType: TrashGuideSupportedArrType
): UniqueEntityEntry[] {
  const entriesByKey = new Map<string, UniqueEntityEntry>();

  for (const entity of entities) {
    if (entity.arr_type !== arrType) {
      throw new TrashGuideTransformError(
        'arr_type_mismatch',
        `Entity arr_type "${entity.arr_type}" does not match transform arr_type "${arrType}" for ${entity.entity_type}:${entity.trash_id}`
      );
    }

    const key = buildIdentityKey(entity.entity_type, entity.trash_id);
    const signature = getEntitySignature(entity);
    const existing = entriesByKey.get(key);
    if (!existing) {
      entriesByKey.set(key, { entity, signature });
      continue;
    }

    if (existing.signature !== signature) {
      throw new TrashGuideTransformError(
        'identity_collision',
        `TRaSH identity collision for ${entity.entity_type}:${entity.trash_id} in arr_type "${arrType}" between "${existing.entity.file_path}" and "${entity.file_path}"`
      );
    }
  }

  return [...entriesByKey.values()].sort((a, b) => compareByIdentity(a.entity, b.entity));
}

function buildCustomFormatLookup(
  entries: readonly UniqueEntityEntry[]
): ReadonlyMap<string, TrashGuideCustomFormatEntity> {
  const customFormatsByTrashId = new Map<string, TrashGuideCustomFormatEntity>();
  for (const { entity } of entries) {
    if (entity.entity_type !== 'custom_format') {
      continue;
    }
    customFormatsByTrashId.set(entity.trash_id.toLowerCase(), entity);
  }
  return customFormatsByTrashId;
}

function buildCustomFormatLookupByName(
  entries: readonly UniqueEntityEntry[]
): ReadonlyMap<string, readonly TrashGuideCustomFormatEntity[]> {
  const customFormatsByName = new Map<string, TrashGuideCustomFormatEntity[]>();
  for (const { entity } of entries) {
    if (entity.entity_type !== 'custom_format') {
      continue;
    }

    const key = entity.name.trim().toLowerCase();
    const existing = customFormatsByName.get(key);
    if (existing) {
      existing.push(entity);
      continue;
    }
    customFormatsByName.set(key, [entity]);
  }
  return customFormatsByName;
}

function toMappingInput(
  sourceId: number,
  arrType: TrashGuideSupportedArrType,
  entity: TrashGuideParsedEntity
): TrashIdMappingInput {
  return {
    sourceId,
    arrType,
    entityType: toMappingEntityType(entity.entity_type),
    trashId: entity.trash_id,
    entityName: entity.name,
  };
}

function toMappingEntityType(entityType: TrashGuideEntityType): TrashIdMappingEntityType {
  if (
    entityType === 'custom_format' ||
    entityType === 'custom_format_group' ||
    entityType === 'quality_profile' ||
    entityType === 'quality_size' ||
    entityType === 'naming'
  ) {
    return entityType;
  }

  const exhaustiveCheck: never = entityType;
  throw new Error(`Unsupported TRaSH entity type: ${exhaustiveCheck}`);
}

function toPortableCustomFormat(entity: TrashGuideParsedEntity): PortableCustomFormat {
  if (entity.entity_type !== 'custom_format') {
    throw new Error(`Unsupported transform mapping for entity type "${entity.entity_type}"`);
  }

  const conditions = entity.specifications.map((spec) => toConditionData(entity, spec));

  return {
    name: entity.name,
    description: entity.description,
    includeInRename: entity.include_in_rename,
    tags: [],
    conditions,
    tests: [],
  };
}

function toConditionData(
  entity: TrashGuideCustomFormatEntity,
  spec: TrashGuideCustomFormatSpecification
): ConditionData {
  const normalizedType = mapSpecificationImplementation(spec.implementation);
  const base: ConditionData = {
    name: spec.name,
    type: normalizedType,
    arrType: entity.arr_type,
    negate: spec.negate,
    required: spec.required,
  };

  switch (normalizedType) {
    case 'release_title':
    case 'edition':
    case 'release_group':
      return {
        ...base,
        patterns: [
          {
            name: spec.name,
            pattern: readRequiredStringField(spec.fields, ['value', 'pattern', 'regex'], `${entity.name}:${spec.name}`),
          },
        ],
      };
    case 'language':
      return {
        ...base,
        languages: [
          {
            name: readRequiredStringField(spec.fields, ['value'], `${entity.name}:${spec.name}`, spec.name),
            except: readOptionalBooleanField(spec.fields, ['exceptLanguage'], false),
          },
        ],
      };
    case 'source':
      return {
        ...base,
        sources: [readRequiredStringField(spec.fields, ['value'], `${entity.name}:${spec.name}`, spec.name)],
      };
    case 'resolution':
      return {
        ...base,
        resolutions: [readRequiredStringField(spec.fields, ['value'], `${entity.name}:${spec.name}`, spec.name)],
      };
    case 'quality_modifier':
      return {
        ...base,
        qualityModifiers: [readRequiredStringField(spec.fields, ['value'], `${entity.name}:${spec.name}`, spec.name)],
      };
    case 'release_type':
      return {
        ...base,
        releaseTypes: [readRequiredStringField(spec.fields, ['value'], `${entity.name}:${spec.name}`, spec.name)],
      };
    case 'indexer_flag':
      return {
        ...base,
        indexerFlags: [readRequiredStringField(spec.fields, ['value'], `${entity.name}:${spec.name}`, spec.name)],
      };
    case 'size':
      return {
        ...base,
        size: {
          minBytes: readOptionalNumberField(spec.fields, ['min', 'minSize', 'minimum']),
          maxBytes: readOptionalNumberField(spec.fields, ['max', 'maxSize', 'maximum']),
        },
      };
    case 'year':
      return {
        ...base,
        years: {
          minYear: readOptionalNumberField(spec.fields, ['min', 'minimum']),
          maxYear: readOptionalNumberField(spec.fields, ['max', 'maximum']),
        },
      };
  }

  throw new Error(`Unsupported normalized condition type: ${normalizedType}`);
}

function mapSpecificationImplementation(value: string): ConditionData['type'] {
  switch (value) {
    case 'ReleaseTitleSpecification':
      return 'release_title';
    case 'LanguageSpecification':
      return 'language';
    case 'SourceSpecification':
      return 'source';
    case 'ResolutionSpecification':
      return 'resolution';
    case 'QualityModifierSpecification':
      return 'quality_modifier';
    case 'ReleaseTypeSpecification':
      return 'release_type';
    case 'IndexerFlagSpecification':
      return 'indexer_flag';
    case 'SizeSpecification':
      return 'size';
    case 'YearSpecification':
      return 'year';
    case 'EditionSpecification':
      return 'edition';
    case 'ReleaseGroupSpecification':
      return 'release_group';
    default:
      throw new TrashGuideTransformError(
        'unsupported_spec_implementation',
        `Unsupported TRaSH specification implementation "${value}"`
      );
  }
}

function readRequiredStringField(
  fields: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  context: string,
  fallback?: string
): string {
  const fallbackValue = typeof fallback === 'string' ? fallback.trim() : '';
  const value = readOptionalStringField(fields, keys);
  if (value !== null) {
    return value;
  }

  if (fallbackValue.length > 0) {
    return fallbackValue;
  }

  throw new Error(`Missing required TRaSH specification string field (${keys.join(', ')}) for ${context}`);
}

function readOptionalStringField(fields: Readonly<Record<string, unknown>>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function readOptionalBooleanField(
  fields: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  defaultValue: boolean
): boolean {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return defaultValue;
}

function readOptionalNumberField(fields: Readonly<Record<string, unknown>>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function buildIdentityKey(entityType: TrashIdMappingEntityType, trashId: string): string {
  return `${entityType}:${trashId}`;
}

function compareMappings(a: TrashIdMappingInput, b: TrashIdMappingInput): number {
  if (a.entityType !== b.entityType) {
    return compareEntityTypes(a.entityType, b.entityType);
  }
  if (a.entityName !== b.entityName) {
    return a.entityName.localeCompare(b.entityName);
  }
  return a.trashId.localeCompare(b.trashId);
}

function compareByIdentity(
  a: { identity: TrashGuideTransformIdentity } | TrashGuideParsedEntity,
  b: { identity: TrashGuideTransformIdentity } | TrashGuideParsedEntity
): number {
  const left = 'identity' in a ? a.identity : toIdentityComparable(a);
  const right = 'identity' in b ? b.identity : toIdentityComparable(b);

  if (left.entityType !== right.entityType) {
    return compareEntityTypes(left.entityType, right.entityType);
  }
  if (left.entityName !== right.entityName) {
    return left.entityName.localeCompare(right.entityName);
  }
  return left.trashId.localeCompare(right.trashId);
}

function compareEntityTypes(
  a: TrashGuideEntityType | TrashIdMappingEntityType,
  b: TrashGuideEntityType | TrashIdMappingEntityType
): number {
  if (!isSortableEntityType(a) || !isSortableEntityType(b)) {
    const invalidTypes: string[] = [];
    if (!isSortableEntityType(a)) {
      invalidTypes.push(a);
    }
    if (!isSortableEntityType(b)) {
      invalidTypes.push(b);
    }
    throw new Error(`Unsupported TRaSH entity type for sorting: ${invalidTypes.join(', ')}`);
  }

  return ENTITY_TYPE_ORDER[a] - ENTITY_TYPE_ORDER[b];
}

function isSortableEntityType(value: string): value is TrashGuideEntityType {
  return Object.hasOwn(ENTITY_TYPE_ORDER, value);
}

function toIdentityComparable(entity: TrashGuideParsedEntity): TrashGuideTransformIdentity {
  return {
    sourceId: 0,
    arrType: entity.arr_type,
    entityType: entity.entity_type,
    trashId: entity.trash_id,
    entityName: entity.name,
  };
}

function getEntitySignature(entity: TrashGuideParsedEntity): string {
  const signaturePayload = deepSortValue({
    ...entity,
    file_path: undefined,
  });
  return JSON.stringify(signaturePayload);
}

function deepSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepSortValue(item));
  }

  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'file_path')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, deepSortValue(nested)] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}
