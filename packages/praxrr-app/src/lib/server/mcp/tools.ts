/**
 * Read-only MCP tool registry.
 *
 * Every tool wraps a verified service function by DIRECT CALL (no internal HTTP hop) and is marked
 * `readOnlyHint: true`. Read-only safety rests on the ABSENCE of any write handler, not on the hint.
 *
 * Error model (see errors.ts / design §3):
 * - handlers return raw success payloads;
 * - expected in-domain failures `throw new McpDomainError` → `isError: true` result;
 * - bad params `throw new JsonRpcError(INVALID_PARAMS)` → `-32602`;
 * - any other throw propagates → `-32603`.
 */

import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { configHealthSettingsQueries } from '$db/queries/configHealthSettings.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { driftStatusQueries } from '$db/queries/driftStatus.ts';
import { syncHistoryQueries, type SyncHistoryFilters } from '$db/queries/syncHistory.ts';
import { scoreFleet, scoreInstance } from '$lib/server/health/service.ts';
import { toSummaryResponse as toHealthSummary } from '$lib/server/health/responses.ts';
import { computeShield } from '$lib/server/security/service.ts';
import { toSummaryResponse as toSecuritySummary } from '$lib/server/security/responses.ts';
import { buildDriftSummary } from '$sync/drift/summary.ts';
import { toInstanceSummary } from '$sync/drift/responses.ts';
import { buildSyncHistoryListResponse } from '$sync/syncHistory/responses.ts';
import { generatePreview } from '$sync/preview/orchestrator.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import {
  isResolvedConfigValidationError,
  isResolvedEntityNotFoundError,
  listResolvedEntityNames,
  readResolvedEntity,
} from '$pcd/index.ts';
import { RESOLVED_ENTITY_TYPE_VALUES, isKnownResolvedEntityType, lookupDatabaseCache } from './pcd.ts';
import { toMcpDatabase, toMcpInstance } from './mappers.ts';
import { toToolError, toToolResult } from './serialize.ts';
import { ERROR_CODES, asRecord } from './jsonrpc.ts';
import { JsonRpcError, McpDomainError } from './errors.ts';
import type { McpContext } from './context.ts';
import type { JsonSchema, Tool, ToolAnnotations, ToolCallResult } from './types.ts';

// ---------------------------------------------------------------------------
// Shared enums / guards
// ---------------------------------------------------------------------------

const ARR_TYPE_VALUES = ['radarr', 'sonarr', 'lidarr'] as const;
type ArrTypeLiteral = (typeof ARR_TYPE_VALUES)[number];

const SECTION_VALUES = ['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles'] as const;
type SectionLiteral = (typeof SECTION_VALUES)[number];

// ---------------------------------------------------------------------------
// Argument coercion helpers (schema validation runs first; these narrow types)
// ---------------------------------------------------------------------------

function optNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' ? value : undefined;
}

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function optBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

function reqNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== 'number') {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Missing or invalid numeric argument: ${key}`);
  }
  return value;
}

function reqString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Missing or invalid string argument: ${key}`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}

function optArrType(args: Record<string, unknown>, key: string): ArrTypeLiteral | undefined {
  const value = optString(args, key);
  if (value === undefined) return undefined;
  if (!(ARR_TYPE_VALUES as readonly string[]).includes(value)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Invalid ${key}: ${value}`);
  }
  return value as ArrTypeLiteral;
}

function sectionsArg(args: Record<string, unknown>): SectionLiteral[] | undefined {
  const raw = args.sections;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, 'sections must be an array of section names');
  }
  return raw.map((entry) => {
    if (typeof entry !== 'string' || !(SECTION_VALUES as readonly string[]).includes(entry)) {
      throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Invalid section: ${String(entry)}`);
    }
    return entry as SectionLiteral;
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>, ctx: McpContext) => Promise<unknown>;
}

const arrTypeProp = { type: 'string', enum: [...ARR_TYPE_VALUES] };
const entityTypeProp = { type: 'string', enum: [...RESOLVED_ENTITY_TYPE_VALUES] };

export const TOOLS: readonly McpTool[] = [
  {
    name: 'list_instances',
    description: 'List configured Radarr/Sonarr/Lidarr instances (credentials redacted to a fingerprint).',
    inputSchema: {
      type: 'object',
      properties: { type: arrTypeProp, enabledOnly: { type: 'boolean' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const type = optArrType(args, 'type');
      const enabledOnly = optBoolean(args, 'enabledOnly');
      // `type` and `enabledOnly` compose (AND); getByType has no enabled filter, so apply it here.
      const base = type ? arrInstancesQueries.getByType(type) : arrInstancesQueries.getAll();
      const rows = base
        .filter((instance) => isSyncPreviewArrType(instance.type))
        .filter((instance) => !enabledOnly || instance.enabled === 1);
      return Promise.resolve(rows.map(toMcpInstance));
    },
  },
  {
    name: 'get_config_health',
    description: 'Config health scores for the whole fleet, or one instance when instanceId is given.',
    inputSchema: {
      type: 'object',
      properties: { instanceId: { type: 'integer' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const settings = configHealthSettingsQueries.get();
      const generatedAt = new Date().toISOString();
      const instanceId = optNumber(args, 'instanceId');
      if (instanceId !== undefined) {
        const report = await scoreInstance(instanceId);
        if (report === null) {
          throw new McpDomainError(`Instance ${instanceId} not found or not sync-capable`);
        }
        return toHealthSummary([report], settings, generatedAt);
      }
      return toHealthSummary(await scoreFleet(), settings, generatedAt);
    },
  },
  {
    name: 'get_security_posture',
    description: 'The security shield report for this deployment (score, per-check breakdown, top actions).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    handler: () => Promise.resolve(toSecuritySummary(computeShield())),
  },
  {
    name: 'get_drift_status',
    description: 'Fleet drift summary, or a single instance drift status when instanceId is given.',
    inputSchema: {
      type: 'object',
      properties: { instanceId: { type: 'integer' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const instanceId = optNumber(args, 'instanceId');
      if (instanceId === undefined) {
        return Promise.resolve(buildDriftSummary());
      }
      const instance = arrInstancesQueries.getById(instanceId);
      if (!instance) {
        throw new McpDomainError(`Instance ${instanceId} not found`);
      }
      if (!isSyncPreviewArrType(instance.type)) {
        throw new McpDomainError(`Instance ${instanceId} is not a sync-capable arr type`);
      }
      return Promise.resolve(toInstanceSummary(instance, driftStatusQueries.getById(instanceId)));
    },
  },
  {
    name: 'list_databases',
    description: 'List configured PCD (Praxrr Config Database) sources.',
    inputSchema: {
      type: 'object',
      properties: { enabledOnly: { type: 'boolean' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const rows = optBoolean(args, 'enabledOnly')
        ? databaseInstancesQueries.getEnabled()
        : databaseInstancesQueries.getAll();
      return Promise.resolve(rows.map(toMcpDatabase));
    },
  },
  {
    name: 'list_resolved_entities',
    description: 'List resolved entity names of a given type in a PCD database.',
    inputSchema: {
      type: 'object',
      properties: { databaseId: { type: 'integer' }, entityType: entityTypeProp, arrType: arrTypeProp },
      required: ['databaseId', 'entityType'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const databaseId = reqNumber(args, 'databaseId');
      const entityType = reqString(args, 'entityType');
      const arrType = optArrType(args, 'arrType');
      const cache = requireCache(databaseId);
      if (!isKnownResolvedEntityType(entityType)) {
        throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Unknown entityType: ${entityType}`);
      }
      try {
        return await listResolvedEntityNames(cache, entityType, arrType);
      } catch (error) {
        if (isResolvedConfigValidationError(error)) {
          throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, error.message);
        }
        throw error;
      }
    },
  },
  {
    name: 'get_resolved_entity',
    description: 'Read one resolved PCD entity payload by name.',
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'integer' },
        entityType: entityTypeProp,
        arrType: arrTypeProp,
        name: { type: 'string' },
      },
      required: ['databaseId', 'entityType', 'name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const databaseId = reqNumber(args, 'databaseId');
      const entityType = reqString(args, 'entityType');
      const arrType = optArrType(args, 'arrType');
      const name = reqString(args, 'name');
      const cache = requireCache(databaseId);
      if (!isKnownResolvedEntityType(entityType)) {
        throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Unknown entityType: ${entityType}`);
      }
      try {
        return await readResolvedEntity(cache, entityType, arrType, name);
      } catch (error) {
        if (isResolvedConfigValidationError(error)) {
          throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, error.message);
        }
        if (isResolvedEntityNotFoundError(error)) {
          throw new McpDomainError(error.message);
        }
        throw error;
      }
    },
  },
  {
    name: 'search_sync_history',
    description: 'Search recorded sync history with optional filters and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'integer' },
        arrType: arrTypeProp,
        // status/trigger/section are matched verbatim by a parameterized query; unknown values
        // simply yield no rows (mirrors the route's loose acceptance at the query layer).
        status: { type: 'string' },
        trigger: { type: 'string' },
        section: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        q: { type: 'string' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const pageInput = optNumber(args, 'page');
      const page = pageInput !== undefined && pageInput >= 1 ? Math.floor(pageInput) : 1;
      const pageSize = clamp(optNumber(args, 'pageSize') ?? 25, 1, 100);
      const filters: SyncHistoryFilters = {
        instanceId: optNumber(args, 'instanceId'),
        arrType: optArrType(args, 'arrType'),
        status: optString(args, 'status'),
        trigger: optString(args, 'trigger'),
        section: optString(args, 'section'),
        from: optString(args, 'from'),
        to: optString(args, 'to'),
        q: optString(args, 'q'),
      };
      const rows = syncHistoryQueries.search(filters, { limit: pageSize, offset: (page - 1) * pageSize });
      const total = syncHistoryQueries.count(filters);
      return Promise.resolve(buildSyncHistoryListResponse(rows, { page, pageSize, total }));
    },
  },
  {
    name: 'preview_sync',
    description: 'Generate a write-free dry-run sync preview (diff of creates/updates/deletes) for an instance.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'integer' },
        sections: { type: 'array', items: { type: 'string', enum: [...SECTION_VALUES] } },
        sectionConfigs: { type: 'object' },
      },
      required: ['instanceId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    handler: async (args) => {
      const instanceId = reqNumber(args, 'instanceId');
      const instance = arrInstancesQueries.getById(instanceId);
      if (!instance) {
        throw new McpDomainError(`Instance ${instanceId} not found`);
      }
      if (!isSyncPreviewArrType(instance.type)) {
        throw new McpDomainError(`Instance ${instanceId} is not a sync-capable arr type`);
      }
      const sections = sectionsArg(args);
      const sectionConfigs = isPlainRecord(args.sectionConfigs) ? args.sectionConfigs : undefined;
      let result: Awaited<ReturnType<typeof generatePreview>>;
      try {
        result = await generatePreview({ instance, sections, sectionConfigs } as Parameters<typeof generatePreview>[0]);
      } catch (error) {
        throw new McpDomainError(error instanceof Error ? error.message : String(error));
      }
      // Partial success (some sections produced a diff) is returned whole with per-section errors
      // surfaced. A total failure (e.g. the Arr is unreachable) becomes an isError result.
      const hadSuccess = result.sectionOutcomes.some((outcome) => outcome.error === null && !outcome.skipped);
      if (result.errors.length > 0 && !hadSuccess) {
        throw new McpDomainError(result.error ?? `Sync preview failed: ${result.errors.join('; ')}`);
      }
      return result;
    },
  },
];

// Enforce the read-only invariant at module load: PR #1 registers no write tool.
for (const tool of TOOLS) {
  if (tool.annotations.readOnlyHint !== true) {
    throw new Error(`MCP tool "${tool.name}" must be read-only in PR #1`);
  }
}

/** Resolve a database's compiled cache, mapping both "no such db" and "cache not ready" to domain errors. */
function requireCache(databaseId: number) {
  const lookup = lookupDatabaseCache(databaseId);
  if (!lookup.ok) {
    throw new McpDomainError(lookup.reason);
  }
  return lookup.cache;
}

// ---------------------------------------------------------------------------
// Public registry API
// ---------------------------------------------------------------------------

export function listTools(): Tool[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

function getTool(name: string): McpTool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/**
 * Run a tool. Unknown tool / invalid args → `JsonRpcError(-32602)` (dispatch maps to a protocol
 * error); an in-domain `McpDomainError` → `isError: true` result; any other throw propagates so
 * dispatch maps it to `-32603`.
 */
export async function callTool(name: string, args: unknown, ctx: McpContext): Promise<ToolCallResult> {
  const tool = getTool(name);
  if (!tool) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Unknown tool: ${name}`);
  }
  const validated = validateArgs(tool.inputSchema, args);
  try {
    return toToolResult(await tool.handler(validated, ctx));
  } catch (error) {
    if (error instanceof McpDomainError) {
      return toToolError(error.message);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Minimal boundary validation (required keys, primitive types, enum membership)
// ---------------------------------------------------------------------------

function validateArgs(schema: JsonSchema, args: unknown): Record<string, unknown> {
  const record = asRecord(args);
  const properties = isPlainRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const allowAdditional = schema.additionalProperties !== false;

  for (const key of required) {
    if (record[key] === undefined || record[key] === null) {
      throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Missing required argument: ${String(key)}`);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (!(key in properties)) {
      if (!allowAdditional) {
        throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Unexpected argument: ${key}`);
      }
      continue;
    }
    const spec = properties[key];
    if (isPlainRecord(spec)) {
      validateValue(key, value, spec);
    }
  }

  return record;
}

function validateValue(key: string, value: unknown, spec: Record<string, unknown>): void {
  const type = typeof spec.type === 'string' ? spec.type : undefined;
  if (type && !matchesType(value, type)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Argument "${key}" must be of type ${type}`);
  }
  if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
    throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, `Argument "${key}" must be one of: ${spec.enum.join(', ')}`);
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainRecord(value);
    default:
      return true;
  }
}
