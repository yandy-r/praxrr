/**
 * Boundary validation for POST /api/v1/arr/cleanup request bodies.
 */

import { isRecord } from '$lib/server/trashguide/utils.ts';
import type { CleanupScanResult, StaleItem } from './cleanup.ts';

export type CleanupRequest =
  | { action: 'scan'; instanceId: number; includeUnmanaged: boolean }
  | {
      action: 'execute';
      instanceId: number;
      includeUnmanaged: boolean;
      scanResult: CleanupScanResult;
    };

export type CleanupRequestParseResult = { ok: true; request: CleanupRequest } | { ok: false; error: string };

/** Upper bound on each requested stale-items array; larger payloads are rejected with 400. */
export const MAX_CLEANUP_ITEMS = 10000;

function parseStaleItems(value: unknown): StaleItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_CLEANUP_ITEMS) return null;
  const items: StaleItem[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !Number.isInteger(entry.id) ||
      (entry.id as number) <= 0 ||
      typeof entry.name !== 'string' ||
      typeof entry.strippedName !== 'string'
    ) {
      return null;
    }
    items.push({ id: entry.id as number, name: entry.name, strippedName: entry.strippedName });
  }
  return items;
}

/** `includeUnmanaged` is optional and defaults to false; any non-boolean value is rejected. */
function parseIncludeUnmanaged(value: unknown): boolean | null {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  return null;
}

/** Validate an already JSON-decoded cleanup request body. */
export function parseCleanupRequest(body: unknown): CleanupRequestParseResult {
  if (!isRecord(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const { instanceId, action } = body;
  if (typeof instanceId !== 'number' || !Number.isInteger(instanceId) || instanceId <= 0) {
    return { ok: false, error: 'instanceId is required' };
  }
  if (action !== 'scan' && action !== 'execute') {
    return { ok: false, error: 'action must be "scan" or "execute"' };
  }
  const includeUnmanaged = parseIncludeUnmanaged(body.includeUnmanaged);
  if (includeUnmanaged === null) {
    return { ok: false, error: 'includeUnmanaged must be a boolean' };
  }
  if (action === 'scan') {
    return { ok: true, request: { action, instanceId, includeUnmanaged } };
  }

  const { scanResult } = body;
  if (!scanResult) {
    return { ok: false, error: 'scanResult is required for execute action' };
  }
  const invalidScanResult = {
    ok: false,
    error: `scanResult must contain staleCustomFormats and staleQualityProfiles arrays (at most ${MAX_CLEANUP_ITEMS} items each) of { id, name, strippedName }`,
  } as const;
  if (!isRecord(scanResult)) return invalidScanResult;

  const staleCustomFormats = parseStaleItems(scanResult.staleCustomFormats);
  const staleQualityProfiles = parseStaleItems(scanResult.staleQualityProfiles);
  if (!staleCustomFormats || !staleQualityProfiles) return invalidScanResult;

  return {
    ok: true,
    request: { action, instanceId, includeUnmanaged, scanResult: { staleCustomFormats, staleQualityProfiles } },
  };
}
