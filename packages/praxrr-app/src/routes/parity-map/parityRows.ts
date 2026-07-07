import {
  PARITY_ENTITIES,
  getEntitySupportStatus,
  type ParityEntity,
  type ParityStatus,
} from '$shared/arr/parity.ts';
import { ARR_APP_TYPES, type ArrAppType } from '$shared/pcd/types.ts';

/** One row of the Cross-Arr Parity Map matrix: an entity plus its per-app support status. */
export interface ParityRow {
  entity: ParityEntity;
  label: string;
  radarr: ParityStatus;
  sonarr: ParityStatus;
  lidarr: ParityStatus;
}

/** Human-readable label per parity entity, in matrix row order. */
const PARITY_ENTITY_LABELS = {
  custom_formats: 'Custom Formats',
  quality_profiles: 'Quality Profiles',
  quality_definitions: 'Quality Definitions',
  delay_profiles: 'Delay Profiles',
  metadata_profiles: 'Metadata Profiles',
} as const satisfies Record<ParityEntity, string>;

/** Resolve one parity entity's per-app status columns, keyed by app type. */
function buildAppColumns(entity: ParityEntity): Record<ArrAppType, ParityStatus> {
  const columns = {} as Record<ArrAppType, ParityStatus>;
  for (const app of ARR_APP_TYPES) {
    columns[app] = getEntitySupportStatus(app, entity);
  }
  return columns;
}

/**
 * Build the Cross-Arr Parity Map matrix rows: one row per `PARITY_ENTITIES` entry,
 * with each app column resolved via `getEntitySupportStatus`. Pure and Svelte-free
 * so it is unit-testable directly.
 */
export function buildParityRows(): ParityRow[] {
  return PARITY_ENTITIES.map((entity) => ({
    entity,
    label: PARITY_ENTITY_LABELS[entity],
    ...buildAppColumns(entity),
  }));
}
