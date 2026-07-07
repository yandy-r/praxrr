/**
 * SSRF guard for user-supplied Arr base URLs.
 *
 * Blocks cloud metadata endpoints and link-local addresses. RFC1918 private
 * ranges (10/8, 172.16/12, 192.168/16) and loopback (127.0.0.1, ::1,
 * localhost) are intentionally allowed — self-hosted Arr instances commonly
 * live on the LAN or the same host as Praxrr.
 *
 * Narrow deny-list only. See `$auth/network.ts` for the broader
 * local-address detection used by AUTH=local (opposite intent: that allows
 * only local addresses, this blocks only metadata/link-local ones).
 */

const METADATA_HOSTNAMES = new Set(['0.0.0.0', '169.254.169.254', 'fd00:ec2::254']);

/**
 * Strip the surrounding brackets the URL parser leaves on IPv6 hostnames
 * (e.g. `[::1]` -> `::1`).
 */
function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '');
}

/**
 * Check whether an IPv4 address falls within the link-local range
 * (169.254.0.0/16).
 */
function isLinkLocalIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  const bytes = parts.map((p) => parseInt(p, 10));
  if (bytes.some((b) => isNaN(b) || b < 0 || b > 255)) return false;

  const [a, b] = bytes;
  return a === 169 && b === 254;
}

/**
 * Check whether an IPv6 address falls within the link-local range
 * (fe80::/10). Only meaningful for IPv6 literals, so hostnames without a
 * `:` (plain IPv4 or DNS names) short-circuit to false.
 */
function isLinkLocalIPv6(ip: string): boolean {
  if (!ip.includes(':')) return false;

  const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
  if (isNaN(firstHextet)) return false;

  return (firstHextet & 0xffc0) === 0xfe80;
}

/**
 * Extract the dotted-decimal form of an IPv4 address embedded in an IPv6
 * literal. Covers IPv4-mapped addresses (`::ffff:a.b.c.d`, which Deno's URL
 * parser normalizes to `::ffff:HHHH:HHHH`) and NAT64 addresses
 * (`64:ff9b::HHHH:HHHH`), plus the textual `::ffff:a.b.c.d` form directly in
 * case a parser ever yields it unnormalized. Returns null when the hostname
 * doesn't embed an IPv4 address in one of these shapes.
 */
function extractEmbeddedIPv4(hostname: string): string | null {
  const textual = hostname.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (textual) return textual[1];

  const hex = hostname.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;

  const ip = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
  return `${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`;
}

/**
 * Validate a user-supplied Arr base URL before it is used to construct an
 * HTTP client. Rejects unsupported schemes plus cloud metadata and
 * link-local hostnames; everything else (including RFC1918 and loopback) is
 * accepted.
 *
 * @throws {Error} when the URL is malformed, uses an unsupported scheme, or
 * its hostname is a metadata or link-local address.
 */
export function assertSafeArrUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Arr URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }

  const hostname = stripBrackets(parsed.hostname.toLowerCase());
  // IPv4-mapped/NAT64 IPv6 literals can smuggle a metadata/link-local IPv4
  // address past hostname-only checks; also compare against its embedded
  // dotted-decimal form when present.
  const embeddedIPv4 = extractEmbeddedIPv4(hostname);

  if (METADATA_HOSTNAMES.has(hostname) || (embeddedIPv4 !== null && METADATA_HOSTNAMES.has(embeddedIPv4))) {
    throw new Error(`Refusing to connect to metadata address: ${hostname}`);
  }

  if (
    isLinkLocalIPv4(hostname) ||
    isLinkLocalIPv6(hostname) ||
    (embeddedIPv4 !== null && isLinkLocalIPv4(embeddedIPv4))
  ) {
    throw new Error(`Refusing to connect to link-local address: ${hostname}`);
  }
}

// Sanity check (exercised properly by the unit test in task 7.1):
// assertSafeArrUrl('http://169.254.169.254/') -> throws (metadata)
// assertSafeArrUrl('http://10.0.0.5:7878/')   -> does not throw (LAN Radarr)
