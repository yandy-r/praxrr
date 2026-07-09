/**
 * Hand-transcribed JSON-RPC 2.0 + Model Context Protocol wire types.
 *
 * This module owns zero MCP runtime dependencies: the protocol surface Praxrr speaks is small and
 * well-defined, so the types are transcribed by hand from the MCP + JSON-RPC 2.0 schemas. Keeping
 * them strict (no `any`) lets `deno task check` catch handler <-> service drift.
 *
 * See docs/plans/mcp-server/design.md (issue #23) for the authoritative protocol spec.
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0
// ---------------------------------------------------------------------------

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;

// ---------------------------------------------------------------------------
// MCP content + entity shapes
// ---------------------------------------------------------------------------

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
}

export interface ToolCallResult {
  content: TextContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType: string;
}

export interface ResourceContents {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ResourceReadResult {
  contents: ResourceContents[];
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: TextContent;
}

export interface PromptGetResult {
  description?: string;
  messages: PromptMessage[];
}

export interface ServerCapabilities {
  tools: Record<never, never>;
  resources: Record<never, never>;
  prompts: Record<never, never>;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: ServerInfo;
  instructions: string;
}

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

/** Protocol versions this server can speak, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

/** The version advertised when a client requests an unknown/newer/absent version. */
export const LATEST_PROTOCOL_VERSION = '2025-06-18';

/** The server's advertised identity. */
export const SERVER_NAME = 'praxrr';

// ---------------------------------------------------------------------------
// Domain enums shared across the tool/resource surface
// ---------------------------------------------------------------------------

export type McpArrType = 'radarr' | 'sonarr' | 'lidarr';
