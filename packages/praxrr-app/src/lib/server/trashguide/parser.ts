import {
  TRASHGUIDE_ENTITY_TYPES,
  TRASHGUIDE_SUPPORTED_ARR_TYPES,
  type TrashGuideCfGroupEntity,
  type TrashGuideCfGroupFormatItem,
  type TrashGuideCustomFormatEntity,
  type TrashGuideCustomFormatSpecification,
  type TrashGuideNamingEntity,
  type TrashGuideParseInput,
  type TrashGuideParseIssue,
  type TrashGuideParseResult,
  type TrashGuideParseStatus,
  type TrashGuideParsedEntities,
  type TrashGuideParsedEntity,
  type TrashGuideQualityProfileEntity,
  type TrashGuideQualityProfileFormatItem,
  type TrashGuideQualityProfileItem,
  type TrashGuideQualitySizeEntity,
  type TrashGuideQualitySizeEntry,
  type TrashGuideSourceFile,
  type TrashGuideSupportedArrType,
  TrashGuideParserError,
  asTrashGuideId,
  toTrashGuideId,
  isTrashGuideId,
  isTrashGuideSupportedArrType,
} from './types.ts';
import { isRecord } from './utils.ts';

export async function parseTrashGuideEntities(input: TrashGuideParseInput): Promise<TrashGuideParseResult> {
  const arrType = toSupportedArrType(input.arr_type);
  if (arrType !== input.discovery.arr_type) {
    throw new TrashGuideParserError(
      'arr_type_mismatch',
      `Parser arr_type "${arrType}" does not match discovery arr_type "${input.discovery.arr_type}"`
    );
  }

  const issues: TrashGuideParseIssue[] = [];
  const customFormats: TrashGuideCustomFormatEntity[] = [];
  const customFormatGroups: TrashGuideCfGroupEntity[] = [];
  const qualityProfiles: TrashGuideQualityProfileEntity[] = [];
  const qualitySizes: TrashGuideQualitySizeEntity[] = [];
  const naming: TrashGuideNamingEntity[] = [];
  let parsedFiles = 0;

  for (const entityType of TRASHGUIDE_ENTITY_TYPES) {
    const files = [...input.discovery.files_by_entity[entityType]].sort((a, b) =>
      a.relative_path.localeCompare(b.relative_path)
    );
    for (const file of files) {
      const parsed = await parseFile(file, arrType, issues);
      if (!parsed) {
        continue;
      }
      parsedFiles += 1;
      switch (parsed.entity_type) {
        case 'custom_format':
          customFormats.push(parsed);
          break;
        case 'custom_format_group':
          customFormatGroups.push(parsed);
          break;
        case 'quality_profile':
          qualityProfiles.push(parsed);
          break;
        case 'quality_size':
          qualitySizes.push(parsed);
          break;
        case 'naming':
          naming.push(parsed);
          break;
      }
    }
  }

  const entities: TrashGuideParsedEntities = {
    custom_formats: customFormats.sort((a, b) => sortByIdentity(a, b)),
    custom_format_groups: customFormatGroups.sort((a, b) => sortByIdentity(a, b)),
    quality_profiles: qualityProfiles.sort((a, b) => sortByIdentity(a, b)),
    quality_sizes: qualitySizes.sort((a, b) => sortByIdentity(a, b)),
    naming: naming.sort((a, b) => sortByIdentity(a, b)),
  };

  const orderedEntities: TrashGuideParsedEntity[] = [
    ...entities.custom_formats,
    ...entities.custom_format_groups,
    ...entities.quality_profiles,
    ...entities.quality_sizes,
    ...entities.naming,
  ];
  assertNoIdentityCollisions(orderedEntities);

  const status = deriveStatus(orderedEntities.length, issues.length);

  return {
    arr_type: arrType,
    status,
    entities,
    ordered_entities: orderedEntities,
    issues,
    parsed_files: parsedFiles,
    failed_files: issues.length,
  };
}

async function parseFile(
  file: TrashGuideSourceFile,
  arrType: TrashGuideSupportedArrType,
  issues: TrashGuideParseIssue[]
): Promise<TrashGuideParsedEntity | null> {
  let fileContents: string;
  try {
    fileContents = await Deno.readTextFile(file.absolute_path);
  } catch (error) {
    issues.push({
      code: 'file_read_error',
      retryable: false,
      entity_type: file.entity_type,
      file_path: file.relative_path,
      message: `Failed to read file: ${toErrorMessage(error)}`,
    });
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(fileContents);
  } catch (error) {
    issues.push({
      code: 'json_parse_error',
      retryable: false,
      entity_type: file.entity_type,
      file_path: file.relative_path,
      message: `Malformed JSON: ${toErrorMessage(error)}`,
    });
    return null;
  }

  try {
    switch (file.entity_type) {
      case 'custom_format':
        return parseCustomFormat(payload, arrType, file.relative_path);
      case 'custom_format_group':
        return parseCfGroup(payload, arrType, file.relative_path);
      case 'quality_profile':
        return parseQualityProfile(payload, arrType, file.relative_path);
      case 'quality_size':
        return parseQualitySize(payload, arrType, file.relative_path);
      case 'naming':
        return parseNaming(payload, arrType, file.relative_path);
    }
  } catch (error) {
    issues.push({
      code: 'validation_error',
      retryable: false,
      entity_type: file.entity_type,
      file_path: file.relative_path,
      message: toErrorMessage(error),
    });
  }

  return null;
}

function parseCustomFormat(
  payload: unknown,
  arrType: TrashGuideSupportedArrType,
  filePath: string
): TrashGuideCustomFormatEntity {
  const record = asRecord(payload, `${filePath}: root`);
  const trashId = readRequiredTrashId(record, `${filePath}: trash_id`);
  const name = readRequiredString(record, 'name', filePath);
  const includeInRename = readRequiredBoolean(record, 'includeCustomFormatWhenRenaming', filePath);

  const rawScoresValue = record.trash_scores;
  const rawScores = rawScoresValue != null
    ? asRecord(rawScoresValue, `${filePath}: trash_scores`)
    : {};
  const scores: Record<string, number> = {};
  for (const [scoreName, value] of Object.entries(rawScores)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${filePath}: trash_scores.${scoreName} must be a finite number`);
    }
    scores[scoreName] = value;
  }

  const rawSpecifications = asArray(
    readRequiredValue(record, 'specifications', filePath),
    `${filePath}: specifications`
  );
  const specifications: TrashGuideCustomFormatSpecification[] = rawSpecifications.map((value, index) =>
    parseCustomFormatSpecification(value, filePath, index)
  );

  return {
    entity_type: 'custom_format',
    arr_type: arrType,
    trash_id: trashId,
    file_path: filePath,
    name,
    description: readOptionalString(record, 'trash_description'),
    regex_url: readOptionalString(record, 'trash_regex'),
    include_in_rename: includeInRename,
    scores: Object.fromEntries(Object.entries(scores).sort(([a], [b]) => a.localeCompare(b))),
    specifications,
  };
}

function parseCustomFormatSpecification(
  value: unknown,
  filePath: string,
  index: number
): TrashGuideCustomFormatSpecification {
  const record = asRecord(value, `${filePath}: specifications[${index}]`);
  const fields = asRecord(
    readRequiredValue(record, 'fields', `${filePath}: specifications[${index}]`),
    `${filePath}: specifications[${index}].fields`
  );

  return {
    name: readRequiredString(record, 'name', `${filePath}: specifications[${index}]`),
    implementation: readRequiredString(record, 'implementation', `${filePath}: specifications[${index}]`),
    negate: readRequiredBoolean(record, 'negate', `${filePath}: specifications[${index}]`),
    required: readRequiredBoolean(record, 'required', `${filePath}: specifications[${index}]`),
    fields: sortRecordDeep(fields),
  };
}

function parseCfGroup(
  payload: unknown,
  arrType: TrashGuideSupportedArrType,
  filePath: string
): TrashGuideCfGroupEntity {
  const record = asRecord(payload, `${filePath}: root`);
  const trashId = readRequiredTrashId(record, `${filePath}: trash_id`);
  const name = readRequiredString(record, 'name', filePath);

  const qualityProfilesRaw = asRecord(
    readRequiredValue(record, 'quality_profiles', filePath),
    `${filePath}: quality_profiles`
  );
  const includeRaw = asRecord(
    readRequiredValue(qualityProfilesRaw, 'include', `${filePath}: quality_profiles`),
    `${filePath}: quality_profiles.include`
  );
  const include: Record<string, string> = {};
  for (const [profileName, value] of Object.entries(includeRaw)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${filePath}: quality_profiles.include["${profileName}"] must be a non-empty string`);
    }
    include[profileName] = value.trim();
  }

  const rawCustomFormats = asArray(
    readRequiredValue(record, 'custom_formats', filePath),
    `${filePath}: custom_formats`
  );
  const customFormats: TrashGuideCfGroupFormatItem[] = rawCustomFormats.map((value, index) => {
    const context = `${filePath}: custom_formats[${index}]`;
    const cfRecord = asRecord(value, context);
    return {
      name: readRequiredString(cfRecord, 'name', context),
      trash_id: readRequiredTrashId(cfRecord, context),
      required: typeof cfRecord.required === 'boolean' ? cfRecord.required : true,
    };
  });

  return {
    entity_type: 'custom_format_group',
    arr_type: arrType,
    trash_id: trashId,
    file_path: filePath,
    name,
    description: readOptionalString(record, 'trash_description'),
    default: typeof record.default === 'boolean' ? record.default : false,
    custom_formats: customFormats,
    quality_profiles: { include },
  };
}

function parseQualityProfile(
  payload: unknown,
  arrType: TrashGuideSupportedArrType,
  filePath: string
): TrashGuideQualityProfileEntity {
  const record = asRecord(payload, `${filePath}: root`);
  const trashId = readRequiredTrashId(record, `${filePath}: trash_id`);

  const items = asArray(readRequiredValue(record, 'items', filePath), `${filePath}: items`).map((value, index) =>
    parseQualityProfileItem(value, filePath, index)
  );
  const formatItems = parseQualityProfileFormatItems(record, filePath);

  return {
    entity_type: 'quality_profile',
    arr_type: arrType,
    trash_id: trashId,
    file_path: filePath,
    name: readRequiredString(record, 'name', filePath),
    description: readOptionalString(record, 'trash_description'),
    source_url: readOptionalString(record, 'trash_url'),
    score_set: readOptionalString(record, 'trash_score_set'),
    group: readOptionalNumber(record, 'group'),
    upgrade_allowed: readRequiredBoolean(record, 'upgradeAllowed', filePath),
    cutoff: readRequiredString(record, 'cutoff', filePath),
    min_format_score: readRequiredNumber(record, 'minFormatScore', filePath),
    cutoff_format_score: readRequiredNumber(record, 'cutoffFormatScore', filePath),
    min_upgrade_format_score: readRequiredNumber(record, 'minUpgradeFormatScore', filePath),
    language: readOptionalString(record, 'language'),
    items,
    format_items: formatItems.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function parseQualityProfileItem(value: unknown, filePath: string, index: number): TrashGuideQualityProfileItem {
  const context = `${filePath}: items[${index}]`;
  const record = asRecord(value, context);
  const directQualities = readStringArray(record.qualities, `${context}.qualities`);
  const nestedQualities = readNestedItemNames(record.items, `${context}.items`);
  return {
    name: readRequiredString(record, 'name', context),
    allowed: readRequiredBoolean(record, 'allowed', context),
    qualities: directQualities.length > 0 ? directQualities : nestedQualities,
  };
}

function parseQualityProfileFormatItems(
  record: Record<string, unknown>,
  filePath: string
): TrashGuideQualityProfileFormatItem[] {
  const value = readRequiredValue(record, 'formatItems', filePath);
  if (Array.isArray(value)) {
    return value.map((item, index) => parseQualityProfileFormatItem(item, `${filePath}: formatItems[${index}]`));
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([name, entryValue]) => {
        if (typeof entryValue === 'number' && Number.isFinite(entryValue)) {
          return {
            name,
            score: entryValue,
            custom_format_trash_id: null,
          } satisfies TrashGuideQualityProfileFormatItem;
        }
        if (typeof entryValue === 'string' && isTrashGuideId(entryValue)) {
          return {
            name,
            score: null,
            custom_format_trash_id: toTrashGuideId(entryValue),
          } satisfies TrashGuideQualityProfileFormatItem;
        }
        throw new Error(`${filePath}: formatItems["${name}"] must be a numeric score or a 32-char trash_id reference`);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  throw new Error(`${filePath}: formatItems must be an array or object`);
}

function parseQualityProfileFormatItem(value: unknown, context: string): TrashGuideQualityProfileFormatItem {
  const record = asRecord(value, context);
  const name = readRequiredString(record, 'name', context);
  const score = readOptionalNumber(record, 'score');
  const trashId = readOptionalTrashGuideId(record, context);
  if (score === null && trashId === null) {
    throw new Error(`${context}: each format item requires either score or trash_id`);
  }
  return {
    name,
    score,
    custom_format_trash_id: trashId,
  };
}

function parseQualitySize(
  payload: unknown,
  arrType: TrashGuideSupportedArrType,
  filePath: string
): TrashGuideQualitySizeEntity {
  const record = asRecord(payload, `${filePath}: root`);
  const profileType = readRequiredString(record, 'type', filePath).toLowerCase();
  validateQualitySizeCompatibility(profileType, arrType, filePath);
  const name = getFileStem(filePath);

  const rawQualities = asArray(readRequiredValue(record, 'qualities', filePath), `${filePath}: qualities`);
  const qualities: TrashGuideQualitySizeEntry[] = rawQualities.map((value, index) =>
    parseQualitySizeEntry(value, `${filePath}: qualities[${index}]`)
  );

  const explicitTrashId = readOptionalTrashGuideId(record, `${filePath}: trash_id`);
  const generatedId = `quality-size:${arrType}:${profileType}`;
  const trashId = explicitTrashId ?? asTrashGuideId(generatedId);

  return {
    entity_type: 'quality_size',
    arr_type: arrType,
    trash_id: trashId,
    file_path: filePath,
    name,
    profile_type: profileType,
    qualities,
  };
}

function parseQualitySizeEntry(value: unknown, context: string): TrashGuideQualitySizeEntry {
  const record = asRecord(value, context);
  return {
    quality: readRequiredString(record, 'quality', context),
    min: readRequiredNumber(record, 'min', context),
    preferred: readRequiredNumber(record, 'preferred', context),
    max: readRequiredNumber(record, 'max', context),
  };
}

function parseNaming(payload: unknown, arrType: TrashGuideSupportedArrType, filePath: string): TrashGuideNamingEntity {
  const record = asRecord(payload, `${filePath}: root`);
  validateNamingCompatibility(record, arrType, filePath);
  const name = getFileStem(filePath);
  const generatedId = `naming:${arrType}:${name}`;
  return {
    entity_type: 'naming',
    arr_type: arrType,
    trash_id: asTrashGuideId(generatedId),
    file_path: filePath,
    name,
    templates: sortRecordDeep(record),
  };
}

function validateQualitySizeCompatibility(
  profileType: string,
  arrType: TrashGuideSupportedArrType,
  filePath: string
): void {
  const isSupportedProfileType = profileType === 'movie' || profileType === 'series' || profileType === 'anime';
  if (!isSupportedProfileType) {
    throw new Error(`${filePath}: quality size type "${profileType}" is unsupported`);
  }

  if (arrType === 'radarr' && profileType === 'series') {
    throw new Error(`${filePath}: quality size type "${profileType}" is incompatible with arr_type "${arrType}"`);
  }
  if (arrType === 'sonarr' && profileType === 'movie') {
    throw new Error(`${filePath}: quality size type "${profileType}" is incompatible with arr_type "${arrType}"`);
  }
}

function validateNamingCompatibility(
  payload: Readonly<Record<string, unknown>>,
  arrType: TrashGuideSupportedArrType,
  filePath: string
): void {
  if (arrType === 'radarr') {
    validateTemplateObject(payload.folder, `${filePath}: folder`);
    validateTemplateObject(payload.file, `${filePath}: file`);
    return;
  }

  validateTemplateObject(payload.series, `${filePath}: series`);
  validateTemplateObject(payload.episodes, `${filePath}: episodes`);
}

function validateTemplateObject(value: unknown, context: string): void {
  const record = asRecord(value, context);
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue === 'string') {
      continue;
    }
    if (isRecord(entryValue)) {
      validateTemplateObject(entryValue, `${context}.${key}`);
      continue;
    }
    throw new Error(`${context}.${key} must be a string or nested object`);
  }
}

function readNestedItemNames(value: unknown, context: string): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item === 'string' && item.trim()) {
      names.push(item);
      continue;
    }
    if (isRecord(item) && typeof item.name === 'string' && item.name.trim()) {
      names.push(item.name);
      continue;
    }
    throw new Error(`${context}[${index}] must be a string or object with a string name`);
  }
  return names;
}

function readStringArray(value: unknown, context: string): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const values: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${context}[${index}] must be a non-empty string`);
    }
    values.push(item);
  }
  return values;
}

function readRequiredTrashId(record: Record<string, unknown>, context: string): ReturnType<typeof toTrashGuideId> {
  const value = readRequiredString(record, 'trash_id', context);
  return toTrashGuideId(value);
}

function readOptionalTrashGuideId(
  record: Record<string, unknown>,
  context: string
): ReturnType<typeof toTrashGuideId> | null {
  const value = readOptionalString(record, 'trash_id');
  if (value === null) {
    return null;
  }
  return toTrashGuideId(value);
}

function readRequiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = readRequiredValue(record, key, context);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}: "${key}" must be a non-empty string`);
  }
  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`"${key}" must be a string when provided`);
  }
  return value;
}

function readRequiredBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
  const value = readRequiredValue(record, key, context);
  if (typeof value !== 'boolean') {
    throw new Error(`${context}: "${key}" must be a boolean`);
  }
  return value;
}

function readRequiredNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = readRequiredValue(record, key, context);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${context}: "${key}" must be a finite number`);
  }
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`"${key}" must be a finite number when provided`);
  }
  return value;
}

function readRequiredValue(record: Record<string, unknown>, key: string, context: string): unknown {
  if (!(key in record)) {
    throw new Error(`${context}: missing required field "${key}"`);
  }
  return record[key];
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

function asArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function sortRecordDeep(value: Record<string, unknown>): Record<string, unknown> {
  const sortedEntries = Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => {
      if (Array.isArray(entry)) {
        return [key, entry.map((arrayValue) => (isRecord(arrayValue) ? sortRecordDeep(arrayValue) : arrayValue))];
      }
      if (isRecord(entry)) {
        return [key, sortRecordDeep(entry)];
      }
      return [key, entry];
    });
  return Object.fromEntries(sortedEntries);
}

function getFileStem(path: string): string {
  const file = path.split('/').at(-1) ?? path;
  return file.endsWith('.json') ? file.slice(0, -5) : file;
}

function sortByIdentity(
  a: { readonly trash_id: string; readonly file_path: string },
  b: { readonly trash_id: string; readonly file_path: string }
): number {
  if (a.trash_id !== b.trash_id) {
    return a.trash_id.localeCompare(b.trash_id);
  }
  return a.file_path.localeCompare(b.file_path);
}

function assertNoIdentityCollisions(entities: readonly TrashGuideParsedEntity[]): void {
  const seen = new Map<string, { signature: string; filePath: string }>();

  for (const entity of entities) {
    const key = `${entity.arr_type}:${entity.entity_type}:${entity.trash_id}`;
    const signature = getCollisionSignature(entity);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, {
        signature,
        filePath: entity.file_path,
      });
      continue;
    }

    if (existing.signature !== signature) {
      throw new Error(
        `TRaSH identity collision detected for ${entity.entity_type}:${entity.trash_id} in arr_type "${entity.arr_type}" between "${existing.filePath}" and "${entity.file_path}"`
      );
    }
  }
}

function getCollisionSignature(entity: TrashGuideParsedEntity): string {
  const payload = sortUnknownDeep({
    ...entity,
    file_path: undefined,
  });
  return JSON.stringify(payload);
}

function sortUnknownDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortUnknownDeep(entry));
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([key]) => key !== 'file_path')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortUnknownDeep(entry)] as const);
    return Object.fromEntries(entries);
  }

  return value;
}

function deriveStatus(parsedCount: number, issueCount: number): TrashGuideParseStatus {
  if (issueCount === 0) {
    return 'success';
  }
  if (parsedCount === 0) {
    return 'failed';
  }
  return 'partial';
}

function toSupportedArrType(value: string): TrashGuideSupportedArrType {
  if (isTrashGuideSupportedArrType(value)) {
    return value;
  }
  throw new TrashGuideParserError(
    'unsupported_arr_type',
    `Unsupported TRaSH arr_type "${value}". Supported values: ${TRASHGUIDE_SUPPORTED_ARR_TYPES.join(', ')}`
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
