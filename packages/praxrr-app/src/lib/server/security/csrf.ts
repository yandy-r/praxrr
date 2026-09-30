/**
 * Runtime, proxy-aware CSRF origin gate (YAN-433 / #276).
 *
 * SvelteKit's built-in `csrf.trustedOrigins` is a build-time constant baked into the generated
 * server bundle, so it cannot read runtime env vars. The previous `trustedOrigins: ['*']` wildcard
 * disabled the origin check app-wide, in dev AND in production builds, letting cross-site
 * form/`text/plain` requests (including `text/plain` bodies containing JSON) reach every form
 * action and `+server.ts` handler.
 *
 * This module replaces that check at runtime in `hooks.server.ts` (`checkOrigin` stays disabled in
 * `svelte.config.js` so this hook is the single source of truth):
 *
 * - Mutating requests (POST/PUT/PATCH/DELETE) carrying a form content type
 *   (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) or a JSON content
 *   type (`application/json`, `application/*+json`) are rejected with 403 when the `Origin` header
 *   is present and does not match an expected origin. JSON is covered too because handlers call
 *   `request.json()` without validating `Content-Type` — a browser can smuggle JSON cross-site as
 *   `text/plain` without a CORS preflight.
 * - Requests without an `Origin` header (curl, API keys, server-to-server, native apps) pass; the
 *   auth middleware remains the gate for them. This mirrors the existing MCP and plugin endpoint
 *   checks.
 * - Expected origins = the listener origin (`url.origin`) + the public origin derived from
 *   `X-Forwarded-Proto`/`X-Forwarded-Host` (honored ONLY when the direct socket peer is a
 *   `TRUSTED_PROXY`-allowlisted reverse proxy, same contract as `getClientIp`) + the explicit
 *   `PRAXRR_TRUSTED_ORIGINS` allowlist.
 */

import type { Handle } from '@sveltejs/kit';
import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { firstForwardedValue } from '$http/forwardedHeader.ts';
import { isTrustedProxyPeer, normalizeOrigin, type TrustedProxyConfig } from '$shared/security/index.ts';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Content types a browser can send cross-site without a CORS preflight, plus JSON. */
const GUARDED_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/**
 * Content types whose request bodies this gate protects. Form content types mirror SvelteKit's
 * `is_form_content_type`; JSON types close the `request.json()` smuggling hole.
 */
export function isGuardedContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (GUARDED_CONTENT_TYPES.includes(mime)) return true;
  return mime === 'application/json' || (mime.startsWith('application/') && mime.endsWith('+json'));
}

export interface ExpectedOriginsInput {
  /** Listener origin of the request URL (`event.url.origin`). */
  urlOrigin: string;
  /** First token of `X-Forwarded-Proto`, if any. */
  forwardedProto: string | null;
  /** First token of `X-Forwarded-Host`, if any. */
  forwardedHost: string | null;
  /** Whether the direct socket peer is a `TRUSTED_PROXY`-allowlisted reverse proxy. */
  peerIsTrustedProxy: boolean;
  /** Explicit `PRAXRR_TRUSTED_ORIGINS` allowlist (already normalized). */
  trustedOrigins: readonly string[];
}

/**
 * Origins whose requests are accepted. The listener origin is always trusted. Forwarded
 * proto/host are honored ONLY from a trusted proxy peer, and only when they form a sane origin
 * (fail-closed: malformed forwarded headers shrink the trusted set rather than widening it).
 */
export function resolveExpectedOrigins(input: ExpectedOriginsInput): string[] {
  const origins: string[] = [input.urlOrigin];
  if (input.peerIsTrustedProxy && input.forwardedProto && input.forwardedHost) {
    const proto = input.forwardedProto.toLowerCase();
    if (proto === 'http' || proto === 'https') {
      const origin = normalizeOrigin(`${proto}://${input.forwardedHost}`);
      if (origin && !origins.includes(origin)) origins.push(origin);
    }
  }
  for (const origin of input.trustedOrigins) {
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

export interface CrossOriginMutationInput {
  method: string;
  origin: string | null;
  contentType: string | null;
  expectedOrigins: readonly string[];
}

/**
 * True when the request is a mutating cross-origin request that must be rejected with 403.
 * Absent `Origin` (non-browser clients) passes — authentication gates those requests, and a
 * cross-site browser always attaches `Origin` to a mutating navigation/fetch.
 */
export function isCrossOriginMutation(input: CrossOriginMutationInput): boolean {
  if (!MUTATING_METHODS.has(input.method.toUpperCase())) return false;
  if (!isGuardedContentType(input.contentType)) return false;
  if (input.origin === null) return false;
  const origin = normalizeOrigin(input.origin);
  // A present-but-unparseable Origin (including the literal `null` sent for sandboxed contexts)
  // never matches: it cannot be proven same-site, so the request is rejected.
  if (origin === null) return true;
  return !input.expectedOrigins.includes(origin);
}

/** Read the direct socket peer without letting prerender-time throws deny trust by accident. */
function safeClientAddress(event: { getClientAddress: () => string }): string {
  try {
    return event.getClientAddress();
  } catch {
    return 'unknown';
  }
}

/** Build the expected-origins set for an incoming request from live config + request headers. */
export function expectedOriginsForEvent(
  event: {
    url: URL;
    request: Request;
    getClientAddress: () => string;
  },
  trustedProxy: TrustedProxyConfig = config.trustedProxy,
  trustedOrigins: readonly string[] = config.trustedOrigins
): string[] {
  return resolveExpectedOrigins({
    urlOrigin: event.url.origin,
    forwardedProto: firstForwardedValue(event.request.headers.get('x-forwarded-proto')),
    forwardedHost: firstForwardedValue(event.request.headers.get('x-forwarded-host')),
    peerIsTrustedProxy: isTrustedProxyPeer(safeClientAddress(event), trustedProxy),
    trustedOrigins,
  });
}

/**
 * CSRF guard hook. Sequenced BEFORE the auth handler so cross-origin mutations are rejected
 * regardless of auth state (they must not reach `needsSetup` flows, login actions, or API
 * endpoints). Requests without `Origin` continue to the auth middleware as before.
 */
export const csrfGuard: Handle = async ({ event, resolve }) => {
  const expectedOrigins = expectedOriginsForEvent(event);
  if (
    isCrossOriginMutation({
      method: event.request.method,
      origin: event.request.headers.get('origin'),
      contentType: event.request.headers.get('content-type'),
      expectedOrigins,
    })
  ) {
    void logger.warn('Rejected cross-origin mutation', {
      source: 'CSRF',
      meta: {
        method: event.request.method,
        path: event.url.pathname,
        origin: event.request.headers.get('origin'),
        ip: safeClientAddress(event),
      },
    });
    const message = `Cross-site ${event.request.method.toUpperCase()} submissions are forbidden`;
    if (event.url.pathname.startsWith('/api') || event.request.headers.get('accept') === 'application/json') {
      return new Response(JSON.stringify({ error: message }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(message, { status: 403 });
  }
  return resolve(event);
};
