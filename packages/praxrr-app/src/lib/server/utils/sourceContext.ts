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
 * Build a stable source key from a source reference.
 *
 * @param source - Source object with `type` and `id`.
 * @returns A stable key string for storage and routing.
 */
export function sourceKey(source: Pick<SourceRef, 'type' | 'id'> & { name?: string }): string {
  return `${source.type}:${source.id}`;
}

/**
 * Type guard for TRaSH sources.
 *
 * @param source - Source reference to test.
 * @returns True when source type is `trash`.
 */
export function isTrashSource(source: SourceRef): source is Extract<SourceRef, { type: 'trash' }> {
  return source.type === 'trash';
}

/**
 * Attach PCD source metadata to database rows.
 *
 * @param rows - Rows returned from a query.
 * @param database - Database owning the rows.
 * @returns Rows enriched with source metadata.
 */
export function withPcdSource<TRow extends object, TDatabase extends DatabaseLike>(
  rows: readonly TRow[],
  database: TDatabase
): Array<
  TRow & {
    sourceType: 'pcd';
    sourceDatabaseId: number;
    sourceDatabaseName: string;
  }
> {
  return rows.map((row) => ({
    ...row,
    sourceType: 'pcd' as const,
    sourceDatabaseId: database.id,
    sourceDatabaseName: database.name,
  }));
}

/**
 * Sort rows by name, then delegate to a source-specific tie-breaker.
 *
 * @param rows - Unsorted rows.
 * @param compareSource - Comparator for rows with equal names.
 * @returns Sorted copy of rows.
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
 * Build source context used by list/detail pages.
 *
 * @param databases - Available PCD databases.
 * @param currentDatabase - Optional currently selected database.
 * @param allTrashSources - All linked TRaSH sources.
 * @param getTrashSourceEntityCount - Count accessor for source rows.
 * @param getTrashSourceName - Name accessor for source rows.
 * @param sourceLabel - Human-friendly label used for empty-state messages.
 * @returns Source context object for UI filtering.
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
 * Call a source list accessor and handle uninitialized DB as an empty set.
 *
 * @param options - List callback and optional error handler.
 * @returns Source list, or empty on initialization errors.
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
 * Call a database resolver and propagate errors.
 *
 * @param options - Resolver callback and optional error handler.
 * @returns Resolved DB list.
 * @throws Re-throws non-initialization errors from resolver.
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
