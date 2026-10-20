/**
 * Identity helpers for the live-event stream.
 *
 * `principalKey` names the connection-cap bucket for a request; `buildRevalidator` returns the
 * heartbeat check that closes a stream once its session expires or its token is revoked. Neither
 * extends a session. The locals type is structural so this module does not depend on the ambient
 * `App.Locals` augmentation in `src/app.d.ts`; a real `RequestEvent['locals']` satisfies it.
 */
import { apiTokensQueries } from '$db/queries/apiTokens.ts';
import { sessionsQueries } from '$db/queries/sessions.ts';
import type { AuthPrincipal } from '$auth/principal.ts';

export interface EventStreamLocals {
  session: { id: string } | null;
  principal: AuthPrincipal | null;
}

/**
 * Returns the cap bucket for the caller, or `null` (fail closed) when it cannot be identified.
 * Bypass callers (AUTH=off, local-IP AUTH=local) carry no identity, so each stream gets its own
 * bucket and only the global cap applies to them.
 */
export function principalKey(locals: EventStreamLocals): string | null {
  const principal = locals.principal;
  if (!principal) {
    return null;
  }
  switch (principal.kind) {
    case 'token':
      return `token:${principal.tokenId}`;
    case 'session':
      return locals.session ? `session:${locals.session.id}` : null;
    case 'bypass':
      return `bypass:${crypto.randomUUID()}`;
    default:
      return null;
  }
}

/** Returns the heartbeat check: `true` while the caller's credential is still valid. */
export function buildRevalidator(locals: EventStreamLocals): () => boolean {
  const principal = locals.principal;
  if (!principal) {
    return () => false;
  }
  switch (principal.kind) {
    case 'token': {
      const tokenId = principal.tokenId;
      return () => apiTokensQueries.isActiveById(tokenId);
    }
    case 'session': {
      const sessionId = locals.session?.id;
      if (sessionId === undefined) {
        return () => false;
      }
      return () => sessionsQueries.getValidById(sessionId) !== undefined;
    }
    case 'bypass':
      return () => true;
    default:
      return () => false;
  }
}
