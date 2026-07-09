/**
 * Transport-agnostic JSON-RPC 2.0 codec.
 *
 * Parses a single inbound request or notification (batch arrays are rejected — batching was removed
 * in MCP 2025-06-18), and builds success/error envelopes. Zero MCP semantics live here.
 */

import type { JsonRpcErrorResponse, JsonRpcId, JsonRpcNotification, JsonRpcRequest, JsonRpcSuccess } from './types.ts';

export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // MCP-specific: resources/read on a resolvable-but-missing resource.
  RESOURCE_NOT_FOUND: -32002,
} as const;

export type ParseResult =
  | { ok: true; message: JsonRpcRequest | JsonRpcNotification }
  | { ok: false; id: JsonRpcId | null; code: number; message: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse a raw request body into a single JSON-RPC request or notification. Returns a tagged failure
 * (never throws) so the route can turn it into the right JSON-RPC error envelope.
 */
export function parseJsonRpc(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, id: null, code: ERROR_CODES.PARSE_ERROR, message: 'Parse error' };
  }

  if (Array.isArray(parsed)) {
    return { ok: false, id: null, code: ERROR_CODES.INVALID_REQUEST, message: 'Batch requests are not supported' };
  }
  if (!isPlainRecord(parsed)) {
    return { ok: false, id: null, code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request' };
  }

  if (parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
    return { ok: false, id: null, code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request' };
  }

  // Presence of the `id` key (not its type) signals a request. MCP forbids a null request id, so an
  // `id` that is present but not a string/number is an Invalid Request. Absent `id` is a notification.
  if ('id' in parsed) {
    if (typeof parsed.id === 'string' || typeof parsed.id === 'number') {
      return { ok: true, message: { jsonrpc: '2.0', id: parsed.id, method: parsed.method, params: parsed.params } };
    }
    return { ok: false, id: null, code: ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request' };
  }
  return { ok: true, message: { jsonrpc: '2.0', method: parsed.method, params: parsed.params } };
}

export function isNotification(message: JsonRpcRequest | JsonRpcNotification): message is JsonRpcNotification {
  return !('id' in message);
}

export function makeResult(id: JsonRpcId | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function makeError(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcErrorResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** Narrow `unknown` JSON-RPC `params` to a record before field access (params may be omitted). */
export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}
