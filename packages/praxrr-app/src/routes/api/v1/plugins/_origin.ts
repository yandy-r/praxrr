const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function forbidden(): Response {
  return new Response(null, {
    status: 403,
    headers: NO_STORE_HEADERS,
  });
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

  try {
    const parsedOrigin = new URL(origin);
    const isCanonicalOrigin =
      origin === url.origin &&
      parsedOrigin.origin === url.origin &&
      parsedOrigin.username === '' &&
      parsedOrigin.password === '' &&
      parsedOrigin.pathname === '/' &&
      parsedOrigin.search === '' &&
      parsedOrigin.hash === '';
    if (isCanonicalOrigin) {
      return null;
    }
  } catch {
    // Malformed browser origins are rejected below.
  }

  return forbidden();
}
