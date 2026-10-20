/**
 * The authenticated caller of a request, with the scopes it holds (YAN-534).
 *
 * Session and bypass principals hold every scope; only API token principals are constrained by
 * the route policy in `scopePolicy.ts` and by MCP tool declarations.
 */

import type { ApiTokenScope } from '$shared/auth/apiTokenScopes.ts';

export type AuthPrincipal =
  | { kind: 'session'; scopes: readonly ApiTokenScope[] }
  | { kind: 'bypass'; scopes: readonly ApiTokenScope[] }
  | {
      kind: 'token';
      tokenId: number;
      tokenName: string;
      isLegacy: boolean;
      scopes: readonly ApiTokenScope[];
    };
