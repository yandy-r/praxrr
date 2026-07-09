/**
 * MCP error taxonomy.
 *
 * Two distinct failure kinds must never be conflated (see the planning critic, design §3):
 *
 * - `JsonRpcError` is a PROTOCOL fault (unknown tool, invalid params, unmatched resource URI). It
 *   maps to a JSON-RPC error response with a numeric code and terminates the request.
 * - `McpDomainError` is an EXPECTED in-domain failure of a tool that otherwise ran correctly
 *   (instance not found, Arr unreachable, entity missing). It maps to a normal `tools/call` RESULT
 *   with `isError: true` — NOT a protocol error — so the assistant can read the human-readable
 *   reason and react.
 *
 * Any OTHER thrown error (a genuine bug) is neither of these and must surface as `-32603` with a
 * generic message and no stack/secret leakage.
 */

/** A JSON-RPC protocol fault carrying the numeric error code to return. */
export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

/** An expected, in-domain tool failure that becomes an `isError: true` tool result. */
export class McpDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpDomainError';
  }
}
