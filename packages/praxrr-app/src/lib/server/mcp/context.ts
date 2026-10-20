/**
 * Per-request MCP context.
 *
 * Carries audit identity plus the granted scopes. The hook already authenticated the request and
 * enforced the route-level `mcp` scope; `scopes` lets `callTool` enforce each tool's own
 * `requiredScope` (session and bypass principals hold every scope). Only `{ id, username }` is
 * projected off the user; the raw `User` (which carries `password_hash` and other fields) is never
 * copied, as a least-privilege measure — the MCP boundary needs only audit identity.
 */

import type { ApiTokenScope } from '$shared/auth/apiTokenScopes.ts';

export interface McpContext {
  user: { id: number; username: string } | null;
  authBypass: boolean;
  scopes: readonly ApiTokenScope[];
}

/**
 * The subset of a SvelteKit `RequestEvent` the MCP layer reads. Declared structurally so this module
 * does not depend on the ambient `App.Locals` augmentation, which lives in `src/app.d.ts` — outside
 * the `check:server` type-check glob. A real `RequestEvent` satisfies this shape.
 */
export interface McpRequestEvent {
  locals: {
    user: { id: number; username: string } | null;
    authBypass: boolean;
    principal: { scopes: readonly ApiTokenScope[] } | null;
  };
}

export function fromRequestEvent(event: McpRequestEvent): McpContext {
  const user = event.locals.user;
  return {
    user: user ? { id: user.id, username: user.username } : null,
    authBypass: event.locals.authBypass,
    // Fail closed: no principal means no scopes.
    scopes: event.locals.principal?.scopes ?? [],
  };
}
