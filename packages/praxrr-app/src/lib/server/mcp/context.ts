/**
 * Per-request MCP context.
 *
 * Carries only audit identity in PR #1 (read-only tier) — the hook already authorized the request,
 * so this is never used for re-authorization. Only `{ id, username }` is projected off the user;
 * the raw `User` is never copied (it carries `password_hash`, which the secret scrubber does not
 * strip because the key ends in `_hash`).
 */

export interface McpContext {
  user: { id: number; username: string } | null;
  authBypass: boolean;
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
  };
}

export function fromRequestEvent(event: McpRequestEvent): McpContext {
  const user = event.locals.user;
  return {
    user: user ? { id: user.id, username: user.username } : null,
    authBypass: event.locals.authBypass,
  };
}
