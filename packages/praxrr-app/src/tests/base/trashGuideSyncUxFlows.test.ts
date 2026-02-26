import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { load as customFormatsIndexLoad } from '../../routes/custom-formats/+page.server.ts';
import { load as qualityProfilesIndexLoad } from '../../routes/quality-profiles/+page.server.ts';
import { pcdManager } from '../../lib/server/pcd/index.ts';
import { trashGuideManager, type TrashGuideSourceResponse } from '../../lib/server/trashguide/manager.ts';
import type { DatabaseInstance } from '../../lib/server/db/queries/databaseInstances.ts';
import type { SourceRef } from '../../lib/shared/sources/types.ts';

type Restore = () => void;

interface SourceContextPayload {
  sourceContext: {
    availableSources: SourceRef[];
    showAllSourcesTab: boolean;
    defaultSourceKey: string;
    filterDisabledReason: string | null;
  };
}

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function restoreAll(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

function createDatabase(id: number, name: string): DatabaseInstance {
  return {
    id,
    uuid: `db-${id}`,
    name,
    repository_url: `https://example.com/${name.toLowerCase()}`,
    local_path: `/tmp/${name.toLowerCase()}`,
    sync_strategy: 0,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    has_personal_access_token: 0,
    is_private: 0,
    local_ops_enabled: 1,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function createTrashSource(
  id: number,
  name: string,
  arrType: TrashGuideSourceResponse['arrType'],
  entityCounts: TrashGuideSourceResponse['entityCounts']
): TrashGuideSourceResponse {
  return {
    id,
    name,
    repositoryUrl: `https://github.com/example/${name.toLowerCase().replace(/\s+/g, '-')}`,
    branch: 'main',
    arrType,
    scoreProfile: 'default',
    autoPull: true,
    enabled: true,
    syncStrategy: 0,
    lastSyncedAt: null,
    lastCommitHash: null,
    entityCounts,
  };
}

async function readFixture(relativePath: string): Promise<string> {
  return await Deno.readTextFile(new URL(relativePath, import.meta.url));
}

Deno.test('custom formats source context hides all-sources affordance for single-source state', async () => {
  const restores: Restore[] = [];

  patchTarget(pcdManager, 'getAll', (() => [createDatabase(11, 'Praxrr-DB')]) as typeof pcdManager.getAll, restores);
  patchTarget(trashGuideManager, 'listSources', (() => []) as typeof trashGuideManager.listSources, restores);

  try {
    const payload = (await customFormatsIndexLoad(
      {} as Parameters<typeof customFormatsIndexLoad>[0]
    )) as SourceContextPayload;

    assertEquals(payload.sourceContext.availableSources, [
      {
        type: 'pcd',
        id: 11,
        name: 'Praxrr-DB',
      },
    ]);
    assertEquals(payload.sourceContext.showAllSourcesTab, false);
    assertEquals(payload.sourceContext.defaultSourceKey, 'pcd:11');
    assertEquals(payload.sourceContext.filterDisabledReason, 'Source filtering requires at least two sources');
  } finally {
    restoreAll(restores);
  }
});

Deno.test(
  'custom formats source context enables all-sources state when two or more sources are available',
  async () => {
    const restores: Restore[] = [];
    const trashSource = createTrashSource(91, 'TRaSH Radarr', 'radarr', {
      customFormats: 12,
      qualityProfiles: 0,
      qualitySizes: 0,
      naming: 0,
    });

    patchTarget(pcdManager, 'getAll', (() => [createDatabase(11, 'Praxrr-DB')]) as typeof pcdManager.getAll, restores);
    patchTarget(
      trashGuideManager,
      'listSources',
      (() => [trashSource]) as typeof trashGuideManager.listSources,
      restores
    );

    try {
      const payload = (await customFormatsIndexLoad(
        {} as Parameters<typeof customFormatsIndexLoad>[0]
      )) as SourceContextPayload;

      assertEquals(payload.sourceContext.showAllSourcesTab, true);
      assertEquals(payload.sourceContext.defaultSourceKey, 'pcd:11');
      assertEquals(payload.sourceContext.filterDisabledReason, null);
      assertEquals(payload.sourceContext.availableSources, [
        {
          type: 'pcd',
          id: 11,
          name: 'Praxrr-DB',
        },
        {
          type: 'trash',
          id: 91,
          name: 'TRaSH Radarr',
          arrType: 'radarr',
        },
      ]);
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test(
  'custom formats source context surfaces mismatch empty-state messaging when TRaSH sources have zero entities',
  async () => {
    const restores: Restore[] = [];
    const trashSource = createTrashSource(92, 'TRaSH Sonarr', 'sonarr', {
      customFormats: 0,
      qualityProfiles: 8,
      qualitySizes: 0,
      naming: 0,
    });

    patchTarget(pcdManager, 'getAll', (() => [createDatabase(12, 'Main DB')]) as typeof pcdManager.getAll, restores);
    patchTarget(
      trashGuideManager,
      'listSources',
      (() => [trashSource]) as typeof trashGuideManager.listSources,
      restores
    );

    try {
      const payload = (await customFormatsIndexLoad(
        {} as Parameters<typeof customFormatsIndexLoad>[0]
      )) as SourceContextPayload;

      assertEquals(payload.sourceContext.availableSources, [
        {
          type: 'pcd',
          id: 12,
          name: 'Main DB',
        },
      ]);
      assertEquals(payload.sourceContext.showAllSourcesTab, false);
      assertEquals(
        payload.sourceContext.filterDisabledReason,
        'Linked TRaSH sources do not currently provide custom formats'
      );
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test(
  'quality profiles source context exposes explicit empty-state defaults when no sources are available',
  async () => {
    const restores: Restore[] = [];

    patchTarget(pcdManager, 'getAll', (() => []) as typeof pcdManager.getAll, restores);
    patchTarget(trashGuideManager, 'listSources', (() => []) as typeof trashGuideManager.listSources, restores);

    try {
      const payload = (await qualityProfilesIndexLoad(
        {} as Parameters<typeof qualityProfilesIndexLoad>[0]
      )) as SourceContextPayload;

      assertEquals(payload.sourceContext.availableSources, []);
      assertEquals(payload.sourceContext.showAllSourcesTab, false);
      assertEquals(payload.sourceContext.defaultSourceKey, 'all');
      assertEquals(payload.sourceContext.filterDisabledReason, 'No quality profile sources are available');
    } finally {
      restoreAll(restores);
    }
  }
);

Deno.test('quality profiles source context enables all-sources visibility for mixed PCD and TRaSH data', async () => {
  const restores: Restore[] = [];
  const trashSource = createTrashSource(33, 'TRaSH Sonarr', 'sonarr', {
    customFormats: 0,
    qualityProfiles: 5,
    qualitySizes: 0,
    naming: 0,
  });

  patchTarget(pcdManager, 'getAll', (() => [createDatabase(14, 'Music DB')]) as typeof pcdManager.getAll, restores);
  patchTarget(
    trashGuideManager,
    'listSources',
    (() => [trashSource]) as typeof trashGuideManager.listSources,
    restores
  );

  try {
    const payload = (await qualityProfilesIndexLoad(
      {} as Parameters<typeof qualityProfilesIndexLoad>[0]
    )) as SourceContextPayload;

    assertEquals(payload.sourceContext.showAllSourcesTab, true);
    assertEquals(payload.sourceContext.defaultSourceKey, 'pcd:14');
    assertEquals(payload.sourceContext.filterDisabledReason, null);
    assertEquals(payload.sourceContext.availableSources, [
      {
        type: 'pcd',
        id: 14,
        name: 'Music DB',
      },
      {
        type: 'trash',
        id: 33,
        name: 'TRaSH Sonarr',
        arrType: 'sonarr',
      },
    ]);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('source filter persistence wiring remains stable for custom formats and quality profiles pages', async () => {
  const customFormatsPage = await readFixture('../../routes/custom-formats/[databaseId]/+page.svelte');
  const qualityProfilesPage = await readFixture('../../routes/quality-profiles/[databaseId]/+page.svelte');

  assertStringIncludes(customFormatsPage, "const SOURCE_FILTER_STORAGE_PREFIX = 'customFormatsSourceFilter';");
  assertStringIncludes(
    customFormatsPage,
    'sourceFilterStorageKey = `${SOURCE_FILTER_STORAGE_PREFIX}:${data.currentDatabase.id}`;'
  );
  assertStringIncludes(
    customFormatsPage,
    'localStorage.setItem(sourceFilterStorageKey, JSON.stringify(selectedSourceKeys));'
  );

  assertStringIncludes(qualityProfilesPage, "const SOURCE_FILTER_STORAGE_KEY = 'qualityProfilesSourceFilter';");
  assertStringIncludes(qualityProfilesPage, 'const saved = localStorage.getItem(SOURCE_FILTER_STORAGE_KEY);');
  assertStringIncludes(
    qualityProfilesPage,
    'localStorage.setItem(SOURCE_FILTER_STORAGE_KEY, JSON.stringify(selectedSourceKeys));'
  );
});

Deno.test('source badge visibility and zero-result empty-state invariants stay wired to source context', async () => {
  const customFormatsPage = await readFixture('../../routes/custom-formats/[databaseId]/+page.svelte');
  const qualityProfilesPage = await readFixture('../../routes/quality-profiles/[databaseId]/+page.svelte');
  const trashGuideSourcesComponent = await readFixture(
    '../../routes/arr/[id]/sync/components/TrashGuideSources.svelte'
  );

  assertStringIncludes(customFormatsPage, '$: showSourceBadges = data.sourceContext.showAllSourcesTab;');
  assertMatch(customFormatsPage, /<TableView[\s\S]*\{showSourceBadges\}/);
  assertMatch(customFormatsPage, /<CardView[\s\S]*\{showSourceBadges\}/);

  assertMatch(qualityProfilesPage, /<TableView[\s\S]*showSourceBadges=\{data\.sourceContext\.showAllSourcesTab\}/);
  assertMatch(qualityProfilesPage, /<CardView[\s\S]*showSourceBadges=\{data\.sourceContext\.showAllSourcesTab\}/);

  assertStringIncludes(customFormatsPage, 'No custom formats match your selected sources');
  assertStringIncludes(customFormatsPage, 'Clear source filters');
  assertStringIncludes(qualityProfilesPage, 'No quality profiles match your selected sources');
  assertStringIncludes(trashGuideSourcesComponent, 'No TRaSH sources match your current filter');
  assertStringIncludes(trashGuideSourcesComponent, 'No enabled TRaSH Guide sources are linked for this instance type.');
});
