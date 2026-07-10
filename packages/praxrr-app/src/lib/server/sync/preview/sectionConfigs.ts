export interface NullableNamedSelection {
  readonly databaseId: number | null;
  readonly profileName: string | null;
}

export interface MediaManagementPreviewConfig {
  readonly namingDatabaseId: number | null;
  readonly namingConfigName: string | null;
  readonly qualityDefinitionsDatabaseId: number | null;
  readonly qualityDefinitionsConfigName: string | null;
  readonly mediaSettingsDatabaseId: number | null;
  readonly mediaSettingsConfigName: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parsePositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function parsePersistedName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function parseNullableNamedSelection(
  rawDatabaseId: unknown,
  rawName: unknown
): { databaseId: number | null; name: string | null } | null {
  if (rawDatabaseId === null && rawName === null) {
    return { databaseId: null, name: null };
  }

  const databaseId = parsePositiveInt(rawDatabaseId);
  const name = parsePersistedName(rawName);
  return databaseId !== null && name !== null ? { databaseId, name } : null;
}

const NAMED_SELECTION_KEYS = ['databaseId', 'profileName'] as const;

/** Parse a complete delay/metadata transient selection without saved-config fallback. */
export function parseNamedProfilePreviewConfig(rawConfig: unknown): NullableNamedSelection | null {
  if (!isPlainObject(rawConfig) || !hasExactKeys(rawConfig, NAMED_SELECTION_KEYS)) return null;
  const selection = parseNullableNamedSelection(rawConfig.databaseId, rawConfig.profileName);
  if (!selection) return null;
  return { databaseId: selection.databaseId, profileName: selection.name };
}

const MEDIA_MANAGEMENT_KEYS = [
  'namingDatabaseId',
  'namingConfigName',
  'qualityDefinitionsDatabaseId',
  'qualityDefinitionsConfigName',
  'mediaSettingsDatabaseId',
  'mediaSettingsConfigName',
] as const;

/** Parse all three independent media-management subsection selections fail-closed. */
export function parseMediaManagementPreviewConfig(rawConfig: unknown): MediaManagementPreviewConfig | null {
  if (!isPlainObject(rawConfig) || !hasExactKeys(rawConfig, MEDIA_MANAGEMENT_KEYS)) return null;

  const naming = parseNullableNamedSelection(rawConfig.namingDatabaseId, rawConfig.namingConfigName);
  const qualityDefinitions = parseNullableNamedSelection(
    rawConfig.qualityDefinitionsDatabaseId,
    rawConfig.qualityDefinitionsConfigName
  );
  const mediaSettings = parseNullableNamedSelection(
    rawConfig.mediaSettingsDatabaseId,
    rawConfig.mediaSettingsConfigName
  );
  if (!naming || !qualityDefinitions || !mediaSettings) return null;

  return {
    namingDatabaseId: naming.databaseId,
    namingConfigName: naming.name,
    qualityDefinitionsDatabaseId: qualityDefinitions.databaseId,
    qualityDefinitionsConfigName: qualityDefinitions.name,
    mediaSettingsDatabaseId: mediaSettings.databaseId,
    mediaSettingsConfigName: mediaSettings.name,
  };
}
