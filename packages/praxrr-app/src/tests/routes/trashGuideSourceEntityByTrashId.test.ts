import { assertEquals, assertStringIncludes } from '@std/assert';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { GET as sourceEntityByTrashIdGet } from '../../routes/api/v1/trash-guide/sources/[id]/entities/[trashId]/+server.ts';

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

function createSourceResponse(id: number, arrType: 'radarr' | 'sonarr') {
  return {
    id,
    name: `TRaSH ${arrType} ${id}`,
    repositoryUrl: `https://example.com/${arrType}.git`,
    branch: 'master',
    arrType,
    scoreProfile: 'default',
    autoPull: true,
    enabled: true,
    syncStrategy: 60,
    lastSyncedAt: null,
    lastCommitHash: null,
    entityCounts: {
      customFormats: 0,
      qualityProfiles: 0,
      qualitySizes: 0,
      naming: 0,
    },
  };
}

Deno.test('trash guide entity-by-trashId GET returns 500 for malformed typed payload', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideManager,
    'getSource',
    (() => createSourceResponse(51, 'radarr')) as typeof trashGuideManager.getSource,
    restores
  );
  patchTarget(
    trashGuideEntityCacheQueries,
    'getByKey',
    (() => ({
      id: 1,
      sourceId: 51,
      trashId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      entityType: 'quality_profile' as const,
      name: 'Invalid QP',
      jsonData: JSON.stringify({
        entity_type: 'custom_format',
        name: 'Wrong type payload',
        file_path: 'custom-formats/wrong.json',
        specifications: [],
      }),
      filePath: 'quality-profiles/invalid.json',
      contentHash: 'hash-invalid',
      fetchedAt: '2026-02-27T00:00:00.000Z',
    })) as typeof trashGuideEntityCacheQueries.getByKey,
    restores
  );

  try {
    const response = await sourceEntityByTrashIdGet({
      params: {
        id: '51',
        trashId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      url: new URL(
        'http://localhost/api/v1/trash-guide/sources/51/entities/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?type=quality_profile'
      ),
    } as unknown as Parameters<typeof sourceEntityByTrashIdGet>[0]);

    assertEquals(response.status, 500);
    const payload = (await response.json()) as { error: string };
    assertStringIncludes(payload.error, 'Invalid TRaSH cached payload');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trash guide entity-by-trashId GET returns parsed entity payload for valid type', async () => {
  const restores: Restore[] = [];
  patchTarget(
    trashGuideManager,
    'getSource',
    (() => createSourceResponse(52, 'sonarr')) as typeof trashGuideManager.getSource,
    restores
  );
  patchTarget(
    trashGuideEntityCacheQueries,
    'getByKey',
    (() => ({
      id: 1,
      sourceId: 52,
      trashId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      entityType: 'quality_profile' as const,
      name: 'Valid QP',
      jsonData: JSON.stringify({
        entity_type: 'quality_profile',
        name: 'Valid QP',
        file_path: 'quality-profiles/valid.json',
        upgrade_allowed: true,
      }),
      filePath: 'quality-profiles/valid.json',
      contentHash: 'hash-valid',
      fetchedAt: '2026-02-27T00:00:00.000Z',
    })) as typeof trashGuideEntityCacheQueries.getByKey,
    restores
  );

  try {
    const response = await sourceEntityByTrashIdGet({
      params: {
        id: '52',
        trashId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      url: new URL(
        'http://localhost/api/v1/trash-guide/sources/52/entities/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?type=quality_profile'
      ),
    } as unknown as Parameters<typeof sourceEntityByTrashIdGet>[0]);

    assertEquals(response.status, 200);
    const payload = (await response.json()) as {
      source: {
        type: 'trash';
        id: number;
        name: string;
        arrType: 'radarr' | 'sonarr';
      };
      trashId: string;
      type: 'quality_profile';
      name: string;
      filePath: string;
      fetchedAt: string;
      entity: {
        entity_type: 'quality_profile';
        name: string;
        file_path: string;
        upgrade_allowed: boolean;
      };
    };

    assertEquals(payload.source, {
      type: 'trash',
      id: 52,
      name: 'TRaSH sonarr 52',
      arrType: 'sonarr',
    });
    assertEquals(payload.trashId, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    assertEquals(payload.type, 'quality_profile');
    assertEquals(payload.entity.entity_type, 'quality_profile');
    assertEquals(payload.entity.upgrade_allowed, true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
