/**
 * Query-param parsing + validation for the timeline list and export routes (issue #27), so the
 * two routes can never diverge. Mirrors the sync-history filter discipline and reuses its
 * `parseDateBound` for from/to bounds.
 *
 * Scope axes are mutually exclusive. An arr-instance axis (`instanceId` and/or `arrType`) and a
 * pcd-database axis (`databaseId`) cannot be combined, and `scopeKind` may not contradict a
 * supplied id — those are fail-fast 400s ({@link TimelineQueryError}) rather than a silently empty
 * feed.
 */

import { parseDateBound } from '$sync/syncHistory/filters.ts';
import { TimelineHttpError } from './errors.ts';
import type { TimelineArrType, TimelineFilters, TimelineScopeKind, TimelineSource, TimelineStatus } from './types.ts';

/** Thrown on any invalid/contradictory query param. Routes map it to HTTP 400. */
export class TimelineQueryError extends TimelineHttpError {
  constructor(message: string) {
    super(400, message);
    this.name = 'TimelineQueryError';
  }
}

const SOURCES: readonly TimelineSource[] = ['sync', 'canary', 'snapshot', 'rollback'];
const STATUSES: readonly TimelineStatus[] = ['success', 'partial', 'failed', 'skipped', 'pending', 'info'];
const ARR_TYPES: readonly TimelineArrType[] = ['radarr', 'sonarr', 'lidarr'];
const SCOPE_KINDS: readonly TimelineScopeKind[] = ['arr-instance', 'pcd-database'];

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

export interface TimelinePagination {
  page: number;
  pageSize: number;
}

function parsePositiveInt(raw: string | null, fallback: number, name: string, max?: number): number {
  if (raw === null) return fallback;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new TimelineQueryError(`Invalid ${name}`);
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) {
    throw new TimelineQueryError(`Invalid ${name}`);
  }
  if (max !== undefined && value > max) return max;
  return value;
}

/** Parse an optional id filter: integer > 0, or throw. Returns undefined when absent. */
function parseId(raw: string | null, name: string): number | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new TimelineQueryError(`Invalid ${name}`);
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) {
    throw new TimelineQueryError(`Invalid ${name}`);
  }
  return value;
}

function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], name: string): T | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!(allowed as readonly string[]).includes(trimmed)) {
    throw new TimelineQueryError(`Invalid ${name}`);
  }
  return trimmed as T;
}

/** Parse a comma-separated `source` filter into a de-duplicated, validated list. */
function parseSources(raw: string | null): TimelineSource[] | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parts = trimmed
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  const seen = new Set<TimelineSource>();
  for (const part of parts) {
    if (!(SOURCES as readonly string[]).includes(part)) {
      throw new TimelineQueryError(`Invalid source`);
    }
    seen.add(part as TimelineSource);
  }
  return [...seen];
}

/** Parse + validate every timeline filter param, including cross-axis contradictions. */
export function parseTimelineFilters(url: URL): TimelineFilters {
  const params = url.searchParams;

  const instanceId = parseId(params.get('instanceId'), 'instanceId');
  const databaseId = parseId(params.get('databaseId'), 'databaseId');
  const scopeKind = parseEnum(params.get('scopeKind'), SCOPE_KINDS, 'scopeKind');
  const arrType = parseEnum(params.get('arrType'), ARR_TYPES, 'arrType');
  const status = parseEnum(params.get('status'), STATUSES, 'status');
  const source = parseSources(params.get('source'));
  const from = parseDateBoundOr400(params.get('from'), 'from', 'lower');
  const to = parseDateBoundOr400(params.get('to'), 'to', 'upper');
  const qRaw = params.get('q');
  const q = qRaw && qRaw.trim() ? qRaw.trim() : undefined;

  // Cross-axis contradictions: arr-instance axis (instanceId/arrType) vs pcd-database axis (databaseId).
  if (instanceId !== undefined && databaseId !== undefined) {
    throw new TimelineQueryError('instanceId and databaseId cannot be combined');
  }
  if (arrType !== undefined && databaseId !== undefined) {
    throw new TimelineQueryError('arrType and databaseId cannot be combined');
  }
  if (scopeKind === 'arr-instance' && databaseId !== undefined) {
    throw new TimelineQueryError('scopeKind=arr-instance contradicts databaseId');
  }
  if (scopeKind === 'pcd-database' && (instanceId !== undefined || arrType !== undefined)) {
    throw new TimelineQueryError('scopeKind=pcd-database contradicts instanceId/arrType');
  }

  return { instanceId, databaseId, scopeKind, arrType, status, source, from, to, q };
}

function parseDateBoundOr400(raw: string | null, name: string, bound: 'lower' | 'upper'): string | undefined {
  try {
    return parseDateBound(raw, name, bound);
  } catch {
    throw new TimelineQueryError(`Invalid ${name}`);
  }
}

export function parseTimelinePagination(url: URL): TimelinePagination {
  const params = url.searchParams;
  return {
    page: parsePositiveInt(params.get('page'), DEFAULT_PAGE, 'page'),
    pageSize: parsePositiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE, 'pageSize', MAX_PAGE_SIZE),
  };
}
