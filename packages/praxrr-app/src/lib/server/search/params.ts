import {
  isSearchArrType,
  isSearchResultType,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RESULT_TYPES,
  type SearchArrType,
  type SearchResultType,
} from '$shared/search/types.ts';

/** Typed HTTP error for search parameter validation; carries the status the route returns. */
export class SearchHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'SearchHttpError';
  }
}

export interface SearchParams {
  /** Trimmed query text, 1-100 characters. */
  query: string;
  types: ReadonlySet<SearchResultType>;
  arrType: SearchArrType;
  databaseId: number | null;
  limit: number;
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * Parse and validate `GET /api/v1/search` query parameters. Throws {@link SearchHttpError} (400)
 * on any invalid value; never silently coerces.
 */
export function parseSearchParams(url: URL): SearchParams {
  const rawQuery = url.searchParams.get('q');
  if (rawQuery === null) {
    throw new SearchHttpError(400, 'q is required');
  }
  const query = rawQuery.trim();
  if (query.length === 0) {
    throw new SearchHttpError(400, 'q must not be empty');
  }
  if (query.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new SearchHttpError(400, `q must be at most ${SEARCH_QUERY_MAX_LENGTH} characters`);
  }

  let types: ReadonlySet<SearchResultType> = new Set(SEARCH_RESULT_TYPES);
  const rawTypes = url.searchParams.get('types');
  if (rawTypes !== null) {
    const requested = rawTypes
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (requested.length === 0) {
      throw new SearchHttpError(400, 'types must list at least one result type');
    }
    const parsed = new Set<SearchResultType>();
    for (const value of requested) {
      if (!isSearchResultType(value)) {
        throw new SearchHttpError(400, `Unknown result type: ${value.slice(0, 40)}`);
      }
      parsed.add(value);
    }
    types = parsed;
  }

  const rawArrType = url.searchParams.get('arrType');
  let arrType: SearchArrType = 'all';
  if (rawArrType !== null) {
    if (!isSearchArrType(rawArrType)) {
      throw new SearchHttpError(400, 'arrType must be one of all, radarr, sonarr, lidarr');
    }
    arrType = rawArrType;
  }

  const rawDatabaseId = url.searchParams.get('databaseId');
  let databaseId: number | null = null;
  if (rawDatabaseId !== null) {
    if (!POSITIVE_INTEGER.test(rawDatabaseId) || !Number.isSafeInteger(Number(rawDatabaseId))) {
      throw new SearchHttpError(400, 'databaseId must be a positive integer');
    }
    databaseId = Number(rawDatabaseId);
  }

  const rawLimit = url.searchParams.get('limit');
  let limit = SEARCH_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    const parsedLimit = POSITIVE_INTEGER.test(rawLimit) ? Number(rawLimit) : Number.NaN;
    if (!(parsedLimit >= 1 && parsedLimit <= SEARCH_LIMIT_MAX)) {
      throw new SearchHttpError(400, `limit must be an integer between 1 and ${SEARCH_LIMIT_MAX}`);
    }
    limit = parsedLimit;
  }

  return { query, types, arrType, databaseId, limit };
}
