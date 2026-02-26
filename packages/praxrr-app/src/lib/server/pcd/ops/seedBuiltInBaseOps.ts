import { logger } from '$logger/logger.ts';

export interface SeedBuiltInBaseOpsResult {
  created: number;
  skipped: number;
}

/**
 * Seed built-in base ops for a newly initialized PCD database.
 *
 * Registers any hard-coded built-in ops that should be present in every database without
 * requiring a repo import. Currently a no-op placeholder; add entries here as built-ins are introduced.
 *
 * @param databaseId - The PCD database instance ID to seed
 * @returns Counts of created and skipped ops
 */
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
