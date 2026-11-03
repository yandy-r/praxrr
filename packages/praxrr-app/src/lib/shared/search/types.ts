/**
 * Shared contract for `GET /api/v1/search` (global command palette quick search).
 * Mirrors `docs/api/v1/schemas/search.yaml`.
 */

/** Entity kinds the search endpoint can return, in default display order. */
export const SEARCH_RESULT_TYPES = [
  'custom_format',
  'quality_profile',
  'regular_expression',
  'delay_profile',
  'metadata_profile',
  'arr_instance',
  'database',
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

/** Arr filter accepted by the search endpoint. */
export const SEARCH_ARR_TYPES = ['all', 'radarr', 'sonarr', 'lidarr'] as const;

export type SearchArrType = (typeof SEARCH_ARR_TYPES)[number];

/** Query bounds enforced by the search endpoint. */
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 50;

/** Provenance of a PCD or TRaSH entity result; `null` for Arr instances and databases. */
export interface SearchResultSource {
  type: 'pcd' | 'trash';
  id: number;
  name: string;
  /** Present for TRaSH sources only. */
  arrType?: 'radarr' | 'sonarr';
}

export interface SearchResult {
  type: SearchResultType;
  /** Stable key, e.g. `pcd:3:custom_format:12`, `trash:5:custom_format:<trashId>`, `arr:2`, `database:3`. */
  id: string;
  name: string;
  /** Relative edit route. */
  href: string;
  source: SearchResultSource | null;
  /** Arr instance type, or TRaSH source arr type. */
  arrType?: 'radarr' | 'sonarr' | 'lidarr';
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  truncated: boolean;
}

export function isSearchResultType(value: string): value is SearchResultType {
  return (SEARCH_RESULT_TYPES as readonly string[]).includes(value);
}

export function isSearchArrType(value: string): value is SearchArrType {
  return (SEARCH_ARR_TYPES as readonly string[]).includes(value);
}
