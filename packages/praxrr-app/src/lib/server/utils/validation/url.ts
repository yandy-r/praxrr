export interface ParsedHttpUrl {
  value: string | null;
  isValid: boolean;
}

export const ALLOWED_HTTP_SCHEMES = ['http:', 'https:'] as const;

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

export type GitRepositoryUrlError = 'invalid_url' | 'local_path' | 'not_https' | 'has_credentials';

export interface GitRepositoryUrlValidation {
  isValid: boolean;
  error?: GitRepositoryUrlError;
}

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;

/**
 * Validate a repository URL for contexts that only accept a public, credential-free
 * https git remote (e.g. the setup wizard). Rejects local filesystem paths (`file://`,
 * `/`, `./`, `../`, Windows drive letters), non-https schemes, and userinfo-in-URL
 * credentials (`https://user:pass@host/...`) — callers should direct users to a
 * dedicated personal access token field instead.
 */
export function validateHttpsGitRepositoryUrl(rawUrl: string): GitRepositoryUrlValidation {
  if (
    rawUrl.startsWith('file://') ||
    rawUrl.startsWith('/') ||
    rawUrl.startsWith('./') ||
    rawUrl.startsWith('../') ||
    WINDOWS_DRIVE_PATTERN.test(rawUrl)
  ) {
    return { isValid: false, error: 'local_path' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { isValid: false, error: 'invalid_url' };
  }

  if (parsed.protocol !== 'https:') {
    return { isValid: false, error: 'not_https' };
  }

  if (parsed.username || parsed.password) {
    return { isValid: false, error: 'has_credentials' };
  }

  return { isValid: true };
}
