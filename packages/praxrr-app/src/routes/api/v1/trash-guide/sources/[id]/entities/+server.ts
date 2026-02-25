import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
  type TrashGuideEntityCache,
  type TrashGuideEntityType,
  trashGuideEntityCacheQueries,
} from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { isTrashGuideSupportedArrType } from '$lib/server/trashguide/types.ts';
import { mapReadErrorStatus, parseSourceId, toErrorMessage } from '../_helpers.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(['custom_format', 'quality_profile', 'quality_size', 'naming']);

export const GET: RequestHandler = ({ params, url }) => {
  const sourceIdResult = parseSourceId(params.id);
  if ('error' in sourceIdResult) {
    return json({ error: sourceIdResult.error }, { status: 400 });
  }

  const sourceId = sourceIdResult.value;

  let source: ReturnType<typeof trashGuideManager.getSource>;
  try {
    source = trashGuideManager.getSource(sourceId);
  } catch (error) {
    const status = mapReadErrorStatus(error);
    return json({ error: toErrorMessage(error) }, { status });
  }

  const filtersResult = parseFilters(url.searchParams, source.arrType);
  if ('error' in filtersResult) {
    return json({ error: filtersResult.error }, { status: filtersResult.status });
  }

  const paginationResult = parsePagination(url.searchParams);
  if ('error' in paginationResult) {
    return json({ error: paginationResult.error }, { status: 400 });
  }

  try {
    const entities = trashGuideEntityCacheQueries.getBySource(sourceId);
    if (!isSourceOwnedEntitySet(entities, sourceId)) {
      return json({ error: 'TRaSH source ownership validation failed for entity cache rows' }, { status: 500 });
    }

    const filteredEntities = filterEntities(entities, filtersResult.value.type, filtersResult.value.search);
    const page = filteredEntities.slice(
      paginationResult.value.offset,
      paginationResult.value.offset + paginationResult.value.limit
    );
    const nextOffset = paginationResult.value.offset + page.length;
    const hasMore = nextOffset < filteredEntities.length;

    return json({
      entities: page.map(toEntityResponse),
      pagination: {
        limit: paginationResult.value.limit,
        offset: paginationResult.value.offset,
        nextCursor: hasMore ? String(nextOffset) : null,
        total: filteredEntities.length,
        hasMore,
      },
    });
  } catch (error) {
    return json({ error: toErrorMessage(error) }, { status: 500 });
  }
};

function parseFilters(
  searchParams: URLSearchParams,
  sourceArrType: 'radarr' | 'sonarr'
): { value: { type?: TrashGuideEntityType; search?: string } } | { status: 400 | 422; error: string } {
  const typeRaw = searchParams.get('type');
  let type: TrashGuideEntityType | undefined;
  if (typeRaw !== null) {
    const trimmed = typeRaw.trim();
    if (!trimmed) {
      return { status: 400, error: 'type cannot be empty when provided' };
    }

    if (!VALID_ENTITY_TYPES.has(trimmed)) {
      return { status: 422, error: `Invalid type filter: ${trimmed}` };
    }

    type = trimmed as TrashGuideEntityType;
  }

  const searchRaw = searchParams.get('search');
  const search = searchRaw?.trim() ? searchRaw.trim() : undefined;

  const arrTypeRaw = searchParams.get('arrType');
  if (arrTypeRaw !== null) {
    const arrType = arrTypeRaw.trim();
    if (!arrType) {
      return { status: 400, error: 'arrType cannot be empty when provided' };
    }

    if (!isTrashGuideSupportedArrType(arrType)) {
      return { status: 422, error: `Invalid arrType filter: ${arrType}` };
    }

    if (arrType !== sourceArrType) {
      return { status: 422, error: `arrType filter mismatch for source: expected ${sourceArrType}` };
    }
  }

  return {
    value: {
      type,
      search,
    },
  };
}

function parsePagination(
  searchParams: URLSearchParams
): { value: { limit: number; offset: number } } | { error: string } {
  const cursorRaw = searchParams.get('cursor');
  const offsetRaw = searchParams.get('offset');

  if (cursorRaw !== null && offsetRaw !== null) {
    return { error: 'Provide either cursor or offset, not both' };
  }

  const limit = parseBoundedInt(searchParams.get('limit'), {
    param: 'limit',
    min: 1,
    max: MAX_LIMIT,
    defaultValue: DEFAULT_LIMIT,
  });
  if ('error' in limit) {
    return limit;
  }

  const offset = parseBoundedInt(cursorRaw ?? offsetRaw, {
    param: cursorRaw !== null ? 'cursor' : 'offset',
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    defaultValue: 0,
  });
  if ('error' in offset) {
    return offset;
  }

  return {
    value: {
      limit: limit.value,
      offset: offset.value,
    },
  };
}

function parseBoundedInt(
  value: string | null,
  options: {
    param: string;
    min: number;
    max: number;
    defaultValue: number;
  }
): { value: number } | { error: string } {
  if (value === null) {
    return { value: options.defaultValue };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${options.param} cannot be empty` };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { error: `${options.param} must be an integer` };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < options.min || parsed > options.max) {
    return {
      error: `${options.param} must be between ${options.min} and ${options.max}`,
    };
  }

  return { value: parsed };
}

function isSourceOwnedEntitySet(entities: TrashGuideEntityCache[], sourceId: number): boolean {
  return entities.every((entity) => entity.sourceId === sourceId);
}

function filterEntities(
  entities: TrashGuideEntityCache[],
  type?: TrashGuideEntityType,
  search?: string
): TrashGuideEntityCache[] {
  const query = search?.toLocaleLowerCase();

  return entities.filter((entity) => {
    if (type && entity.entityType !== type) {
      return false;
    }

    if (query && !entity.name.toLocaleLowerCase().includes(query)) {
      return false;
    }

    return true;
  });
}

function toEntityResponse(entity: TrashGuideEntityCache): {
  trashId: string;
  type: TrashGuideEntityType;
  name: string;
  filePath: string;
  fetchedAt: string;
  entity: Record<string, unknown>;
  scores?: Record<string, number>;
  group?: number | null;
} {
  const parsed = parseEntityData(entity);

  const response: {
    trashId: string;
    type: TrashGuideEntityType;
    name: string;
    filePath: string;
    fetchedAt: string;
    entity: Record<string, unknown>;
    scores?: Record<string, number>;
    group?: number | null;
  } = {
    trashId: entity.trashId,
    type: entity.entityType,
    name: entity.name,
    filePath: entity.filePath,
    fetchedAt: entity.fetchedAt,
    entity: parsed,
  };

  if (entity.entityType === 'custom_format' && isNumberRecord(parsed.scores)) {
    response.scores = parsed.scores;
  }

  if (entity.entityType === 'quality_profile') {
    response.group = typeof parsed.group === 'number' ? parsed.group : null;
  }

  return response;
}

function parseEntityData(entity: TrashGuideEntityCache): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entity.jsonData);
  } catch {
    throw new Error(`Invalid TRaSH cached JSON for source=${entity.sourceId} trashId=${entity.trashId}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Unexpected TRaSH cached payload shape for source=${entity.sourceId} trashId=${entity.trashId}`);
  }

  return parsed as Record<string, unknown>;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'number');
}
