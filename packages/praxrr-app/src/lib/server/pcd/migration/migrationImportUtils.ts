import type { EntityType } from '$shared/pcd/portable.ts';

export interface MigrationEntityStableIdentity {
  readonly key: string;
  readonly value: string;
  readonly kind: 'stable';
}

export const ENTITY_IMPORT_ORDER: readonly EntityType[] = [
  'regular_expression',
  'custom_format',
  'quality_profile',
  'delay_profile',
  'radarr_naming',
  'sonarr_naming',
  'lidarr_naming',
  'radarr_media_settings',
  'sonarr_media_settings',
  'lidarr_media_settings',
  'radarr_quality_definitions',
  'sonarr_quality_definitions',
  'lidarr_quality_definitions',
  'lidarr_metadata_profile',
] as const;

export function formatStableJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatStableJson(entry)).join(', ')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => `${JSON.stringify(key)}: ${formatStableJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(', ')}}`;
  }

  return JSON.stringify(value);
}

export function sortMigrationCandidatesByImportOrder<T extends { entityType: EntityType; entityName: string }>(
  candidates: readonly T[]
): T[] {
  const entityOrder = new Map<EntityType, number>();
  for (let i = 0; i < ENTITY_IMPORT_ORDER.length; i += 1) {
    entityOrder.set(ENTITY_IMPORT_ORDER[i], i);
  }

  return [...candidates].sort((a, b) => {
    const aPriority = entityOrder.get(a.entityType) ?? Number.MAX_SAFE_INTEGER;
    const bPriority = entityOrder.get(b.entityType) ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.entityName.localeCompare(b.entityName);
  });
}
