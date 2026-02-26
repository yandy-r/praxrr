/**
 * Portable Entity Validation
 *
 * Validates portable data shape before deserialization.
 * Returns a string error message if invalid, null if valid.
 */

import {
  type EntityType,
  getLidarrMediaManagementPortableEntry,
  type LidarrMediaManagementPortableEntityType,
} from '$shared/pcd/portable.ts';

const VALID_PROTOCOLS = new Set(['prefer_usenet', 'prefer_torrent', 'only_usenet', 'only_torrent']);
const VALID_COLON_FORMATS = new Set(['delete', 'dash', 'spaceDash', 'spaceDashSpace', 'smart']);
const VALID_MULTI_EPISODE_STYLES = new Set(['extend', 'duplicate', 'repeat', 'scene', 'range', 'prefixedRange']);
const VALID_PROPERS_REPACKS = new Set(['doNotPrefer', 'preferAndUpgrade', 'doNotUpgradeAutomatically']);

/**
 * Validate portable entity data against the expected shape for the given entity type.
 *
 * @param entityType - The entity type to validate against
 * @param data - The portable data object to validate
 * @returns An error message string if invalid, or null if the data is valid
 */
export function validatePortableData(entityType: EntityType, data: Record<string, unknown>): string | null {
  switch (entityType) {
    case 'delay_profile':
      return validateDelayProfile(data);
    case 'regular_expression':
      return validateRegularExpression(data);
    case 'custom_format':
      return validateCustomFormat(data);
    case 'quality_profile':
      return validateQualityProfile(data);
    case 'radarr_naming':
      return validateRadarrNaming(data);
    case 'sonarr_naming':
      return validateSonarrNaming(data);
    case 'lidarr_naming':
      return validateLidarrNaming(data);
    case 'radarr_media_settings':
    case 'sonarr_media_settings':
      return validateMediaSettings(data);
    case 'lidarr_media_settings':
      return validateLidarrPortableData('lidarr_media_settings', data, validateMediaSettings);
    case 'lidarr_metadata_profile':
      return validateLidarrMetadataProfileData(data);
    case 'radarr_quality_definitions':
    case 'sonarr_quality_definitions':
      return validateQualityDefinitions(data);
    case 'lidarr_quality_definitions':
      return validateLidarrPortableData('lidarr_quality_definitions', data, validateQualityDefinitions);
    default:
      return null;
  }
}

function requireName(data: Record<string, unknown>): string | null {
  if (typeof data.name !== 'string' || !data.name.trim()) {
    return 'data.name is required and must be a non-empty string';
  }
  return null;
}

function validateDelayProfile(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (!VALID_PROTOCOLS.has(data.preferredProtocol as string)) {
    return `data.preferredProtocol must be one of: ${[...VALID_PROTOCOLS].join(', ')}`;
  }
  if (typeof data.usenetDelay !== 'number') {
    return 'data.usenetDelay must be a number';
  }
  if (typeof data.torrentDelay !== 'number') {
    return 'data.torrentDelay must be a number';
  }
  if (typeof data.bypassIfHighestQuality !== 'boolean') {
    return 'data.bypassIfHighestQuality must be a boolean';
  }
  if (typeof data.bypassIfAboveCfScore !== 'boolean') {
    return 'data.bypassIfAboveCfScore must be a boolean';
  }
  if (typeof data.minimumCfScore !== 'number') {
    return 'data.minimumCfScore must be a number';
  }
  return null;
}

function validateRegularExpression(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (typeof data.pattern !== 'string') {
    return 'data.pattern must be a string';
  }
  if (!Array.isArray(data.tags)) {
    return 'data.tags must be an array';
  }
  if (data.description !== null && typeof data.description !== 'string') {
    return 'data.description must be a string or null';
  }
  if (data.regex101Id !== null && typeof data.regex101Id !== 'string') {
    return 'data.regex101Id must be a string or null';
  }
  return null;
}

function validateCustomFormat(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (data.description !== null && typeof data.description !== 'string') {
    return 'data.description must be a string or null';
  }
  if (typeof data.includeInRename !== 'boolean') {
    return 'data.includeInRename must be a boolean';
  }
  if (!Array.isArray(data.tags)) {
    return 'data.tags must be an array';
  }
  if (!Array.isArray(data.conditions)) {
    return 'data.conditions must be an array';
  }
  if (!Array.isArray(data.tests)) {
    return 'data.tests must be an array';
  }
  return null;
}

function validateQualityProfile(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (data.description !== null && typeof data.description !== 'string') {
    return 'data.description must be a string or null';
  }
  if (!Array.isArray(data.tags)) {
    return 'data.tags must be an array';
  }
  if (data.language !== null && typeof data.language !== 'string') {
    return 'data.language must be a string or null';
  }
  if (!Array.isArray(data.orderedItems)) {
    return 'data.orderedItems must be an array';
  }
  if (typeof data.minimumScore !== 'number') {
    return 'data.minimumScore must be a number';
  }
  if (typeof data.upgradeUntilScore !== 'number') {
    return 'data.upgradeUntilScore must be a number';
  }
  if (typeof data.upgradeScoreIncrement !== 'number') {
    return 'data.upgradeScoreIncrement must be a number';
  }
  if (!Array.isArray(data.customFormatScores)) {
    return 'data.customFormatScores must be an array';
  }
  return null;
}

function validateRadarrNaming(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (typeof data.rename !== 'boolean') {
    return 'data.rename must be a boolean';
  }
  if (typeof data.movieFormat !== 'string') {
    return 'data.movieFormat must be a string';
  }
  if (typeof data.movieFolderFormat !== 'string') {
    return 'data.movieFolderFormat must be a string';
  }
  if (typeof data.replaceIllegalCharacters !== 'boolean') {
    return 'data.replaceIllegalCharacters must be a boolean';
  }
  if (!VALID_COLON_FORMATS.has(data.colonReplacementFormat as string)) {
    return `data.colonReplacementFormat must be one of: ${[...VALID_COLON_FORMATS].join(', ')}`;
  }
  return null;
}

function validateSonarrNaming(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (typeof data.rename !== 'boolean') {
    return 'data.rename must be a boolean';
  }
  if (typeof data.standardEpisodeFormat !== 'string') {
    return 'data.standardEpisodeFormat must be a string';
  }
  if (typeof data.dailyEpisodeFormat !== 'string') {
    return 'data.dailyEpisodeFormat must be a string';
  }
  if (typeof data.animeEpisodeFormat !== 'string') {
    return 'data.animeEpisodeFormat must be a string';
  }
  if (typeof data.seriesFolderFormat !== 'string') {
    return 'data.seriesFolderFormat must be a string';
  }
  if (typeof data.seasonFolderFormat !== 'string') {
    return 'data.seasonFolderFormat must be a string';
  }
  if (typeof data.replaceIllegalCharacters !== 'boolean') {
    return 'data.replaceIllegalCharacters must be a boolean';
  }
  if (!VALID_COLON_FORMATS.has(data.colonReplacementFormat as string)) {
    return `data.colonReplacementFormat must be one of: ${[...VALID_COLON_FORMATS].join(', ')}`;
  }
  if (data.customColonReplacementFormat !== null && typeof data.customColonReplacementFormat !== 'string') {
    return 'data.customColonReplacementFormat must be a string or null';
  }
  if (!VALID_MULTI_EPISODE_STYLES.has(data.multiEpisodeStyle as string)) {
    return `data.multiEpisodeStyle must be one of: ${[...VALID_MULTI_EPISODE_STYLES].join(', ')}`;
  }
  return null;
}

function validateLidarrNaming(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;

  if (typeof data.rename !== 'boolean') {
    return 'data.rename must be a boolean';
  }
  if (typeof data.standardTrackFormat !== 'string') {
    return 'data.standardTrackFormat must be a string';
  }
  if (typeof data.artistName !== 'string') {
    return 'data.artistName must be a string';
  }
  if (typeof data.multiDiscTrackFormat !== 'string') {
    return 'data.multiDiscTrackFormat must be a string';
  }
  if (typeof data.artistFolderFormat !== 'string') {
    return 'data.artistFolderFormat must be a string';
  }
  if (typeof data.replaceIllegalCharacters !== 'boolean') {
    return 'data.replaceIllegalCharacters must be a boolean';
  }
  if (!VALID_COLON_FORMATS.has(data.colonReplacementFormat as string)) {
    return `data.colonReplacementFormat must be one of: ${[...VALID_COLON_FORMATS].join(', ')}`;
  }
  if (data.customColonReplacementFormat !== null && typeof data.customColonReplacementFormat !== 'string') {
    return 'data.customColonReplacementFormat must be a string or null';
  }

  return validateLidarrPortableData('lidarr_naming', data, () => null);
}
function validateLidarrPortableData(
  entityType: LidarrMediaManagementPortableEntityType,
  data: Record<string, unknown>,
  validator: (data: Record<string, unknown>) => string | null
): string | null {
  const matrixEntry = getLidarrMediaManagementPortableEntry(entityType);
  if (!matrixEntry) {
    return `Unsupported payload for ${entityType}: unknown Lidarr media-management entity type`;
  }

  const mixedFields = (matrixEntry.forbiddenFields ?? [])
    .filter((field) => Object.hasOwn(data, field))
    .sort((a, b) => a.localeCompare(b));
  if (mixedFields.length > 0) {
    return `Mixed payload for ${entityType}: unsupported fields from another model: ${mixedFields.join(', ')}`;
  }

  const missingRequiredFields = matrixEntry.requiredFields.filter((field) => !Object.hasOwn(data, field));
  if (missingRequiredFields.length > 0) {
    return `Unsupported payload for ${entityType}: missing required fields: ${missingRequiredFields.join(', ')}`;
  }

  const allowedFields = new Set(matrixEntry.requiredFields);
  const unsupportedFields = Object.keys(data)
    .filter((field) => !allowedFields.has(field))
    .sort((a, b) => a.localeCompare(b));
  if (unsupportedFields.length > 0) {
    return `Unsupported payload for ${entityType}: unsupported fields: ${unsupportedFields.join(', ')}`;
  }

  return validator(data);
}

function validateMediaSettings(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (!VALID_PROPERS_REPACKS.has(data.propersRepacks as string)) {
    return `data.propersRepacks must be one of: ${[...VALID_PROPERS_REPACKS].join(', ')}`;
  }
  if (typeof data.enableMediaInfo !== 'boolean') {
    return 'data.enableMediaInfo must be a boolean';
  }
  return null;
}

function validateLidarrMetadataProfileData(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;

  if (data.description !== null && typeof data.description !== 'string') {
    return 'data.description must be a string or null';
  }

  const missingRequiredFields = ['primaryTypes', 'secondaryTypes', 'releaseStatuses'].filter(
    (field) => !Object.hasOwn(data, field)
  );
  if (missingRequiredFields.length > 0) {
    return `Unsupported payload for lidarr_metadata_profile: missing required fields: ${missingRequiredFields.join(', ')}`;
  }

  const allowedFields = new Set(['name', 'description', 'primaryTypes', 'secondaryTypes', 'releaseStatuses']);
  const unsupportedFields = Object.keys(data)
    .filter((field) => !allowedFields.has(field))
    .sort((a, b) => a.localeCompare(b));
  if (unsupportedFields.length > 0) {
    return `Unsupported payload for lidarr_metadata_profile: unsupported fields: ${unsupportedFields.join(', ')}`;
  }

  const primaryError = validateLidarrMetadataProfileTypeRows('data.primaryTypes', data.primaryTypes, ['id', 'typeId']);
  if (primaryError) return primaryError;

  const secondaryError = validateLidarrMetadataProfileTypeRows('data.secondaryTypes', data.secondaryTypes, [
    'id',
    'typeId',
  ]);
  if (secondaryError) return secondaryError;

  const statusError = validateLidarrMetadataProfileTypeRows('data.releaseStatuses', data.releaseStatuses, [
    'id',
    'statusId',
  ]);
  if (statusError) return statusError;

  return null;
}

function validateLidarrMetadataProfileTypeRows(
  path: string,
  rows: unknown,
  allowedIdentifierFields: readonly string[]
): string | null {
  if (!Array.isArray(rows)) {
    return `${path} must be an array`;
  }

  const allowedFields = [...allowedIdentifierFields, 'name', 'allowed'];
  const identifiers = new Set<number>();
  let hasAllowed = false;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return `${path}[${index}] must be an object`;
    }

    const typedRow = row as Record<string, unknown>;
    const identifierValues = allowedIdentifierFields
      .map((field) => getIntegerMetadataProfileId(typedRow[field]))
      .filter((value) => value !== null);

    if (identifierValues.length === 0) {
      return `${path}[${index}] requires an integer identifier`;
    }

    if (identifierValues.length > 1) {
      return `${path}[${index}] must use only one identifier field`;
    }

    const unsupportedFields = Object.keys(typedRow).filter((field) => !allowedFields.includes(field));
    if (unsupportedFields.length > 0) {
      return `${path}[${index}] has unsupported fields: ${unsupportedFields.sort((a, b) => a.localeCompare(b)).join(', ')}`;
    }

    if (typeof typedRow.name !== 'string' || !typedRow.name.trim()) {
      return `${path}[${index}].name must be a non-empty string`;
    }
    if (typeof typedRow.allowed !== 'boolean') {
      return `${path}[${index}].allowed must be a boolean`;
    }

    const normalizedId = identifierValues[0];
    if (identifiers.has(normalizedId)) {
      return `${path}[${index}] has duplicate identifier ${normalizedId}`;
    }
    identifiers.add(normalizedId);

    if (typedRow.allowed === true) {
      hasAllowed = true;
    }
  }

  if (!hasAllowed) {
    return `${path} must have at least one allowed entry`;
  }

  return null;
}

function getIntegerMetadataProfileId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function validateQualityDefinitions(data: Record<string, unknown>): string | null {
  const nameError = requireName(data);
  if (nameError) return nameError;
  if (!Array.isArray(data.entries)) {
    return 'data.entries must be an array';
  }
  for (const entry of data.entries as Record<string, unknown>[]) {
    if (typeof entry.quality_name !== 'string') {
      return 'Each entry must have a quality_name string';
    }
    if (typeof entry.min_size !== 'number') {
      return 'Each entry must have a min_size number';
    }
    if (typeof entry.max_size !== 'number') {
      return 'Each entry must have a max_size number';
    }
    if (typeof entry.preferred_size !== 'number') {
      return 'Each entry must have a preferred_size number';
    }
  }
  return null;
}
