import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { config } from '$config';
import { dispatch } from '$lib/server/mcp/dispatch.ts';
import { isNotification, makeError, parseJsonRpc } from '$lib/server/mcp/jsonrpc.ts';
import { fromRequestEvent } from '$lib/server/mcp/context.ts';
import { SUPPORTED_PROTOCOL_VERSIONS } from '$lib/server/mcp/types.ts';

/**
 * POST /api/v1/mcp — Model Context Protocol endpoint (Streamable HTTP, stateless).
 *
 * A single JSON-RPC 2.0 request yields a single `application/json` response; a notification yields
 * `202 Accepted` with no body. GET/DELETE return 405 (no SSE stream, no session lifecycle). This is
 * a thin transport edge only — all protocol logic lives in $lib/server/mcp/. Auth is enforced by the
 * central hook (this route is not in PUBLIC_PATHS); a programmatic client sends `X-Api-Key`.
 */

const MCP_REQUEST_BODY_LIMIT_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();
const SUPPORTED_VERSIONS: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;

export const POST: RequestHandler = async (event) => {
  const { request, url } = event;

  if (!config.mcpEnabled) {
    return new Response(null, { status: 404 });
  }

  // DNS-rebinding defense: reject a browser Origin that is not same-origin. A non-browser MCP client
  // sends no Origin header and passes.
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).origin === url.origin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      return new Response(null, { status: 403 });
    }
  }

  // Validate the MCP-Protocol-Version header when present. An unsupported value is an HTTP 400 (not a
  // JSON-RPC error body). An absent header is allowed (negotiation is driven by the initialize body).
  const protocolVersion = request.headers.get('mcp-protocol-version');
  if (protocolVersion !== null && !SUPPORTED_VERSIONS.includes(protocolVersion)) {
    return json({ error: 'Unsupported MCP-Protocol-Version' }, { status: 400 });
  }

  // Body byte guard: fast-path on Content-Length, then the authoritative UTF-8 byte length.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MCP_REQUEST_BODY_LIMIT_BYTES) {
    return new Response(null, { status: 413 });
  }
  const rawBody = await request.text();
  if (textEncoder.encode(rawBody).length > MCP_REQUEST_BODY_LIMIT_BYTES) {
    return new Response(null, { status: 413 });
  }

  // Parse a single JSON-RPC request or notification (batch arrays are rejected with -32600).
  const parsed = parseJsonRpc(rawBody);
  if (!parsed.ok) {
    return json(makeError(parsed.id, parsed.code, parsed.message));
  }

  const ctx = fromRequestEvent(event);

  if (isNotification(parsed.message)) {
    await dispatch(parsed.message, ctx);
    return new Response(null, { status: 202 });
  }

  const response = await dispatch(parsed.message, ctx);
  return json(response);
};

export const GET: RequestHandler = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });

export const DELETE: RequestHandler = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
