import { logger } from '$logger/logger.ts';

export interface SeedBuiltInBaseOpsResult {
  created: number;
  skipped: number;
}

export async function seedBuiltInBaseOps(databaseId: number): Promise<SeedBuiltInBaseOpsResult> {
  await logger.debug('Seeded built-in base ops for database', {
    source: 'PCDBaseOpSeeder',
    meta: {
      databaseId,
      created: 0,
      skipped: 0,
      filenames: [],
    },
  });

  return { created: 0, skipped: 0 };
}
