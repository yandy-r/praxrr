export interface ParsedHttpUrl {
  value: string | null;
  isValid: boolean;
}

export const ALLOWED_HTTP_SCHEMES = ['http:', 'https:'] as const;

/**
 * Parses an optional URL string and validates it is an absolute HTTP/HTTPS URL. Returns
 * `{ value: null, isValid: true }` for null/empty input.
 *
 * @param rawUrl - The raw URL string to parse, or null/undefined
 * @returns A `ParsedHttpUrl` with the validated value and an `isValid` flag
 */
export function parseOptionalAbsoluteHttpUrl(rawUrl: string | null | undefined): ParsedHttpUrl {
  const value = rawUrl?.trim() || null;

  if (value === null) {
    return { value: null, isValid: true };
  }

  try {
    const parsed = new URL(value);
    if (!ALLOWED_HTTP_SCHEMES.includes(parsed.protocol as (typeof ALLOWED_HTTP_SCHEMES)[number])) {
      return { value, isValid: false };
    }

    return { value, isValid: true };
  } catch {
    return { value, isValid: false };
  }
}
