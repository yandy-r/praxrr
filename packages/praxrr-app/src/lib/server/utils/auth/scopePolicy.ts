/**
 * Central route → scope policy for API token principals (YAN-534).
 *
 * Fail-closed: a mutating request that matches no rule needs `admin`. Rules are anchored regexes
 * over whole path segments so a prefix can never over-match a sibling route. Session and bypass
 * principals hold every scope, so this only constrains tokens.
 *
 * Tokens are only accepted under `/api/v1/` (see `authenticateApiToken` in `middleware.ts`); every
 * other path, including legacy non-v1 `/api/*` app-internal routes, requires a session. Rules
 * therefore only need to cover v1 routes.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { hasScope, type ApiTokenScope } from '$shared/auth/apiTokenScopes.ts';
import { logger } from '$logger/logger.ts';
import type { AuthPrincipal } from './principal.ts';

const SEGMENT = '[^/]+';

const MCP_ROUTE = /^\/api\/v1\/mcp\/?$/;

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** POST routes that change Arr instances or PCD state through a reviewed apply/sync flow. */
const SYNC_APPLY_ROUTES: readonly RegExp[] = [
  new RegExp(`^/api/v1/sync/preview/${SEGMENT}/apply/?$`),
  new RegExp(`^/api/v1/trash-guide/sources/${SEGMENT}/sync/?$`),
  /^\/api\/v1\/goals\/apply\/?$/,
  new RegExp(`^/api/v1/pcd/${SEGMENT}/snapshots/${SEGMENT}/rollback/?$`),
  /^\/api\/v1\/canary\/rollouts\/?$/,
  new RegExp(`^/api/v1/canary/rollouts/${SEGMENT}/(?:proceed|abort)/?$`),
];

/**
 * Dry-run POST routes, verified side-effect free on Arr instances, PCD ops, and settings: sync
 * preview create stores only an ephemeral in-memory preview; goals preview and impact simulation
 * compile into a throwaway sandbox cache; score simulation and entity evaluation only parse/match.
 */
const READ_POST_ROUTES: readonly RegExp[] = [
  /^\/api\/v1\/sync\/preview\/?$/,
  /^\/api\/v1\/goals\/preview\/?$/,
  /^\/api\/v1\/simulate\/(?:score|impact)\/?$/,
  /^\/api\/v1\/entity-testing\/evaluate\/?$/,
];

/** Scope a token needs for this request. Fail-closed: unknown mutating routes need `admin`. */
export function requiredScopeFor(method: string, pathname: string): ApiTokenScope {
  if (MCP_ROUTE.test(pathname)) return 'mcp';

  const verb = method.toUpperCase();
  if (SAFE_METHODS.includes(verb)) return 'read';

  if (verb === 'POST') {
    if (SYNC_APPLY_ROUTES.some((route) => route.test(pathname))) return 'sync:apply';
    if (READ_POST_ROUTES.some((route) => route.test(pathname))) return 'read';
  }

  return 'admin';
}

/**
 * 403 response when a token principal lacks the scope this request needs, else `null`.
 * Session and bypass principals (and unauthenticated requests) always pass through.
 */
export function enforceTokenScope(
  event: Pick<RequestEvent, 'request' | 'url'>,
  principal: AuthPrincipal | null
): Response | null {
  if (principal?.kind !== 'token') return null;

  const method = event.request.method;
  const endpoint = event.url.pathname;
  const requiredScope = requiredScopeFor(method, endpoint);
  if (hasScope(principal.scopes, requiredScope)) return null;

  void logger.warn('API token lacks required scope', {
    source: 'Auth:APIKey',
    meta: { tokenName: principal.tokenName, method, endpoint, requiredScope },
  });
  return new Response(JSON.stringify({ error: 'Forbidden', requiredScope }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
