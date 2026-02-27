import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { parseCachedEntity } from '$lib/server/trashguide/displayTransform.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { isTrashGuideEntityType, type TrashGuideEntityType } from '$shared/trashguide/types.ts';
import { logTrashGuideRouteError, mapReadErrorStatus, parseSourceId, toErrorMessage } from '../../_helpers.ts';

/**
 * GET /api/v1/trash-guide/sources/[id]/entities/[trashId]
 *
 * Return a single cached TRaSH entity by its trashId and entity type.
 *
 * @param {{ params: { id?: string; trashId?: string }; url: URL }} event - Route event.
 * @param {string | undefined} event.params.id - Source id.
 * @param {string | undefined} event.params.trashId - TRaSH entity identifier.
 * @param {URL} event.url - Request URL with required `type` query parameter.
 * @returns {Promise<Response>} JSON response with entity detail.
 * @throws {never} Validation failures are returned as JSON error responses.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const sourceIdResult = parseSourceId(params.id);
  if ('error' in sourceIdResult) {
    return json({ error: sourceIdResult.error }, { status: 400 });
  }

  const sourceId = sourceIdResult.value;

  const trashId = params.trashId?.trim();
  if (!trashId) {
    return json({ error: 'Missing trashId parameter' }, { status: 400 });
  }

  const typeRaw = url.searchParams.get('type');
  if (typeRaw === null) {
    return json({ error: 'Missing required type query parameter' }, { status: 400 });
  }

  const typeTrimmed = typeRaw.trim();
  if (!typeTrimmed) {
    return json({ error: 'type cannot be empty' }, { status: 400 });
  }

  if (!isTrashGuideEntityType(typeTrimmed)) {
    return json({ error: `Invalid entity type: ${typeTrimmed}` }, { status: 422 });
  }

  const entityType: TrashGuideEntityType = typeTrimmed;

  let source: ReturnType<typeof trashGuideManager.getSource>;
  try {
    source = trashGuideManager.getSource(sourceId);
  } catch (error) {
    const status = mapReadErrorStatus(error);
    if (status >= 500) {
      await logTrashGuideRouteError(error, `Failed to fetch TRaSH source id=${sourceId} before entity lookup`);
    }
    return json({ error: toErrorMessage(error) }, { status });
  }

  try {
    const entity = trashGuideEntityCacheQueries.getByKey(sourceId, trashId, entityType);
    if (!entity) {
      return json({ error: `Entity not found: trashId=${trashId} type=${entityType}` }, { status: 404 });
    }

    const parsed = parseCachedEntity(entity, entityType);
    if (!parsed) {
      throw new Error(`Invalid TRaSH cached payload for source=${sourceId} trashId=${trashId} type=${entityType}`);
    }

    return json({
      source: { type: 'trash' as const, id: source.id, name: source.name, arrType: source.arrType },
      trashId: entity.trashId,
      type: entity.entityType,
      name: entity.name,
      filePath: entity.filePath,
      fetchedAt: entity.fetchedAt,
      entity: parsed,
    });
  } catch (error) {
    await logTrashGuideRouteError(error, `Failed to fetch TRaSH entity trashId=${trashId} source=${sourceId}`);
    return json({ error: toErrorMessage(error) }, { status: 500 });
  }
};
