/**
 * API token secrets: generation, hashing, creation, and resolution (YAN-534).
 *
 * Secrets carry 256 bits of entropy, so a fast SHA-256 is an appropriate at-rest hash. Lookup is
 * by hash only — the plaintext secret is never compared (YAN-439) and never persisted.
 */

import { createHash } from 'node:crypto';
import { apiTokensQueries } from '$db/queries/apiTokens.ts';
import {
  API_TOKEN_EXPIRY_OPTIONS,
  API_TOKEN_NAME_MAX_LENGTH,
  isApiTokenScope,
  type ApiTokenExpiryOption,
  type ApiTokenScope,
  type ApiTokenSummary,
} from '$shared/auth/apiTokenScopes.ts';

export const API_TOKEN_SECRET_PREFIX = 'prx_';

/** Characters of the secret kept as the non-secret display prefix (e.g. `prx_ab12`). */
const DISPLAY_PREFIX_LENGTH = 8;
const SECRET_RANDOM_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Invalid user input for token creation; the message is safe to show in the UI. */
export class ApiTokenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiTokenValidationError';
  }
}

export function hashApiToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** `prx_` followed by 64 lowercase hex characters (32 random bytes). */
export function generateApiTokenSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_RANDOM_BYTES));
  return API_TOKEN_SECRET_PREFIX + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiTokenValidationError('Token name is required');
  }
  const name = value.trim();
  if (name.length === 0) {
    throw new ApiTokenValidationError('Token name is required');
  }
  if (name.length > API_TOKEN_NAME_MAX_LENGTH) {
    throw new ApiTokenValidationError(`Token name must be at most ${API_TOKEN_NAME_MAX_LENGTH} characters`);
  }
  return name;
}

function parseScopes(value: unknown): ApiTokenScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiTokenValidationError('Select at least one scope');
  }
  const scopes: ApiTokenScope[] = [];
  for (const scope of value) {
    if (!isApiTokenScope(scope)) {
      throw new ApiTokenValidationError(`Unknown scope: ${String(scope)}`);
    }
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

function parseExpiryDays(value: unknown): ApiTokenExpiryOption {
  if (value === null || value === undefined || value === '' || value === 'never') {
    return null;
  }
  const days = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  const option = API_TOKEN_EXPIRY_OPTIONS.find((candidate) => candidate !== null && candidate === days);
  if (option === undefined) {
    throw new ApiTokenValidationError('Invalid expiry');
  }
  return option;
}

/**
 * Validate input, mint a secret, and persist only its hash. The returned `secret` is the one and
 * only time the plaintext exists outside the client.
 */
export function createApiToken(input: { name: unknown; scopes: unknown; expiresInDays: unknown }): {
  token: ApiTokenSummary;
  secret: string;
} {
  const name = parseName(input.name);
  const scopes = parseScopes(input.scopes);
  const expiryDays = parseExpiryDays(input.expiresInDays);
  const expiresAt =
    expiryDays === null
      ? null
      : new Date(Date.now() + expiryDays * DAY_MS).toISOString().slice(0, 19).replace('T', ' ');

  const secret = generateApiTokenSecret();
  const token = apiTokensQueries.create({
    name,
    tokenHash: hashApiToken(secret),
    prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
    scopes,
    expiresAt,
  });
  return { token, secret };
}

/** Resolve a presented secret to an active token (recording use), or null. */
export function resolveApiToken(secret: string): ApiTokenSummary | null {
  if (secret.length === 0) return null;
  const token = apiTokensQueries.findActiveByHash(hashApiToken(secret));
  if (!token) return null;
  apiTokensQueries.touchLastUsed(token.id);
  return token;
}
