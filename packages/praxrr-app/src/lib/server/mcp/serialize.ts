/**
 * MCP result serialization.
 *
 * Wraps raw service payloads into MCP content shapes, running {@link redactSecrets} as the LAST
 * transform so no emitted result can carry a credential.
 */

import { redactSecrets } from './redact.ts';
import type { ResourceReadResult, ToolCallResult } from './types.ts';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Wrap a successful tool payload as a `tools/call` result (redacted text + structured content). */
export function toToolResult(value: unknown): ToolCallResult {
  const safe = redactSecrets(value);
  // The MCP spec requires `structuredContent` to be a JSON object. Wrap array/primitive payloads so
  // a strict client (e.g. the official SDK) can still parse the result; the text block carries the
  // unwrapped JSON.
  const structuredContent = isPlainRecord(safe) ? safe : Array.isArray(safe) ? { items: safe } : { value: safe };
  return {
    content: [{ type: 'text', text: JSON.stringify(safe) }],
    isError: false,
    structuredContent,
  };
}

/**
 * An in-domain tool failure result. `message` MUST be a caller-sanitized domain string — never a raw
 * stack trace or secret.
 */
export function toToolError(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a resource payload as a `resources/read` result (single redacted JSON text block). */
export function toResourceContents(uri: string, value: unknown): ResourceReadResult {
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(redactSecrets(value)) }],
  };
}
