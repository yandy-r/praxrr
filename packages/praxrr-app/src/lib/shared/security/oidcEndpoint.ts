/**
 * OIDC endpoint transport policy (YAN-1601). PURE: shared by the OIDC client (which refuses
 * insecure endpoints) and Shield Check (which reports them), so both apply the same rule.
 *
 * An endpoint is acceptable when it is an absolute `https:` URL, or an `http:` URL whose host is
 * loopback (`localhost`, `127.0.0.0/8`, `::1`) — the only case where plain HTTP cannot leave the
 * machine. Anything else (other schemes, unparseable values, remote `http:`) is rejected.
 */

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

/** True when `raw` may be used as an OIDC discovery, token, or JWKS endpoint. */
export function isSecureOidcEndpoint(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string' || raw.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHostname(url.hostname);
}
