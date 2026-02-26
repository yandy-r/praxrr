import type { SourceRef } from '$shared/sources/types.ts';
import type { ArrAppType } from '$shared/arr/capabilities.ts';
import { DatabaseNotInitializedError } from '$db/db.ts';

export type SourceContext = {
  availableSources: SourceRef[];
  showAllSourcesTab: boolean;
  defaultSourceKey: string;
  filterDisabledReason: string | null;
};

export type DatabaseLike = {
  id: number;
  name: string;
};

export type SourceEntityCountAccessor<TSource> = (source: TSource) => number;
export type SourceNameAccessor<TSource> = (source: TSource) => string;
export type SourceForContext = {
  id: number;
  name: string;
  arrType: ArrAppType;
};

export type DatabaseNotInitializedHandler = (error: DatabaseNotInitializedError) => void;

export type ListTrashSourcesOptions<TSource> = {
  listSources: () => readonly TSource[];
  onDatabaseNotInitialized?: DatabaseNotInitializedHandler;
};

export type ResolveDatabasesOptions<TDatabase> = {
  resolveDatabases: () => readonly TDatabase[];
  onDatabaseNotInitialized?: DatabaseNotInitializedHandler;
};

/**
 * Returns a unique string key for a source reference combining its type and ID.
 *
 * @param source - The source reference to generate a key for
 * @returns A string in the format `'type:id'`
 */
export function sourceKey(source: Pick<SourceRef, 'type' | 'id'> & { name?: string }): string {
  return `${source.type}:${source.id}`;
}

/**
 * Type guard that returns true if the source reference is a trash (TRaSH) source.
 *
 * @param source - The source reference to test
 * @returns Whether the source is a TRaSH source
 */
export function isTrashSource(source: SourceRef): source is Extract<SourceRef, { type: 'trash' }> {
  return source.type === 'trash';
}

/**
 * Augments a set of rows with PCD source metadata from the given database.
 *
 * @param rows - The rows to augment with PCD source fields
 * @param database - The PCD database to source metadata from
 * @returns An array of rows each extended with `sourceType`, `sourceDatabaseId`, and `sourceDatabaseName`
 */
export function withPcdSource<TRow extends object, TDatabase extends DatabaseLike>(
  rows: readonly TRow[],
  database: TDatabase
): Array<TRow & {
  sourceType: 'pcd';
  sourceDatabaseId: number;
  sourceDatabaseName: string;
}> {
  return rows.map((row) => ({
    ...row,
    sourceType: 'pcd' as const,
    sourceDatabaseId: database.id,
    sourceDatabaseName: database.name,
  }));
}

/**
 * Sorts rows case-insensitively by name, using a secondary comparator for tie-breaking.
 *
 * @param rows - The rows to sort
 * @param compareSource - A secondary comparator applied when two rows have the same name
 * @returns A new sorted array of rows
 */
export function sortRowsByNameAndSource<T extends { name: string }>(
  rows: readonly T[],
  compareSource: (a: T, b: T) => number
): T[] {
  return [...rows].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;

    return compareSource(a, b);
  });
}

/**
 * Builds the full source context (available sources, default key, filter disabled reason) for a UI
 * entity list.
 *
 * @param databases - The list of linked PCD databases
 * @param currentDatabase - The currently active database, or undefined
 * @param allTrashSources - All available TRaSH sources
 * @param getTrashSourceEntityCount - Accessor returning the entity count for a TRaSH source
 * @param getTrashSourceName - Accessor returning the display name for a TRaSH source
 * @param sourceLabel - A human-readable label for the entity type shown in disabled-reason messages
 * @returns A `SourceContext` for use in UI source-filter components
 */
export function buildSourceContext<TSource extends SourceForContext, TDatabase extends DatabaseLike>(
  databases: readonly TDatabase[],
  currentDatabase: TDatabase | undefined,
  allTrashSources: readonly TSource[],
  getTrashSourceEntityCount: SourceEntityCountAccessor<TSource>,
  getTrashSourceName: SourceNameAccessor<TSource>,
  sourceLabel: string
): SourceContext {
  const trashSources = allTrashSources.filter((source) => getTrashSourceEntityCount(source) > 0);
  const hasTrashSourceMismatch = allTrashSources.length > 0 && trashSources.length === 0;

  const availableSources: SourceRef[] = [
    ...databases.map((database) => ({
      type: 'pcd' as const,
      id: database.id,
      name: database.name,
    })),
    ...trashSources.map((source) => ({
      type: 'trash' as const,
      id: source.id,
      name: getTrashSourceName(source),
      arrType: source.arrType,
    })),
  ];

  const showAllSourcesTab = availableSources.length >= 2;
  const defaultSourceKey = currentDatabase
    ? sourceKey({ type: 'pcd', id: currentDatabase.id, name: currentDatabase.name })
    : availableSources[0]
      ? sourceKey(availableSources[0])
      : 'all';

  let filterDisabledReason: string | null = null;
  if (availableSources.length === 0) {
    filterDisabledReason = hasTrashSourceMismatch
      ? `Linked TRaSH sources do not currently provide ${sourceLabel}`
      : `No ${sourceLabel} sources are available`;
  } else if (!showAllSourcesTab) {
    filterDisabledReason = hasTrashSourceMismatch
      ? `Linked TRaSH sources do not currently provide ${sourceLabel}`
      : 'Source filtering requires at least two sources';
  }

  return {
    availableSources,
    showAllSourcesTab,
    defaultSourceKey,
    filterDisabledReason,
  };
}

/**
 * Lists trash sources, returning an empty array if the database is not yet initialized.
 *
 * @param options - Options including the `listSources` function and optional error handler
 * @returns The list of trash sources, or an empty array on `DatabaseNotInitializedError`
 */
export function listTrashSourcesSafely<TSource>(options: ListTrashSourcesOptions<TSource>): readonly TSource[] {
  try {
    return options.listSources();
  } catch (error) {
    if (error instanceof DatabaseNotInitializedError) {
      options.onDatabaseNotInitialized?.(error);
      return [];
    }

    throw error;
  }
}

/**
 * Resolves databases, propagating database-not-initialized errors via the optional handler.
 *
 * @param options - Options including the `resolveDatabases` function and optional error handler
 * @returns The resolved list of databases
 * @throws {DatabaseNotInitializedError} When no handler is provided and the database is not initialized
 */
export function resolveDatabases<TDatabase extends DatabaseLike>(
  options: ResolveDatabasesOptions<TDatabase>
): readonly TDatabase[] {
  try {
    return options.resolveDatabases();
  } catch (error) {
    if (error instanceof DatabaseNotInitializedError) {
      options.onDatabaseNotInitialized?.(error);
    }

    throw error;
  }
}
