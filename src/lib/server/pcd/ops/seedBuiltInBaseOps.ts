import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import {
  LIDARR_MEDIA_MANAGEMENT_OP_FILENAME,
  LIDARR_MEDIA_MANAGEMENT_OP_METADATA,
  LIDARR_MEDIA_MANAGEMENT_OP_SQL,
  LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
} from '$db/migrations/20260215_add_lidarr_media_management_entities.ts';
import {
  LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME,
  LIDARR_NATIVE_QUALITY_MAPPINGS_OP_METADATA,
  LIDARR_NATIVE_QUALITY_MAPPINGS_OP_SQL,
  LIDARR_NATIVE_QUALITY_MAPPINGS_OP_VERSION,
} from '$db/migrations/20260216_enforce_native_lidarr_quality_mappings.ts';
import {
  LIDARR_NAMING_DEFAULTS_OP_FILENAME,
  LIDARR_NAMING_DEFAULTS_OP_METADATA,
  LIDARR_NAMING_DEFAULTS_OP_SQL,
  LIDARR_NAMING_DEFAULTS_OP_VERSION,
} from '$db/migrations/20260217_set_lidarr_naming_defaults.ts';
import {
  LIDARR_METADATA_PROFILES_OP_FILENAME,
  LIDARR_METADATA_PROFILES_OP_METADATA,
  LIDARR_METADATA_PROFILES_OP_SQL,
  LIDARR_METADATA_PROFILES_OP_VERSION,
} from '$db/migrations/20260218_add_lidarr_metadata_profiles.ts';

export interface SeedBuiltInBaseOpsResult {
  created: number;
  skipped: number;
}

export async function seedBuiltInBaseOps(databaseId: number): Promise<SeedBuiltInBaseOpsResult> {
  const builtInOps = [
    {
      filename: LIDARR_MEDIA_MANAGEMENT_OP_FILENAME,
      opNumber: LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
      sequence: LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
      sql: LIDARR_MEDIA_MANAGEMENT_OP_SQL,
      metadata: LIDARR_MEDIA_MANAGEMENT_OP_METADATA,
    },
    {
      filename: LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME,
      opNumber: LIDARR_NATIVE_QUALITY_MAPPINGS_OP_VERSION,
      sequence: LIDARR_NATIVE_QUALITY_MAPPINGS_OP_VERSION,
      sql: LIDARR_NATIVE_QUALITY_MAPPINGS_OP_SQL,
      metadata: LIDARR_NATIVE_QUALITY_MAPPINGS_OP_METADATA,
    },
    {
      filename: LIDARR_NAMING_DEFAULTS_OP_FILENAME,
      opNumber: LIDARR_NAMING_DEFAULTS_OP_VERSION,
      sequence: LIDARR_NAMING_DEFAULTS_OP_VERSION,
      sql: LIDARR_NAMING_DEFAULTS_OP_SQL,
      metadata: LIDARR_NAMING_DEFAULTS_OP_METADATA,
    },
    {
      filename: LIDARR_METADATA_PROFILES_OP_FILENAME,
      opNumber: LIDARR_METADATA_PROFILES_OP_VERSION,
      sequence: LIDARR_METADATA_PROFILES_OP_VERSION,
      sql: LIDARR_METADATA_PROFILES_OP_SQL,
      metadata: LIDARR_METADATA_PROFILES_OP_METADATA,
    },
  ] as const;

  let created = 0;
  let skipped = 0;

  for (const op of builtInOps) {
    const existing = pcdOpsQueries.getBaseByFilename(databaseId, op.filename);
    if (existing) {
      skipped++;
      continue;
    }

    pcdOpsQueries.create({
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'local',
      filename: op.filename,
      opNumber: op.opNumber,
      sequence: op.sequence,
      sql: op.sql,
      metadata: op.metadata,
    });
    created++;
  }

  await logger.debug('Seeded built-in base ops for database', {
    source: 'PCDBaseOpSeeder',
    meta: {
      databaseId,
      created,
      skipped,
      filenames: builtInOps.map((op) => op.filename),
    },
  });

  return { created, skipped };
}
