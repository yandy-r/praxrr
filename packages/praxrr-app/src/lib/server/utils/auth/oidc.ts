/**
 * OIDC (OpenID Connect) utilities
 * Handles discovery, PKCE/nonce helpers, token exchange, and ID token verification
 *
 * ID tokens are verified against the provider's JWKS (WebCrypto, algorithm allowlist) before any
 * claim is trusted. No external dependencies - just native fetch and crypto.
 */

import { isSecureOidcEndpoint } from '$shared/security/oidcEndpoint.ts';

export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
}

export interface TokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

export interface IdTokenClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  /** Some providers send a string; only `true` / `'true'` count as verified. */
  email_verified?: boolean | string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  /** Any other claim the provider includes (groups, roles, …). */
  [claim: string]: unknown;
}

// Cache discovery document (doesn't change often)
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
let cachedDiscovery: {
  url: string;
  doc: DiscoveryDocument;
  expires: number;
} | null = null;

/** Endpoints from a parsed discovery document, with the discovery URL they were fetched from. */
export interface OidcDiscoveryEndpoints {
  url: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/** Endpoints from the most recently parsed discovery document, recorded before transport checks run. */
let lastDiscoveryEndpoints: OidcDiscoveryEndpoints | null = null;

/** Upper bound for each outbound OIDC request (discovery, token exchange, JWKS). */
const OIDC_FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch and cache OIDC discovery document.
 *
 * The discovery URL, the authorization endpoint, the token endpoint, and the JWKS URI must all be
 * `https:` (loopback `http:` excepted): the client secret, authorization code, and signing keys
 * travel over them.
 */
export async function getDiscoveryDocument(url: string): Promise<DiscoveryDocument> {
  if (cachedDiscovery && cachedDiscovery.url === url && Date.now() < cachedDiscovery.expires) {
    return cachedDiscovery.doc;
  }

  if (!isSecureOidcEndpoint(url)) {
    throw new Error('OIDC discovery URL must use https (http is only allowed for loopback hosts)');
  }

  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS) });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Failed to fetch OIDC discovery: ${response.status} (redirects are not followed)`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery: ${response.status}`);
  }

  const doc = (await response.json()) as DiscoveryDocument;

  if (!doc || typeof doc !== 'object') {
    throw new Error('Invalid OIDC discovery document');
  }
  if (typeof doc.issuer !== 'string' || doc.issuer.length === 0) {
    throw new Error('Invalid OIDC discovery document: missing issuer');
  }
  if (typeof doc.authorization_endpoint !== 'string' || doc.authorization_endpoint.length === 0) {
    throw new Error('Invalid OIDC discovery document: missing authorization_endpoint');
  }
  if (!doc.token_endpoint) {
    throw new Error('Invalid OIDC discovery document');
  }
  if (typeof doc.jwks_uri !== 'string' || doc.jwks_uri.length === 0) {
    throw new Error('Invalid OIDC discovery document: missing jwks_uri');
  }
  lastDiscoveryEndpoints = {
    url,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
  };
  if (!isSecureOidcEndpoint(doc.authorization_endpoint)) {
    throw new Error('OIDC authorization endpoint must use https (http is only allowed for loopback hosts)');
  }
  if (!isSecureOidcEndpoint(doc.token_endpoint)) {
    throw new Error('OIDC token endpoint must use https (http is only allowed for loopback hosts)');
  }
  if (!isSecureOidcEndpoint(doc.jwks_uri)) {
    throw new Error('OIDC jwks_uri must use https (http is only allowed for loopback hosts)');
  }

  cachedDiscovery = {
    url,
    doc,
    expires: Date.now() + DISCOVERY_TTL_MS,
  };

  return doc;
}

/**
 * Endpoints from the most recently parsed discovery document, or null when none has been parsed
 * since the cache was cleared. Recorded before the transport checks run, so endpoints from a
 * document that was then refused are still available for reporting.
 */
export function getLastDiscoveryEndpoints(): OidcDiscoveryEndpoints | null {
  return lastDiscoveryEndpoints;
}

/**
 * Generate a random state token for CSRF protection
 */
export function generateState(): string {
  return crypto.randomUUID();
}

/** Encode bytes as unpadded base64url. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url (padded or unpadded) to bytes. Rejects characters outside the base64url
 * alphabet and impossible lengths instead of silently producing garbage.
 */
export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> {
  const unpadded = input.replace(/={0,2}$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(unpadded) || unpadded.length % 4 === 1) {
    throw new Error('Invalid base64url encoding');
  }
  const standard = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decode a base64url JWT segment as UTF-8 JSON that must be a plain object. */
function decodeJwtSegment(segment: string): Record<string, unknown> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(segment));
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JWT segment must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Generate a PKCE code verifier (RFC 7636): 32 random bytes as 43-char base64url. */
export function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256 code challenge: BASE64URL(SHA256(ASCII(verifier))). */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Generate a random nonce binding the ID token to this login attempt. */
export function generateNonce(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Build the authorization URL
 */
export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  opts: {
    clientId: string;
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    scope?: string;
  }
): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: opts.scope || 'openid email profile',
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${authorizationEndpoint}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  opts: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    codeVerifier: string;
  }
): Promise<TokenResponse> {
  const response = await fetch(tokenEndpoint, {
    signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    }),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Token exchange failed: ${response.status} - redirects are not followed`);
  }
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Token exchange error: ${data.error}`);
  }

  return data as TokenResponse;
}

// ---------------------------------------------------------------------------
// ID token signature verification (JWKS)
// ---------------------------------------------------------------------------

/** How long a fetched JWKS is reused. */
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Minimum spacing between forced JWKS refreshes (unknown `kid`) per `jwks_uri`. */
const JWKS_FORCED_REFRESH_INTERVAL_MS = 60 * 1000;

interface JwkEntry {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
}

interface JwksCacheEntry {
  keys: JwkEntry[];
  expires: number;
  lastForcedRefresh: number;
}

const jwksCache = new Map<string, JwksCacheEntry>();

interface AlgorithmSpec {
  kty: 'RSA' | 'EC' | 'OKP';
  crv?: string;
  importParams: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
  verifyParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
}

/** Allowlist of accepted JWS algorithms. Anything absent (`none`, `HS*`, …) is rejected. */
const ALGORITHMS: Record<string, AlgorithmSpec> = {
  RS256: {
    kty: 'RSA',
    importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
  },
  RS384: {
    kty: 'RSA',
    importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
    verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
  },
  RS512: {
    kty: 'RSA',
    importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
    verifyParams: { name: 'RSASSA-PKCS1-v1_5' },
  },
  PS256: {
    kty: 'RSA',
    importParams: { name: 'RSA-PSS', hash: 'SHA-256' },
    verifyParams: { name: 'RSA-PSS', saltLength: 32 },
  },
  PS384: {
    kty: 'RSA',
    importParams: { name: 'RSA-PSS', hash: 'SHA-384' },
    verifyParams: { name: 'RSA-PSS', saltLength: 48 },
  },
  PS512: {
    kty: 'RSA',
    importParams: { name: 'RSA-PSS', hash: 'SHA-512' },
    verifyParams: { name: 'RSA-PSS', saltLength: 64 },
  },
  ES256: {
    kty: 'EC',
    crv: 'P-256',
    importParams: { name: 'ECDSA', namedCurve: 'P-256' },
    verifyParams: { name: 'ECDSA', hash: 'SHA-256' },
  },
  ES384: {
    kty: 'EC',
    crv: 'P-384',
    importParams: { name: 'ECDSA', namedCurve: 'P-384' },
    verifyParams: { name: 'ECDSA', hash: 'SHA-384' },
  },
  ES512: {
    kty: 'EC',
    crv: 'P-521',
    importParams: { name: 'ECDSA', namedCurve: 'P-521' },
    verifyParams: { name: 'ECDSA', hash: 'SHA-512' },
  },
  EdDSA: {
    kty: 'OKP',
    crv: 'Ed25519',
    importParams: { name: 'Ed25519' },
    verifyParams: { name: 'Ed25519' },
  },
};

async function fetchJwks(jwksUri: string): Promise<JwkEntry[]> {
  if (!isSecureOidcEndpoint(jwksUri)) {
    throw new Error('OIDC jwks_uri must use https (http is only allowed for loopback hosts)');
  }
  const response = await fetch(jwksUri, { redirect: 'manual', signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS) });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Failed to fetch OIDC JWKS: ${response.status} (redirects are not followed)`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC JWKS: ${response.status}`);
  }
  const body = (await response.json()) as { keys?: unknown };
  if (!body || !Array.isArray(body.keys)) {
    throw new Error('Invalid JWKS document');
  }
  return body.keys.filter((key): key is JwkEntry => key !== null && typeof key === 'object');
}

/** Keys from `keys` that may verify a token with this header `alg` / `kid`. */
function candidateKeys(keys: JwkEntry[], alg: string, spec: AlgorithmSpec, kid: string | undefined): JwkEntry[] {
  return keys.filter((key) => {
    if (key.kty !== spec.kty) return false;
    if (spec.crv && key.crv !== spec.crv) return false;
    if (key.use !== undefined && key.use !== 'sig') return false;
    if (key.alg !== undefined && key.alg !== alg) return false;
    if (kid !== undefined && key.kid !== kid) return false;
    return true;
  });
}

/**
 * Find signing-key candidates for a token, using the cached JWKS. An unknown `kid` (or no
 * matching key) triggers at most one refetch, and forced refetches are spaced per `jwks_uri` so
 * token-supplied `kid` values cannot be used to hammer the provider.
 */
async function resolveSigningKeys(
  jwksUri: string,
  alg: string,
  spec: AlgorithmSpec,
  kid: string | undefined
): Promise<JwkEntry[]> {
  const now = Date.now();
  let entry = jwksCache.get(jwksUri);
  let freshlyFetched = false;

  if (!entry || now >= entry.expires) {
    entry = {
      keys: await fetchJwks(jwksUri),
      expires: now + JWKS_TTL_MS,
      lastForcedRefresh: entry?.lastForcedRefresh ?? 0,
    };
    jwksCache.set(jwksUri, entry);
    freshlyFetched = true;
  }

  let candidates = candidateKeys(entry.keys, alg, spec, kid);
  if (candidates.length > 0 || freshlyFetched) {
    return candidates;
  }

  if (now - entry.lastForcedRefresh < JWKS_FORCED_REFRESH_INTERVAL_MS && entry.lastForcedRefresh !== 0) {
    return candidates;
  }

  // Count the attempt before fetching so a failing provider stays rate limited too.
  entry.lastForcedRefresh = now;
  const refreshed: JwksCacheEntry = {
    keys: await fetchJwks(jwksUri),
    expires: now + JWKS_TTL_MS,
    lastForcedRefresh: now,
  };
  jwksCache.set(jwksUri, refreshed);
  candidates = candidateKeys(refreshed.keys, alg, spec, kid);
  return candidates;
}

/** Import only the public members of a JWK for verification. */
function importPublicKey(jwk: JwkEntry, spec: AlgorithmSpec): Promise<CryptoKey> {
  const publicJwk: JsonWebKey =
    spec.kty === 'RSA'
      ? { kty: 'RSA', n: jwk.n, e: jwk.e }
      : spec.kty === 'EC'
        ? { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
        : { kty: 'OKP', crv: jwk.crv, x: jwk.x };
  return crypto.subtle.importKey('jwk', publicJwk, spec.importParams, false, ['verify']);
}

/**
 * Verify the ID token's JWS signature against the provider's `jwks_uri`.
 * Only allowlisted asymmetric algorithms are accepted; the key is chosen by `kid` and key type,
 * never by anything that would let the token pick a symmetric or absent algorithm.
 * Throws on any failure.
 */
export async function verifyIdTokenSignature(idToken: string, jwksUri: string): Promise<void> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const header = decodeJwtSegment(parts[0]);
  const alg = header.alg;
  if (typeof alg !== 'string' || !Object.hasOwn(ALGORITHMS, alg)) {
    throw new Error(`Unsupported ID token signing algorithm: ${typeof alg === 'string' ? alg : 'missing'}`);
  }
  const kid = header.kid;
  if (kid !== undefined && typeof kid !== 'string') {
    throw new Error('Invalid ID token key id');
  }

  const spec = ALGORITHMS[alg];
  const signature = base64UrlDecode(parts[2]);
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

  const candidates = await resolveSigningKeys(jwksUri, alg, spec, kid);
  if (candidates.length === 0) {
    throw new Error('No matching signing key found in JWKS');
  }

  for (const jwk of candidates) {
    let key: CryptoKey;
    try {
      key = await importPublicKey(jwk, spec);
    } catch {
      continue;
    }
    if (await crypto.subtle.verify(spec.verifyParams, key, signature, signedData)) {
      return;
    }
  }

  throw new Error('ID token signature verification failed');
}

/**
 * Decode a JWT payload and extract claims. This performs NO signature check; call
 * `verifyIdTokenSignature` first.
 */
export function decodeIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  return decodeJwtSegment(parts[1]) as IdTokenClaims;
}

/**
 * Verify basic claims on the ID token
 */
export function verifyIdToken(
  claims: IdTokenClaims,
  opts: {
    clientId: string;
    issuer: string;
  }
): void {
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('ID token must contain a non-empty subject');
  }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    throw new Error('ID token must contain a numeric expiration');
  }
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) {
    throw new Error('ID token must contain a numeric iat claim');
  }

  // Verify issuer
  if (claims.iss !== opts.issuer) {
    throw new Error(`Invalid issuer: expected ${opts.issuer}, got ${claims.iss}`);
  }

  // Verify audience and, when present, the authorized party (OIDC Core 3.1.3.7).
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(opts.clientId)) {
    throw new Error(`Invalid audience: token not issued for ${opts.clientId}`);
  }
  const azp = claims.azp;
  if (azp !== undefined && azp !== opts.clientId) {
    throw new Error('Invalid azp: token authorized party does not match the client');
  }
  if (audiences.length > 1 && azp !== opts.clientId) {
    throw new Error('Invalid azp: multi-audience token must carry an azp matching the client');
  }

  // Verify expiration and that the token was not issued far in the future.
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) {
    throw new Error('ID token has expired');
  }
  if (claims.iat > now + 300) {
    throw new Error('ID token iat is in the future');
  }
}

/**
 * Require the ID token's `nonce` claim to equal the nonce stored for this login attempt.
 */
export function verifyIdTokenNonce(claims: IdTokenClaims, expectedNonce: string): void {
  const nonce = claims.nonce;
  if (typeof nonce !== 'string' || nonce.length === 0) {
    throw new Error('ID token is missing the nonce claim');
  }
  const a = new TextEncoder().encode(nonce);
  const b = new TextEncoder().encode(expectedNonce);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ (b[i] ?? 0);
  }
  if (diff !== 0) {
    throw new Error('ID token nonce does not match');
  }
}

/**
 * Clear the cached discovery document
 */
export function clearDiscoveryCache(): void {
  cachedDiscovery = null;
  lastDiscoveryEndpoints = null;
}

/**
 * Clear the cached JWKS documents (and their refresh rate-limit state)
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}
