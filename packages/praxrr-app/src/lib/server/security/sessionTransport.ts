import type { CookieSecureMode, SessionTransport } from '$shared/security/types.ts';
import { firstForwardedValue } from '$http/forwardedHeader.ts';

/** Request-derived signals needed to classify transport without a live event (unit-testable). */
export interface SessionTransportInfo {
  readonly urlProtocol: string | null; // event.url?.protocol
  readonly forwardedProto: string | null; // first comma token of x-forwarded-proto
}

/** Pure classification. */
export function observeSessionTransport(info: SessionTransportInfo): SessionTransport {
  if (info.urlProtocol === 'https:') return 'direct-secure';
  if (info.forwardedProto === 'https') return 'proxy-terminated';
  if (info.urlProtocol === 'http:') return 'insecure';
  return 'unknown';
}

/** Event wrapper — FULLY optional-chained so a `{}` event yields 'unknown' and never throws. */
export function resolveSessionTransport(ctx?: { request?: Request; url?: URL }): SessionTransport {
  return observeSessionTransport({
    urlProtocol: ctx?.url?.protocol ?? null,
    forwardedProto: firstForwardedValue(ctx?.request?.headers?.get('x-forwarded-proto') ?? null)
  });
}

/** on→true, off→false, auto→transport is direct-secure|proxy-terminated. Pure. */
export function resolveCookieSecure(mode: CookieSecureMode, transport: SessionTransport): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return transport === 'direct-secure' || transport === 'proxy-terminated';
}
