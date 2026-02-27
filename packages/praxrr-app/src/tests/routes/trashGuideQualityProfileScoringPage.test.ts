import { assertEquals } from '@std/assert';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { load as scoringLoad } from '../../routes/databases/trash/[id]/quality-profiles/[trashId]/scoring/+page.server.ts';

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

Deno.test('quality profile scoring load resolves scores using referenced custom-format ids only', async () => {
  const restores: Restore[] = [];
  let capturedLookupArgs: {
    sourceId: number;
    entityType: string;
    trashIds: string[];
  } | null = null;

  patchTarget(
    trashGuideEntityCacheQueries,
    'getByKey',
    (() => ({
      id: 1,
      sourceId: 73,
      trashId: 'cccccccccccccccccccccccccccccccc',
      entityType: 'quality_profile' as const,
      name: 'TRaSH QP',
      jsonData: JSON.stringify({
        entity_type: 'quality_profile',
        name: 'TRaSH QP',
        file_path: 'quality-profiles/trash-qp.json',
        upgrade_allowed: true,
        score_set: 'anime',
        format_items: [
          {
            name: 'Referenced CF',
            score: null,
            custom_format_trash_id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          },
          {
            name: 'Inline score',
            score: 222,
            custom_format_trash_id: null,
          },
        ],
      }),
      filePath: 'quality-profiles/trash-qp.json',
      contentHash: 'hash-qp',
      fetchedAt: '2026-02-27T00:00:00.000Z',
    })) as typeof trashGuideEntityCacheQueries.getByKey,
    restores
  );

  patchTarget(
    trashGuideEntityCacheQueries,
    'getBySourceTypeAndTrashIds',
    ((sourceId, entityType, trashIds) => {
      capturedLookupArgs = { sourceId, entityType, trashIds: [...trashIds] };
      return [
        {
          id: 2,
          sourceId,
          trashId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          entityType: 'custom_format',
          name: 'Referenced CF',
          jsonData: JSON.stringify({
            entity_type: 'custom_format',
            name: 'Referenced CF',
            file_path: 'custom-formats/referenced.json',
            specifications: [],
            scores: {
              anime: 123,
              default: 50,
            },
          }),
          filePath: 'custom-formats/referenced.json',
          contentHash: 'hash-cf',
          fetchedAt: '2026-02-27T00:00:00.000Z',
        },
      ];
    }) as typeof trashGuideEntityCacheQueries.getBySourceTypeAndTrashIds,
    restores
  );

  try {
    const result = (await scoringLoad({
      params: {
        id: '73',
        trashId: 'cccccccccccccccccccccccccccccccc',
      },
      parent: async () => ({
        source: {
          id: 73,
          name: 'TRaSH Source',
          arrType: 'radarr',
        },
      }),
    } as unknown as Parameters<typeof scoringLoad>[0])) as {
      scoringItems: Array<{
        name: string;
        score: number | null;
        custom_format_trash_id: string | null;
      }>;
    };

    assertEquals(capturedLookupArgs, {
      sourceId: 73,
      entityType: 'custom_format',
      trashIds: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    });
    assertEquals(result.scoringItems, [
      {
        name: 'Referenced CF',
        score: 123,
        custom_format_trash_id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      {
        name: 'Inline score',
        score: 222,
        custom_format_trash_id: null,
      },
    ]);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
