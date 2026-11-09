import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { getConflictCountsByDatabase } from '$pcd/conflicts/counts.ts';
import type { DashboardDatabaseConflicts } from '$shared/dashboard/types.ts';

export interface ConflictSummary {
  total: number;
  databases: DashboardDatabaseConflicts[];
  databaseCount: number;
}

/** Conflicted-op counts per linked database (shared cached aggregate + the database list). */
export function summarizeConflicts(): ConflictSummary {
  const databases = databaseInstancesQueries.getAll();
  const counts = getConflictCountsByDatabase();

  const withConflicts: DashboardDatabaseConflicts[] = [];
  let total = 0;
  for (const database of databases) {
    const count = counts.get(database.id) ?? 0;
    if (count <= 0) continue;
    total += count;
    withConflicts.push({
      databaseId: database.id,
      databaseName: database.name,
      count,
      href: `/databases/${database.id}/conflicts`,
    });
  }

  return { total, databases: withConflicts, databaseCount: databases.length };
}
