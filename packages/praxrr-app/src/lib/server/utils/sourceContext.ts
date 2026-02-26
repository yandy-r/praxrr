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

export function sourceKey(source: Pick<SourceRef, 'type' | 'id'> & { name?: string }): string {
  return `${source.type}:${source.id}`;
}

export function isTrashSource(source: SourceRef): source is Extract<SourceRef, { type: 'trash' }> {
  return source.type === 'trash';
}

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
