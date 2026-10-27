/**
 * Local Overrides Route Helpers
 *
 * Shared helpers for the three `overrides/**` route handlers (list, revert, undo): strict
 * `databaseId` parsing, entityType/arrType validation (same rules as `resolved/readers.ts`),
 * a size-capped JSON body reader, wire-boundary narrowing, and a single typed
 * error-to-response mapper. Not a route module itself (no `+server.ts`/`load` export).
 */

import { json } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { isOverrideRevertError } from '$pcd/index.ts';
import type { OverrideEntity, OverridesSnapshot, ResolvedEntityType } from '$pcd/index.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';

import { isKnownResolvedEntityType, mapResolvedErrorToResponse, toWireOverrides } from '../resolved/shared.ts';

export { isKnownResolvedEntityType, sanitizeBigInts, toWireOverrides } from '../resolved/shared.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type PcdOverrideErrorResponse = components['schemas']['PcdOverrideErrorResponse'];
type PcdOverrideEntity = components['schemas']['PcdOverrideEntity'];
type PcdOverridesResponse = components['schemas']['PcdOverridesResponse'];

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_REVERT_OP_IDS = 1000;
export const MAX_ACTION_ID_LENGTH = 64;
const PER_ARR_ENTITY_TYPES: Readonly<Partial<Record<ResolvedEntityType, true>>> = {
  naming: true,
  mediaSettings: true,
  qualityDefinitions: true,
  lidarrMetadataProfile: true,
};

export type ParseResult<T> = { value: T } | { response: Response };

function badRequest(message: string): { response: Response } {
  return { response: json({ error: message } satisfies ErrorResponse, { status: 400 }) };
}

// ============================================================================
// PARAMETER PARSING
// ============================================================================

/** Strict digits-only id: rejects "1e5", "1abc", " 1" and non-positive ids outright. */
export function parseDatabaseId(raw: string | undefined): ParseResult<number> {
  if (!raw || !/^\d+$/.test(raw)) return badRequest('Invalid databaseId');
  const id = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return badRequest('Invalid databaseId');
  return { value: id };
}

export function parseArrTypeParam(raw: string | null): ParseResult<ArrAppType | undefined> {
  if (raw === null) return { value: undefined };
  if (!isArrAppType(raw)) return badRequest(`Invalid arrType "${raw}"`);
  return { value: raw };
}

/**
 * Validates one `(entityType, arrType)` pair with the `readers.ts` rules: arr-agnostic types
 * reject `arrType`, per-arr types require it, and `lidarrMetadataProfile` requires `lidarr`.
 * No sibling-app fallback and no inference.
 */
export function validateEntityScope(
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined
): { response: Response } | null {
  if (PER_ARR_ENTITY_TYPES[entityType] !== true) {
    if (arrType !== undefined) {
      return badRequest(`Entity type "${entityType}" is arr-agnostic and does not accept an arrType`);
    }
    return null;
  }
  if (arrType === undefined) return badRequest(`Entity type "${entityType}" requires an arrType`);
  if (entityType === 'lidarrMetadataProfile' && arrType !== 'lidarr') {
    return badRequest(`Entity type "${entityType}" is not supported for arrType "${arrType}"`);
  }
  return null;
}

export interface EntityTarget {
  entityType: ResolvedEntityType;
  arrType: ArrAppType | undefined;
  name: string;
}

/** Resolves and validates `{entityType}`, `{name}` path params plus the `arrType` query param. */
export function resolveEntityTarget(
  params: { entityType?: string; name?: string },
  url: URL
): ParseResult<EntityTarget> {
  const entityTypeParam = params.entityType;
  if (!entityTypeParam || !isKnownResolvedEntityType(entityTypeParam)) {
    return badRequest(`Unknown entityType "${entityTypeParam}"`);
  }

  const name = params.name;
  if (!name) return badRequest('Invalid name');

  const arrType = parseArrTypeParam(url.searchParams.get('arrType'));
  if ('response' in arrType) return arrType;

  const invalid = validateEntityScope(entityTypeParam, arrType.value);
  if (invalid) return invalid;

  return { value: { entityType: entityTypeParam, arrType: arrType.value, name } };
}

// ============================================================================
// BODY READING
// ============================================================================

/**
 * Reads an optional JSON object body capped at 8 KB. An empty body is `{}`. Anything that is
 * not a JSON object (array, null, scalar) is rejected.
 */
export async function readJsonObjectBody(request: Request): Promise<ParseResult<Record<string, unknown>>> {
  // Reject oversized bodies via Content-Length before buffering; the post-read check still
  // guards the case where the header is absent or understates the actual size.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return badRequest('Request body too large');
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return badRequest('Request body too large');
  }

  let body: unknown;
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('Request body must be a JSON object');
  }
  return { value: body as Record<string, unknown> };
}

export interface RevertBody {
  opIds?: number[];
  cascadeGroup: boolean;
}

export function parseRevertBody(body: Record<string, unknown>): ParseResult<RevertBody> {
  let opIds: number[] | undefined;
  if (body.opIds !== undefined) {
    const raw = body.opIds;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REVERT_OP_IDS) {
      return badRequest(`opIds must be an array of 1 to ${MAX_REVERT_OP_IDS} positive integers`);
    }
    if (!raw.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
      return badRequest('opIds must contain only positive integers');
    }
    opIds = [...new Set(raw as number[])];
  }

  if (body.cascadeGroup !== undefined && typeof body.cascadeGroup !== 'boolean') {
    return badRequest('cascadeGroup must be a boolean');
  }

  return { value: { opIds, cascadeGroup: body.cascadeGroup === true } };
}

export function parseUndoBody(body: Record<string, unknown>): ParseResult<{ expectedActionId?: string }> {
  const raw = body.expectedActionId;
  if (raw === undefined) return { value: {} };
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ACTION_ID_LENGTH) {
    return badRequest(`expectedActionId must be a string of 1 to ${MAX_ACTION_ID_LENGTH} characters`);
  }
  return { value: { expectedActionId: raw } };
}

// ============================================================================
// WIRE-BOUNDARY NARROWING
// ============================================================================

/**
 * `OverrideEntity.overrides` carries internal `FieldChange` values typed `unknown`; the generated
 * schema types them as a closed JSON-value union. Identical once serialized to JSON, so narrow
 * only that field via `toWireOverrides` and keep everything else `satisfies`-checked.
 */
function toWireEntity(entity: OverrideEntity): PcdOverrideEntity {
  return {
    entityType: entity.entityType,
    arrType: entity.arrType,
    name: entity.name,
    kind: entity.kind,
    present: entity.present,
    existsInBase: entity.existsInBase,
    overrides: toWireOverrides(entity.overrides) as PcdOverrideEntity['overrides'],
    hasPendingConflict: entity.hasPendingConflict,
    ops: entity.ops,
  } satisfies PcdOverrideEntity;
}

export function toWireOverridesResponse(databaseId: number, snapshot: OverridesSnapshot): PcdOverridesResponse {
  return {
    databaseId,
    entities: snapshot.entities.map(toWireEntity),
    lastAction: snapshot.lastAction,
    unmappedOpCount: snapshot.unmappedOpCount,
  } satisfies PcdOverridesResponse;
}

// ============================================================================
// ERROR -> RESPONSE MAPPING
// ============================================================================

export interface OverridesErrorLogContext {
  /** `logger.error`'s `source` tag, e.g. `'pcd/overrides/revert'`. */
  readonly source: string;
  readonly logMessage: string;
  readonly meta: Record<string, unknown>;
  readonly fallbackMessage: string;
}

/**
 * - `OverrideRevertError` (404 `entity_not_found|op_not_found|nothing_to_undo`, 409 fail-closed
 *   reasons): its status with `{error, reason, blockingOpIds?, entities?}`.
 * - Everything else is delegated to `mapResolvedErrorToResponse` (typed validation/not-found
 *   mapping, logged generic 500 otherwise).
 */
export async function mapOverridesErrorToResponse(
  error: unknown,
  logContext: OverridesErrorLogContext
): Promise<Response> {
  if (isOverrideRevertError(error)) {
    const body: PcdOverrideErrorResponse = { error: error.message, reason: error.reason };
    if (error.blockingOpIds) body.blockingOpIds = error.blockingOpIds;
    if (error.entities) body.entities = error.entities;
    return json(body satisfies PcdOverrideErrorResponse, { status: error.status });
  }

  return mapResolvedErrorToResponse(error, logContext);
}
