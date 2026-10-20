/**
 * Tags SvelteKit `__data.json` requests issued by live-triggered invalidations with
 * `x-praxrr-live: 1`, so the server can skip sliding-session extension for background refreshes.
 *
 * `invalidate()` cannot set headers, but SvelteKit's client `load_data` resolves `window.fetch` at call
 * time. A wrapper installed once tags GET `__data.json` requests for the page being refreshed while a
 * live invalidation is in flight. Pure helpers stay free of `$app/*` so Deno tests can import them.
 */
export const LIVE_REQUEST_HEADER = 'x-praxrr-live';

const DATA_SUFFIX = '/__data.json';
const HTML_DATA_SUFFIX = '.html__data.json';

/** Page pathname a SvelteKit data URL belongs to, or `null` when `pathname` is not a data URL. */
export function dataUrlPagePath(pathname: string): string | null {
  if (pathname.endsWith(HTML_DATA_SUFFIX)) return pathname.slice(0, -HTML_DATA_SUFFIX.length);
  if (pathname.endsWith(DATA_SUFFIX)) return pathname.slice(0, -DATA_SUFFIX.length) || '/';
  return null;
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** True when a GET to `url` is the data request for a live refresh of one of `livePages`. */
export function isLiveDataRequest(url: URL, method: string, livePages: ReadonlyMap<string, number>): boolean {
  if (method.toUpperCase() !== 'GET' || livePages.size === 0) return false;
  const page = dataUrlPagePath(url.pathname);
  return page !== null && livePages.has(normalizePath(page));
}

/** Page pathname -> number of live invalidations in flight for it. */
const livePages = new Map<string, number>();
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const inner = window.fetch;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (livePages.size === 0) return inner(input, init);
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    const method = init?.method ?? request?.method ?? 'GET';
    if (url.origin !== location.origin || !isLiveDataRequest(url, method, livePages)) return inner(input, init);
    const headers = new Headers(init?.headers ?? request?.headers);
    headers.set(LIVE_REQUEST_HEADER, '1');
    const next: RequestInit = { ...init, headers };
    // Preserve SvelteKit's non-enumerable dev marker so its "use load fetch" warning stays quiet.
    if (init && '__sveltekit_fetch__' in init) {
      Object.defineProperty(next, '__sveltekit_fetch__', { value: true, writable: true, configurable: true });
    }
    return inner(input, next);
  };
}

/** Runs `refresh` (an `invalidate()` call) with its data requests tagged as live. */
export async function runLiveRefresh(refresh: () => Promise<void>): Promise<void> {
  install();
  const page = normalizePath(location.pathname);
  livePages.set(page, (livePages.get(page) ?? 0) + 1);
  try {
    await refresh();
  } finally {
    const left = (livePages.get(page) ?? 1) - 1;
    if (left > 0) livePages.set(page, left);
    else livePages.delete(page);
  }
}
