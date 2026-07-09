/**
 * Transport-agnostic MCP method router.
 *
 * Decoupled from the HTTP route so a future stdio/SSE transport (or a write tier) can attach without
 * rewriting handlers. Turns a parsed JSON-RPC request/notification into a JSON-RPC response (or
 * `null` for notifications, which get no reply).
 *
 * Error mapping: a thrown {@link JsonRpcError} becomes its coded error; any other throw becomes
 * `-32603` with a generic message (no stack/secret leakage). In-domain tool failures are already
 * folded into `isError: true` results by `callTool`, never reaching here as throws.
 */

import { logger } from '$logger/logger.ts';
import { ERROR_CODES, asRecord, makeError, makeResult } from './jsonrpc.ts';
import { JsonRpcError } from './errors.ts';
import { buildInitializeResult } from './protocol.ts';
import { callTool, listTools } from './tools.ts';
import { listResourceTemplates, listResources, readResource } from './resources.ts';
import { getPrompt, listPrompts } from './prompts.ts';
import type { McpContext } from './context.ts';
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from './types.ts';

export async function dispatch(
  message: JsonRpcRequest | JsonRpcNotification,
  ctx: McpContext
): Promise<JsonRpcResponse | null> {
  // Notifications (no id) are accepted and answered with no JSON-RPC response.
  if (!('id' in message)) {
    return null;
  }

  const { id, method } = message;
  const params = asRecord(message.params);

  try {
    switch (method) {
      case 'initialize':
        return makeResult(id, buildInitializeResult(params.protocolVersion));
      case 'ping':
        return makeResult(id, {});
      case 'tools/list':
        return makeResult(id, { tools: listTools() });
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string') {
          throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, 'tools/call requires a string "name"');
        }
        return makeResult(id, await callTool(name, params.arguments, ctx));
      }
      case 'resources/list':
        return makeResult(id, { resources: listResources() });
      case 'resources/templates/list':
        return makeResult(id, { resourceTemplates: listResourceTemplates() });
      case 'resources/read': {
        const uri = params.uri;
        if (typeof uri !== 'string') {
          throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, 'resources/read requires a string "uri"');
        }
        return makeResult(id, await readResource(uri, ctx));
      }
      case 'prompts/list':
        return makeResult(id, { prompts: listPrompts() });
      case 'prompts/get': {
        const name = params.name;
        if (typeof name !== 'string') {
          throw new JsonRpcError(ERROR_CODES.INVALID_PARAMS, 'prompts/get requires a string "name"');
        }
        return makeResult(id, getPrompt(name, asRecord(params.arguments)));
      }
      default:
        return makeError(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (error) {
    if (error instanceof JsonRpcError) {
      return makeError(id, error.code, error.message);
    }
    await logger.error('MCP dispatch failed', {
      source: 'McpDispatch',
      meta: { method, error: error instanceof Error ? error.message : String(error) },
    });
    return makeError(id, ERROR_CODES.INTERNAL_ERROR, 'Internal error');
  }
}
