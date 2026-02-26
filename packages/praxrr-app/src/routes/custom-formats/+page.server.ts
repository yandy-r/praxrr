import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import type { SourceRef } from '$shared/sources/types.ts';

function sourceKey(source: SourceRef): string {
  return `${source.type}:${source.id}`;
}

function buildSourceContext(databases: ReturnType<typeof pcdManager.getAll>) {
  const allTrashSources = trashGuideManager.listSources();
  const trashSources = allTrashSources.filter((source) => source.entityCounts.customFormats > 0);
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
      name: source.name,
      arrType: source.arrType,
    })),
  ];

  const showAllSourcesTab = availableSources.length >= 2;
  const defaultSourceKey = databases[0]
    ? sourceKey({
        type: 'pcd',
        id: databases[0].id,
        name: databases[0].name,
      })
    : availableSources[0]
      ? sourceKey(availableSources[0])
      : 'all';

  let filterDisabledReason: string | null = null;
  if (availableSources.length === 0) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide custom formats'
      : 'No custom format sources are available';
  } else if (!showAllSourcesTab) {
    filterDisabledReason = hasTrashSourceMismatch
      ? 'Linked TRaSH sources do not currently provide custom formats'
      : 'Source filtering requires at least two sources';
  }

  return {
    availableSources,
    showAllSourcesTab,
    defaultSourceKey,
    filterDisabledReason,
  };
}

export const load: ServerLoad = () => {
  // Get all databases
  const databases = pcdManager.getAll();
  const sourceContext = buildSourceContext(databases);

  return {
    databases,
    sourceContext,
  };
};
