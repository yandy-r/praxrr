const NOT_GIT_REPOSITORY_MARKER = 'not a git repository';

export class NotGitRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotGitRepositoryError';
  }
}

function getErrorMessage(input: unknown): string {
  if (input instanceof Error) {
    return input.message;
  }

  return typeof input === 'string' ? input : '';
}

export function isNotGitRepositoryMessage(message: string): boolean {
  return message.toLowerCase().includes(NOT_GIT_REPOSITORY_MARKER);
}

export function isNotGitRepositoryError(input: unknown): boolean {
  if (input instanceof Error && input.name === 'NotGitRepositoryError') {
    return true;
  }

  const message = getErrorMessage(input);
  return isNotGitRepositoryMessage(message);
}

/**
 * Why a remote fetch failed. `auth` covers rejected or missing credentials (including GitHub's
 * "repository not found" for private repositories); `network` covers transport failures.
 */
export type GitFetchFailureKind = 'auth' | 'network' | 'unknown';

const AUTH_FAILURE_PATTERNS = [
  'authentication failed',
  'invalid username or password',
  'invalid username or token',
  'invalid credentials',
  'could not read username',
  'could not read password',
  'terminal prompts disabled',
  'returned error: 401',
  'returned error: 403',
  'permission to',
  'access denied',
  'repository not found',
  'bad credentials',
];

const NETWORK_FAILURE_PATTERNS = [
  'could not resolve host',
  'failed to connect',
  'connection refused',
  'connection timed out',
  'operation timed out',
  'timed out',
  'network is unreachable',
  'connection reset',
  'ssl',
  'tls',
  'gnutls',
  'early eof',
  'rpc failed',
  'returned error: 5',
];

/** Pre-authored, credential-free copy for each fetch failure kind. */
export const GIT_FETCH_FAILURE_MESSAGES: Record<GitFetchFailureKind, string> = {
  auth:
    'Git fetch failed: the remote repository rejected the credentials or denied access. ' +
    'If a personal access token is configured, it may be revoked or expired. Update or clear it in the database settings.',
  network: 'Git network failure: the remote repository could not be reached. Check network access and try again.',
  unknown: 'Git fetch failed: could not fetch from the remote repository.',
};

/** Classify (already redacted) git stderr into a {@link GitFetchFailureKind}. */
export function classifyGitFetchFailure(message: string): GitFetchFailureKind {
  const value = message.toLowerCase();
  if (AUTH_FAILURE_PATTERNS.some((pattern) => value.includes(pattern))) return 'auth';
  if (NETWORK_FAILURE_PATTERNS.some((pattern) => value.includes(pattern))) return 'network';
  return 'unknown';
}

/**
 * A remote fetch failed. `message` is pre-authored copy chosen by `kind` and never contains git
 * output; `detail` is the redacted git stderr for server logs.
 */
export class GitFetchError extends Error {
  readonly kind: GitFetchFailureKind;
  readonly detail: string;

  constructor(kind: GitFetchFailureKind, detail: string) {
    super(GIT_FETCH_FAILURE_MESSAGES[kind]);
    this.name = 'GitFetchError';
    this.kind = kind;
    this.detail = detail;
  }
}

export function isGitFetchError(input: unknown): input is GitFetchError {
  return input instanceof GitFetchError;
}

/** JSON-safe summary of a fetch failure for API responses. */
export interface GitFetchFailure {
  kind: GitFetchFailureKind;
  message: string;
}

export function toGitFetchFailure(error: GitFetchError): GitFetchFailure {
  return { kind: error.kind, message: error.message };
}
