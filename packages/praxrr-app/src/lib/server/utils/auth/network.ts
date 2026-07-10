/**
 * Network utilities for detecting local/private IP addresses
 * Used for AUTH=local mode to bypass auth for local network requests
 *
 * Based on Sonarr's implementation:
 * https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Common/Extensions/IpAddressExtensions.cs
 */

import { config } from '$config';
import { isTrustedProxyPeer, type TrustedProxyConfig } from '$shared/security/index.ts';

/**
 * Check if an IP address is a local/private network address
 *
 * IPv4 ranges:
 * - 127.0.0.0/8    (loopback)
 * - 10.0.0.0/8     (Class A private)
 * - 172.16.0.0/12  (Class B private)
 * - 192.168.0.0/16 (Class C private)
 * - 169.254.0.0/16 (link-local, no DHCP)
 *
 * IPv6 ranges:
 * - ::1            (loopback)
 * - fe80::/10      (link-local)
 * - fc00::/7       (unique local)
 * - fec0::/10      (site-local, deprecated but still checked)
 */
export function isLocalAddress(ip: string): boolean {
  // Handle IPv6-mapped IPv4 (::ffff:192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  // Check if it's an IPv4 address
  if (ip.includes('.')) {
    return isLocalIPv4(ip);
  }

  // IPv6 checks
  return isLocalIPv6(ip);
}

/**
 * Check if an IPv4 address is local/private
 */
function isLocalIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  const bytes = parts.map((p) => parseInt(p, 10));
  if (bytes.some((b) => isNaN(b) || b < 0 || b > 255)) return false;

  const [a, b] = bytes;

  // Loopback: 127.0.0.0/8
  if (a === 127) return true;

  // Class A private: 10.0.0.0/8
  if (a === 10) return true;

  // Class B private: 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // Class C private: 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // Link-local: 169.254.0.0/16 (no DHCP assigned)
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Check if an IPv6 address is local
 */
function isLocalIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // Loopback
  if (lower === '::1') return true;

  // Link-local: fe80::/10
  if (lower.startsWith('fe80:')) return true;

  // Unique local: fc00::/7 (fc00:: or fd00::)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  // Site-local (deprecated): fec0::/10
  if (lower.startsWith('fec')) return true;

  return false;
}

/**
 * Headers to check for client IP, in order of precedence
 * Based on @supercharge/request-ip (used by Overseerr)
 */
const IP_HEADERS = [
  'x-forwarded-for', // Standard proxy header (may contain multiple IPs)
  'x-real-ip', // Nginx
  'x-client-ip', // Apache
  'cf-connecting-ip', // Cloudflare
  'fastly-client-ip', // Fastly
  'true-client-ip', // Akamai/Cloudflare
  'x-cluster-client-ip', // Rackspace
];

/**
 * Fail-closed sentinel returned when the socket peer cannot be resolved. `isLocalAddress('unknown')` is
 * false, so an unresolvable peer DENIES the AUTH=local bypass instead of granting it (the old default of
 * `'127.0.0.1'` did the opposite — its whole failure mode was granting the bypass).
 */
const UNKNOWN_PEER = 'unknown';

/**
 * Take the RIGHTMOST non-empty comma-separated token — the hop the trusted proxy itself appended (its
 * observed peer), not the leftmost client-chosen value an attacker can forge. nginx
 * (`$proxy_add_x_forwarded_for`), Traefik, and Caddy all APPEND the observed client to X-Forwarded-For,
 * so `X-Forwarded-For: 127.0.0.1, 203.0.113.9` yields `203.0.113.9`, not the spoofed `127.0.0.1`.
 */
function rightmostForwarded(headerValue: string): string | null {
  const parts = headerValue
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Extract the client IP from a request, honoring forwarded headers ONLY when the direct socket peer is
 * an explicitly trusted proxy (`TRUSTED_PROXY`, issue #228).
 *
 * Trust is keyed on the DIRECT peer (`event.getClientAddress()`), never on header presence: a forged
 * `X-Forwarded-For: 127.0.0.1` from an untrusted peer is ignored, closing the AUTH=local spoofing
 * bypass. When the peer IS trusted, the proxy-appended hop is used (rightmost X-Forwarded-For token),
 * not the leftmost client-supplied value. Fail-closed: an unresolvable peer returns the non-local
 * `'unknown'` sentinel.
 *
 * NOTE: this relies on `event.getClientAddress()` returning the real socket peer. `sveltekit-adapter-deno`
 * does so today; enabling any adapter XFF/address override — or fronting Praxrr with a PROXY-protocol
 * terminator that rewrites the peer — would silently defeat `TRUSTED_PROXY`.
 */
export function getClientIp(
  event: { getClientAddress: () => string; request: Request },
  trustedProxy: TrustedProxyConfig = config.trustedProxy
): string {
  let directPeer: string;
  try {
    directPeer = event.getClientAddress();
  } catch {
    return UNKNOWN_PEER; // getClientAddress can throw during prerendering
  }
  if (!directPeer || directPeer === 'unknown') return UNKNOWN_PEER;

  // Only an explicitly trusted proxy's forwarded headers are believed; everyone else is graded by the
  // real socket peer.
  if (!isTrustedProxyPeer(directPeer, trustedProxy)) return directPeer;

  // Trusted peer: derive the client IP from the hop the proxy appended (rightmost). The single-value
  // replace-semantics headers (x-real-ip, cf-connecting-ip, …) overwrite their value, so rightmost is a
  // no-op for them; x-forwarded-for is checked first, so it is authoritative for the mainstream setup.
  const headers = event.request.headers;
  for (const header of IP_HEADERS) {
    const value = headers.get(header);
    if (!value) continue;
    const ip = rightmostForwarded(value);
    if (ip) return ip;
  }
  return directPeer;
}
