import { firstForwardedValue } from '$http/forwardedHeader.ts';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function forbidden(): Response {
  return new Response(null, {
    status: 403,
    headers: NO_STORE_HEADERS,
  });
}

function isCanonicalBrowserOrigin(parsedOrigin: URL): boolean {
  return (
    parsedOrigin.username === '' &&
    parsedOrigin.password === '' &&
    parsedOrigin.pathname === '/' &&
    parsedOrigin.search === '' &&
    parsedOrigin.hash === ''
  );
}

/**
 * Derive the browser-visible origin Praxrr should accept for same-origin mutations.
 * Uses Host / X-Forwarded-* when present so TLS-terminating reverse proxies and
 * non-default ports match the Origin header the browser sends.
 */
export function resolveExpectedPluginMutationOrigin(request: Request, url: URL): string {
  const hostAuthority =
    firstForwardedValue(request.headers.get('x-forwarded-host')) ??
    request.headers.get('host') ??
    url.host;
  const proto =
    firstForwardedValue(request.headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '');

  try {
    return new URL(`${proto}://${hostAuthority}`).origin;
  } catch {
    return url.origin;
  }
}

/**
 * Reject browser plugin mutations that explicitly originate outside this Praxrr instance.
 * Authenticated non-browser clients may omit Origin; authentication remains middleware-owned.
 */
export function rejectCrossOriginPluginMutation(request: Request, url: URL): Response | null {
  if (request.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site') {
    return forbidden();
  }

  const origin = request.headers.get('origin');
  if (origin === null) {
    return null;
  }

  const expectedOrigin = resolveExpectedPluginMutationOrigin(request, url);

  try {
    const parsedOrigin = new URL(origin);
    if (isCanonicalBrowserOrigin(parsedOrigin) && parsedOrigin.origin === expectedOrigin) {
      return null;
    }
  } catch {
    // Malformed browser origins are rejected below.
  }

  return forbidden();
}
