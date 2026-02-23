import type { PCDCache } from '$pcd/database/cache.ts';
import type { EntityType } from '$shared/pcd/portable.ts';

export type MigrationEntitySourceTableFamily =
  | 'regular_expressions'
  | 'custom_formats'
  | 'quality_profiles'
  | 'delay_profiles'
  | 'radarr_naming'
  | 'sonarr_naming'
  | 'lidarr_naming'
  | 'radarr_media_settings'
  | 'sonarr_media_settings'
  | 'lidarr_media_settings'
  | 'radarr_quality_definitions'
  | 'sonarr_quality_definitions'
  | 'lidarr_quality_definitions'
  | 'lidarr_metadata_profiles';

export interface MigrationEntityFamilyDescriptor {
  readonly entityType: EntityType;
  readonly sourceTableFamily: MigrationEntitySourceTableFamily;
}

export interface EnumeratedMigrationEntityDescriptor extends MigrationEntityFamilyDescriptor {
  readonly entityName: string;
  readonly stableIdentity: MigrationEntityStableIdentity;
}

interface MigrationEntityFamilyConfig extends MigrationEntityFamilyDescriptor {
  readonly distinctNames: boolean;
}

const MIGRATION_ENTITY_FAMILY_SEQUENCE: readonly MigrationEntityFamilyConfig[] = [
  {
    entityType: 'regular_expression',
    sourceTableFamily: 'regular_expressions',
    distinctNames: false,
  },
  {
    entityType: 'custom_format',
    sourceTableFamily: 'custom_formats',
    distinctNames: false,
  },
  {
    entityType: 'quality_profile',
    sourceTableFamily: 'quality_profiles',
    distinctNames: false,
  },
  {
    entityType: 'delay_profile',
    sourceTableFamily: 'delay_profiles',
    distinctNames: false,
  },
  {
    entityType: 'radarr_naming',
    sourceTableFamily: 'radarr_naming',
    distinctNames: false,
  },
  {
    entityType: 'sonarr_naming',
    sourceTableFamily: 'sonarr_naming',
    distinctNames: false,
  },
  {
    entityType: 'lidarr_naming',
    sourceTableFamily: 'lidarr_naming',
    distinctNames: false,
  },
  {
    entityType: 'radarr_media_settings',
    sourceTableFamily: 'radarr_media_settings',
    distinctNames: false,
  },
  {
    entityType: 'sonarr_media_settings',
    sourceTableFamily: 'sonarr_media_settings',
    distinctNames: false,
  },
  {
    entityType: 'lidarr_media_settings',
    sourceTableFamily: 'lidarr_media_settings',
    distinctNames: false,
  },
  {
    entityType: 'radarr_quality_definitions',
    sourceTableFamily: 'radarr_quality_definitions',
    distinctNames: true,
  },
  {
    entityType: 'sonarr_quality_definitions',
    sourceTableFamily: 'sonarr_quality_definitions',
    distinctNames: true,
  },
  {
    entityType: 'lidarr_quality_definitions',
    sourceTableFamily: 'lidarr_quality_definitions',
    distinctNames: true,
  },
  {
    entityType: 'lidarr_metadata_profile',
    sourceTableFamily: 'lidarr_metadata_profiles',
    distinctNames: false,
  },
] as const;

const MIGRATION_ENTITY_FAMILY_LOOKUP: ReadonlyMap<EntityType, MigrationEntityFamilyConfig> = new Map(
  MIGRATION_ENTITY_FAMILY_SEQUENCE.map((family) => [family.entityType, family])
);

interface NameRow {
  readonly name: string;
}

export interface MigrationEntityStableIdentity {
  readonly key: string;
  readonly value: string;
}

const ENTITY_STABLE_KEY_BY_TYPE: Readonly<Record<EntityType, string>> = {
  delay_profile: 'delay_profile_name',
  regular_expression: 'regular_expression_name',
  custom_format: 'custom_format_name',
  quality_profile: 'quality_profile_name',
  radarr_naming: 'radarr_naming_name',
  sonarr_naming: 'sonarr_naming_name',
  lidarr_naming: 'lidarr_naming_name',
  radarr_media_settings: 'radarr_media_settings_name',
  sonarr_media_settings: 'sonarr_media_settings_name',
  lidarr_media_settings: 'lidarr_media_settings_name',
  radarr_quality_definitions: 'radarr_quality_definitions_name',
  sonarr_quality_definitions: 'sonarr_quality_definitions_name',
  lidarr_quality_definitions: 'lidarr_quality_definitions_name',
  lidarr_metadata_profile: 'metadata_profile_name',
};

export function listMigrationEntityFamilies(): readonly MigrationEntityFamilyDescriptor[] {
  return MIGRATION_ENTITY_FAMILY_SEQUENCE;
}

export function enumerateMigrationEntityFamily(
  cache: PCDCache,
  entityType: EntityType
): EnumeratedMigrationEntityDescriptor[] {
  const family = MIGRATION_ENTITY_FAMILY_LOOKUP.get(entityType);
  if (!family) {
    throw new Error(`Unsupported migration entity type for enumeration: ${entityType}`);
  }

  const names = listEntityNamesForFamily(cache, family);

  return names.map((entityName) => ({
    entityType: family.entityType,
    sourceTableFamily: family.sourceTableFamily,
    entityName,
    stableIdentity: resolveMigrationStableIdentity(family.entityType, entityName),
  }));
}

export function enumerateMigrationEntities(
  cache: PCDCache,
  options: {
    readonly entityTypes?: readonly EntityType[];
  } = {}
): EnumeratedMigrationEntityDescriptor[] {
  const filteredTypes = options.entityTypes ? new Set(options.entityTypes) : null;
  const descriptors: EnumeratedMigrationEntityDescriptor[] = [];

  for (const family of MIGRATION_ENTITY_FAMILY_SEQUENCE) {
    if (filteredTypes && !filteredTypes.has(family.entityType)) {
      continue;
    }

    const names = listEntityNamesForFamily(cache, family);
    descriptors.push(
      ...names.map((entityName) => ({
        entityType: family.entityType,
        sourceTableFamily: family.sourceTableFamily,
        entityName,
        stableIdentity: resolveMigrationStableIdentity(family.entityType, entityName),
      }))
    );
  }

  return descriptors;
}

function listEntityNamesForFamily(cache: PCDCache, family: MigrationEntityFamilyConfig): string[] {
  const selectClause = family.distinctNames ? 'SELECT DISTINCT name' : 'SELECT name';
  const rows = cache.query<NameRow>(
    `${selectClause} FROM ${family.sourceTableFamily} WHERE name IS NOT NULL ORDER BY name`
  );

  return rows.map((row) => row.name);
}

function resolveMigrationStableIdentity(entityType: EntityType, entityName: string): MigrationEntityStableIdentity {
  const stableKey = ENTITY_STABLE_KEY_BY_TYPE[entityType] ?? `migration_${entityType}_name`;
  return {
    key: stableKey,
    value: entityName,
  };
}
