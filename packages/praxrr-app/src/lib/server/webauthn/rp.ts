import type { RequestEvent } from '@sveltejs/kit';
import { config } from '$config';

/**
 * Resolved Relying Party parameters for a WebAuthn ceremony.
 *
 * The SAME resolution feeds both the *options and *verify handlers of a ceremony — any drift
 * between the id/origin used to create options and the ones passed to verify silently fails the
 * ceremony, so this is deliberately a single pure function.
 */
export interface WebAuthnRp {
  /** Registrable domain (host only, no scheme/port) — WebAuthn `expectedRPID`. */
  rpID: string;
  /** Display name shown by the authenticator. */
  rpName: string;
  /** Full origins (scheme+host+port) accepted as `expectedOrigin`. */
  allowedOrigins: string[];
}

/** Explicit env overrides (null = derive from the request). */
export interface WebAuthnRpOverrides {
  rpId: string | null;
  origin: string | null;
  rpName: string;
}

/** The request-derived signals needed to compute an RP without a live event (unit-testable). */
export interface WebAuthnRpRequestInfo {
  forwardedHost: string | null;
  host: string | null;
  forwardedProto: string | null;
  urlProtocol: string;
  urlHost: string;
  urlHostname: string;
}

/** Strip a `:port` suffix from a host authority. IPv6 literals are not handled (they cannot use passkeys over http anyway; pin WEBAUTHN_RP_ID for IPv6-behind-HTTPS). */
function stripPort(hostAuthority: string): string {
  return hostAuthority.split(':')[0];
}

/**
 * Pure RP resolution: env overrides first, request headers as fallback.
 *
 * - rpID: `WEBAUTHN_RP_ID` else the host (port stripped) from X-Forwarded-Host / Host / url.
 * - allowedOrigins: `WEBAUTHN_ORIGIN` parsed as a comma-separated list (so a proxied HTTPS domain
 *   AND a direct http://host:port can both verify) else a single derived scheme://host origin.
 * - rpName: the override (already defaulted to 'Praxrr' by config).
 *
 * Throws when no host can be resolved — the caller returns 500 rather than enrolling a credential
 * against an empty/wrong RP id.
 */
export function deriveWebAuthnRp(info: WebAuthnRpRequestInfo, overrides: WebAuthnRpOverrides): WebAuthnRp {
  const hostAuthority = info.forwardedHost ?? info.host ?? info.urlHost;

  const rpID = overrides.rpId ?? (hostAuthority ? stripPort(hostAuthority) : null);
  if (!rpID) {
    throw new Error('WebAuthn RP id could not be resolved (set WEBAUTHN_RP_ID or a Host header)');
  }

  let allowedOrigins: string[];
  if (overrides.origin) {
    allowedOrigins = overrides.origin
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  } else {
    if (!hostAuthority) {
      throw new Error('WebAuthn origin could not be resolved (set WEBAUTHN_ORIGIN or a Host header)');
    }
    const proto = info.forwardedProto ?? info.urlProtocol.replace(/:$/, '');
    allowedOrigins = [`${proto}://${hostAuthority}`];
  }

  if (allowedOrigins.length === 0) {
    throw new Error('WebAuthn allowed origins could not be resolved (WEBAUTHN_ORIGIN was empty)');
  }

  return { rpID, rpName: overrides.rpName, allowedOrigins };
}

/** First comma-separated token of a possibly-chained forwarded header. */
function firstForwardedValue(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(',')[0]?.trim();
  return first || null;
}

/**
 * Resolve the RP for the current request, wiring config overrides + request headers into
 * {@link deriveWebAuthnRp}.
 */
export function resolveWebAuthnRp(event: RequestEvent): WebAuthnRp {
  const info: WebAuthnRpRequestInfo = {
    forwardedHost: firstForwardedValue(event.request.headers.get('x-forwarded-host')),
    host: event.request.headers.get('host'),
    forwardedProto: firstForwardedValue(event.request.headers.get('x-forwarded-proto')),
    urlProtocol: event.url.protocol,
    urlHost: event.url.host,
    urlHostname: event.url.hostname,
  };

  return deriveWebAuthnRp(info, {
    rpId: config.webauthnRpId,
    origin: config.webauthnOrigin,
    rpName: config.webauthnRpName,
  });
}
