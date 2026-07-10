import { assertEquals } from '@std/assert';
import { trashGuideSourcesQueries, type TrashGuideSource } from '$db/queries/trashGuideSources.ts';
import { buildJobDisplayName, formatJobTypeLabel } from '$jobs/display.ts';

type Restore = () => void;

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

function makeSource(id: number, name: string): TrashGuideSource {
  return {
    id,
    name,
    repository_url: 'https://example.invalid/repo',
    branch: 'master',
    local_path: '/tmp/trash',
    arr_type: 'radarr',
    score_profile: 'default',
    sync_strategy: 0,
    auto_pull: false,
    enabled: true,
    last_synced_at: null,
    last_commit_hash: null,
    created_at: '2026-02-25T00:00:00.000Z',
    updated_at: '2026-02-25T00:00:00.000Z',
  };
}

Deno.test('formatJobTypeLabel maps trashguide.sync to the TRaSH Sync label', () => {
  assertEquals(formatJobTypeLabel('trashguide.sync'), 'TRaSH Sync');
});

Deno.test('buildJobDisplayName resolves the live source name first', () => {
  const restores: Restore[] = [];
  try {
    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      ((id: number) => makeSource(id, 'Live Name')) as typeof trashGuideSourcesQueries.getById,
      restores
    );

    assertEquals(buildJobDisplayName('trashguide.sync', { sourceId: 7 }), 'TRaSH Sync - Live Name');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('buildJobDisplayName falls back to the payload snapshot name when the source is gone', () => {
  const restores: Restore[] = [];
  try {
    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() => undefined) as typeof trashGuideSourcesQueries.getById,
      restores
    );

    assertEquals(
      buildJobDisplayName('trashguide.sync', { sourceId: 7, sourceName: 'Snapshot Name' }),
      'TRaSH Sync - Snapshot Name'
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('buildJobDisplayName falls back to the bare id when no live or snapshot name exists', () => {
  const restores: Restore[] = [];
  try {
    patchTarget(
      trashGuideSourcesQueries,
      'getById',
      (() => undefined) as typeof trashGuideSourcesQueries.getById,
      restores
    );

    assertEquals(buildJobDisplayName('trashguide.sync', { sourceId: 7 }), 'TRaSH Sync - #7');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
