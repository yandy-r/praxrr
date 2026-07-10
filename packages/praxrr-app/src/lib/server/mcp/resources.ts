/**
 * Read-only MCP resource registry.
 *
 * Static resources appear in `resources/list`; templated (`{param}`) resources appear only in
 * `resources/templates/list`. Every read wraps a verified service function and passes through the
 * redaction gate (via {@link toResourceContents}). An unmatched or unresolvable URI is a
 * resource-not-found error (`-32002`); malformed URI params (invalid arrType/entityType or bad
 * percent-encoding) are invalid-params (`-32602`). Resources have no `isError` result channel.
 */

import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { scoreFleet } from '$lib/server/health/service.ts';
import { toSummaryResponse as toHealthSummary } from '$lib/server/health/responses.ts';
import { computeShield } from '$lib/server/security/service.ts';
import { toSummaryResponse as toSecuritySummary } from '$lib/server/security/responses.ts';
import { buildDriftSummary } from '$sync/drift/summary.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import {
  isResolvedConfigValidationError,
  isResolvedEntityNotFoundError,
  listResolvedEntityNames,
  readResolvedEntity,
  type ResolvedEntityType,
} from '$pcd/index.ts';
import { isKnownResolvedEntityType, lookupDatabaseCache, type PcdCache } from './pcd.ts';
import { toMcpDatabase, toMcpInstance } from './mappers.ts';
import { toResourceContents } from './serialize.ts';
import { ERROR_CODES } from './jsonrpc.ts';
import { JsonRpcError } from './errors.ts';
import type { McpContext } from './context.ts';
import type { Resource, ResourceReadResult, ResourceTemplate } from './types.ts';

const MIME = 'application/json';

interface StaticResource {
  uri: string;
  name: string;
  description: string;
  read: () => Promise<unknown>;
}

const STATIC_RESOURCES: readonly StaticResource[] = [
  {
    uri: 'praxrr://arr-instances',
    name: 'Arr instances',
    description: 'All configured Radarr/Sonarr/Lidarr instances (credentials redacted).',
    read: () =>
      Promise.resolve(
        arrInstancesQueries
          .getAll()
          .filter((instance) => isSyncPreviewArrType(instance.type))
          .map(toMcpInstance)
      ),
  },
  {
    uri: 'praxrr://drift/summary',
    name: 'Drift summary',
    description: 'Fleet drift rollup: per-instance status and aggregate totals.',
    read: () => Promise.resolve(buildDriftSummary()),
  },
  {
    uri: 'praxrr://config-health',
    name: 'Config health',
    description: 'Config health scores across the fleet.',
    read: async () => toHealthSummary(await scoreFleet(), configHealthSettingsQueries.get(), new Date().toISOString()),
  },
  {
    uri: 'praxrr://security-posture',
    name: 'Security posture',
    description: 'The security shield report for this deployment.',
    read: async () => toSecuritySummary(await computeShield()),
  },
  {
    uri: 'praxrr://databases',
    name: 'PCD databases',
    description: 'All configured PCD (Praxrr Config Database) sources.',
    read: () => Promise.resolve(databaseInstancesQueries.getAll().map(toMcpDatabase)),
  },
];

const TEMPLATES: readonly ResourceTemplate[] = [
  {
    uriTemplate: 'praxrr://arr-instances/{id}',
    name: 'Arr instance',
    description: 'A single Arr instance by id.',
    mimeType: MIME,
  },
  {
    uriTemplate: 'praxrr://databases/{databaseId}/entities/{entityType}',
    name: 'Resolved entity names',
    description: 'Resolved entity names of a type in a database (append ?arrType= for per-arr types).',
    mimeType: MIME,
  },
  {
    uriTemplate: 'praxrr://databases/{databaseId}/entities/{entityType}/{name}',
    name: 'Resolved entity (arr-agnostic)',
    description: 'One resolved arr-agnostic entity (custom format, quality profile, ...) by name.',
    mimeType: MIME,
  },
  {
    uriTemplate: 'praxrr://databases/{databaseId}/entities/{entityType}/{arrType}/{name}',
    name: 'Resolved entity (per-arr)',
    description: 'One resolved per-arr entity (naming, media settings, ...) by arr type and name.',
    mimeType: MIME,
  },
];

const ARR_INSTANCE_RE = /^praxrr:\/\/arr-instances\/([^/]+)$/;
const DB_ENTITIES_RE = /^praxrr:\/\/databases\/([^/]+)\/entities\/([^/]+)$/;
const DB_ENTITY_AGNOSTIC_RE = /^praxrr:\/\/databases\/([^/]+)\/entities\/([^/]+)\/([^/]+)$/;
const DB_ENTITY_PERARR_RE = /^praxrr:\/\/databases\/([^/]+)\/entities\/([^/]+)\/([^/]+)\/([^/]+)$/;

export function listResources(): Resource[] {
  return STATIC_RESOURCES.map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: MIME,
  }));
}

export function listResourceTemplates(): ResourceTemplate[] {
  return [...TEMPLATES];
}

export async function readResource(uri: string, _ctx: McpContext): Promise<ResourceReadResult> {
  const [path, query] = uri.split('?');
  const queryArrType = query ? (new URLSearchParams(query).get('arrType') ?? undefined) : undefined;

  const staticResource = STATIC_RESOURCES.find((resource) => resource.uri === path);
  if (staticResource) {
    return toResourceContents(uri, await staticResource.read());
  }

  let match = ARR_INSTANCE_RE.exec(path);
  if (match) {
    return toResourceContents(uri, readArrInstance(match[1]));
  }

  match = DB_ENTITY_PERARR_RE.exec(path);
  if (match) {
    return toResourceContents(uri, await readEntity(match[1], match[2], match[3], match[4]));
  }

  match = DB_ENTITY_AGNOSTIC_RE.exec(path);
  if (match) {
    return toResourceContents(uri, await readEntity(match[1], match[2], undefined, match[3]));
  }

  match = DB_ENTITIES_RE.exec(path);
  if (match) {
    return toResourceContents(uri, await readEntityNames(match[1], match[2], queryArrType));
  }

  throw new JsonRpcError(ERROR_CODES.RESOURCE_NOT_FOUND, `Unknown resource URI: ${uri}`);
}

function readArrInstance(idText: string): unknown {
  const id = Number(idText);
  if (!Number.isInteger(id)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Invalid instance id: ${idText}`);
  }
  const instance = arrInstancesQueries.getById(id);
  if (!instance || !isSyncPreviewArrType(instance.type)) {
    throw new JsonRpcError(ERROR_CODES.RESOURCE_NOT_FOUND, `Arr instance ${idText} not found`);
  }
  return toMcpInstance(instance);
}

async function readEntityNames(dbIdText: string, entityType: string, arrType: string | undefined): Promise<unknown> {
  // Validate the URI params (invalid → -32602) before the resource lookup (missing → -32002).
  assertKnownEntityType(entityType);
  const validatedArrType = validateArrType(arrType);
  const cache = requireCache(dbIdText);
  try {
    return await listResolvedEntityNames(cache, entityType, validatedArrType);
  } catch (error) {
    throwResolvedError(error);
  }
}

async function readEntity(
  dbIdText: string,
  entityType: string,
  arrType: string | undefined,
  nameText: string
): Promise<unknown> {
  // Validate the URI params (invalid → -32602) before the resource lookup (missing → -32002).
  assertKnownEntityType(entityType);
  const validatedArrType = validateArrType(arrType);
  const name = decodeResourceSegment(nameText);
  const cache = requireCache(dbIdText);
  try {
    return await readResolvedEntity(cache, entityType, validatedArrType, name);
  } catch (error) {
    throwResolvedError(error);
  }
}

function requireCache(dbIdText: string): PcdCache {
  const id = Number(dbIdText);
  if (!Number.isInteger(id)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Invalid database id: ${dbIdText}`);
  }
  const lookup = lookupDatabaseCache(id);
  if (!lookup.ok) {
    throw new JsonRpcError(ERROR_CODES.RESOURCE_NOT_FOUND, lookup.reason);
  }
  return lookup.cache;
}

/** Percent-decode a URI path segment; a malformed encoding is an invalid URI, not an internal error. */
function decodeResourceSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Invalid resource URI segment: ${segment}`);
  }
}

function assertKnownEntityType(entityType: string): asserts entityType is ResolvedEntityType {
  if (!isKnownResolvedEntityType(entityType)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Unknown entityType: ${entityType}`);
  }
}

function validateArrType(value: string | undefined): 'radarr' | 'sonarr' | 'lidarr' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'radarr' && value !== 'sonarr' && value !== 'lidarr') {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Invalid arrType: ${value}`);
  }
  return value;
}

function throwResolvedError(error: unknown): never {
  if (isResolvedConfigValidationError(error)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, error.message);
  }
  if (isResolvedEntityNotFoundError(error)) {
    throw new JsonRpcError(ERROR_CODES.RESOURCE_NOT_FOUND, error.message);
  }
  throw error;
}
