import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import {
  LIDARR_MEDIA_MANAGEMENT_OP_FILENAME,
  LIDARR_MEDIA_MANAGEMENT_OP_METADATA,
  LIDARR_MEDIA_MANAGEMENT_OP_SQL,
  LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
} from '$db/migrations/20260215_add_lidarr_media_management_entities.ts';

export interface SeedBuiltInBaseOpsResult {
  created: number;
  skipped: number;
}

export async function seedBuiltInBaseOps(databaseId: number): Promise<SeedBuiltInBaseOpsResult> {
  const existing = pcdOpsQueries.getBaseByFilename(databaseId, LIDARR_MEDIA_MANAGEMENT_OP_FILENAME);
  if (existing) {
    return { created: 0, skipped: 1 };
  }

  pcdOpsQueries.create({
    databaseId,
    origin: 'base',
    state: 'published',
    source: 'local',
    filename: LIDARR_MEDIA_MANAGEMENT_OP_FILENAME,
    opNumber: LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
    sequence: LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
    sql: LIDARR_MEDIA_MANAGEMENT_OP_SQL,
    metadata: LIDARR_MEDIA_MANAGEMENT_OP_METADATA,
  });

  await logger.debug('Seeded built-in base ops for database', {
    source: 'PCDBaseOpSeeder',
    meta: {
      databaseId,
      filename: LIDARR_MEDIA_MANAGEMENT_OP_FILENAME,
      created: 1,
      skipped: 0,
    },
  });

  return { created: 1, skipped: 0 };
}
