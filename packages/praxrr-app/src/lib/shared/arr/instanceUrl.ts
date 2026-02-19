export interface ArrInstanceUrlPair {
  url: string;
  external_url: string | null;
}

/**
 * Return the URL that should be used for browser/Open-in links.
 */
export function resolveInstanceBrowserUrl({ url, external_url }: ArrInstanceUrlPair): string {
  return external_url?.trim() || url;
}
