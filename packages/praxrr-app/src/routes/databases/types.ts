import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';

export type DatabaseWithCache = DatabaseInstance & { cacheAvailable?: boolean };
