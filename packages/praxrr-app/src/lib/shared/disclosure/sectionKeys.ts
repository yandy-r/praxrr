/**
 * Canonical registry of all disclosure section keys.
 *
 * Keys follow the pattern `route-family:page:section` and must match
 * the validation regex `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$` with
 * a max length of 96 characters.
 */

export const SECTION_KEY_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/;
export const SECTION_KEY_MAX_LENGTH = 96;
export const UI_PREFERENCE_MODES = ['basic', 'advanced'] as const;

export type UiPreferenceMode = (typeof UI_PREFERENCE_MODES)[number];

// -- Custom Formats --
export const CF_CONDITIONS = 'custom-formats:general:conditions' as const;
export const CF_SCORING = 'custom-formats:general:scoring' as const;
export const CF_NEGATION_AND_GROUPS = 'custom-formats:general:negation-and-groups' as const;

// -- Media Management --
export const MM_NAMING = 'media-management:media-settings:naming' as const;
export const MM_FOLDER_MANAGEMENT = 'media-management:media-settings:folder-management' as const;
export const MM_IMPORTING = 'media-management:media-settings:importing' as const;

// -- Arr --
export const ARR_CONNECTION_DETAILS = 'arr:settings:connection-details' as const;
export const ARR_UPGRADES_FILTER = 'arr:upgrades:filter-settings' as const;

// -- Delay Profiles --
export const DP_BYPASS_CONDITIONS = 'delay-profiles:general:bypass-conditions' as const;

// -- Quality Profiles --
export const QP_METADATA = 'quality-profiles:general:metadata' as const;

// -- Databases --
export const DB_MANIFEST_ADVANCED = 'databases:config:manifest-advanced' as const;

// -- Settings: Notifications --
export const SETTINGS_NOTIFICATION_EVENTS = 'settings:notifications:event-types' as const;

// -- Settings: General --
export const SETTINGS_LOGGING = 'settings:general:logging' as const;
export const SETTINGS_AI = 'settings:general:ai' as const;
export const SETTINGS_TMDB = 'settings:general:tmdb' as const;
export const SETTINGS_BACKUP = 'settings:general:backup' as const;

// -- Settings: Security --
export const SETTINGS_SECURITY_SESSIONS = 'settings:security:sessions' as const;

// -- Regular Expressions --
export const REGEX_METADATA = 'regular-expressions:general:metadata' as const;

// -- Metadata Profiles --
export const MP_TYPE_SELECTION = 'metadata-profiles:general:type-selection' as const;

export const SECTION_KEYS = [
  CF_CONDITIONS,
  CF_SCORING,
  CF_NEGATION_AND_GROUPS,
  MM_NAMING,
  MM_FOLDER_MANAGEMENT,
  MM_IMPORTING,
  ARR_CONNECTION_DETAILS,
  ARR_UPGRADES_FILTER,
  DP_BYPASS_CONDITIONS,
  QP_METADATA,
  DB_MANIFEST_ADVANCED,
  SETTINGS_NOTIFICATION_EVENTS,
  SETTINGS_LOGGING,
  SETTINGS_AI,
  SETTINGS_TMDB,
  SETTINGS_BACKUP,
  SETTINGS_SECURITY_SESSIONS,
  REGEX_METADATA,
  MP_TYPE_SELECTION,
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];
export type SectionModeMap = Partial<Record<SectionKey, UiPreferenceMode>>;

// -- Route-family groups for SSR hydration helpers --

export const CUSTOM_FORMAT_KEYS = [CF_CONDITIONS, CF_SCORING, CF_NEGATION_AND_GROUPS] as const;

export const MEDIA_SETTINGS_KEYS = [MM_NAMING, MM_FOLDER_MANAGEMENT, MM_IMPORTING] as const;

export const SETTINGS_GENERAL_KEYS = [SETTINGS_LOGGING, SETTINGS_AI, SETTINGS_TMDB, SETTINGS_BACKUP] as const;
