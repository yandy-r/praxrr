/**
 * Shared OIDC test IdP (YAN-1601): generates signing keys, signs JWTs, and stubs the global fetch
 * to serve a discovery document, a JWKS, and a token endpoint. Used by the OIDC unit and route tests.
 */

import { config, type AuthMode } from '$config';
import { parseOidcAllowlist } from '$auth/oidcAllowlist.ts';
import { clearDiscoveryCache, clearJwksCache } from '$auth/oidc.ts';

export const TEST_ISSUER = 'https://idp.test';
export const TEST_DISCOVERY_URL = `${TEST_ISSUER}/.well-known/openid-configuration`;
export const TEST_JWKS_URI = `${TEST_ISSUER}/jwks`;
export const TEST_TOKEN_ENDPOINT = `${TEST_ISSUER}/token`;
export const TEST_CLIENT_ID = 'praxrr-client';
export const TEST_CLIENT_SECRET = 'praxrr-secret';
export const TEST_NONCE = 'test-nonce-value';
export const TEST_CODE_VERIFIER = 'test-code-verifier-0123456789-0123456789-abcdef';

export type TestAlg = 'RS256' | 'ES256';

export interface TestKey {
  kid: string;
  alg: TestAlg;
  privateKey: CryptoKey;
  /** Public JWK as published in the JWKS (includes kid/alg/use). */
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
}

/** Base64url-encode bytes or a UTF-8 string, unpadded. */
export function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a fresh signing key pair for `alg`. */
export async function generateTestKey(alg: TestAlg = 'RS256', kid: string = crypto.randomUUID()): Promise<TestKey> {
  const params =
    alg === 'RS256'
      ? ({
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        } as RsaHashedKeyGenParams)
      : ({ name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams);
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    kid,
    alg,
    privateKey: pair.privateKey,
    publicJwk: { ...jwk, kid, alg, use: 'sig' },
  };
}

/**
 * Sign `claims` as a JWS compact token. `header` entries override the defaults; pass
 * `signature` to replace the computed signature (e.g. for `alg: none` tokens).
 */
export async function signJwt(
  key: TestKey,
  claims: Record<string, unknown>,
  opts: { header?: Record<string, unknown>; signature?: string } = {}
): Promise<string> {
  const header = { alg: key.alg, typ: 'JWT', kid: key.kid, ...opts.header };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  if (opts.signature !== undefined) {
    return `${signingInput}.${opts.signature}`;
  }
  const algorithm = key.alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  const signature = new Uint8Array(
    await crypto.subtle.sign(algorithm, key.privateKey, new TextEncoder().encode(signingInput))
  );
  return `${signingInput}.${b64url(signature)}`;
}

/** Claims valid for TEST_ISSUER / TEST_CLIENT_ID, with the standard nonce, plus `overrides`. */
export function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: TEST_ISSUER,
    aud: TEST_CLIENT_ID,
    exp: now + 600,
    iat: now,
    sub: 'user-123',
    nonce: TEST_NONCE,
    ...overrides,
  };
}

export interface TestIdp {
  /** Keys currently published at the JWKS endpoint (mutate with `setKeys`). */
  keys: TestKey[];
  /** URL of every fetch served, in order. */
  calls: string[];
  /** Form bodies POSTed to the token endpoint. */
  tokenRequests: URLSearchParams[];
  discoveryDoc: Record<string, unknown>;
  /** Token returned by the token endpoint. */
  idToken: string;
  setKeys(keys: TestKey[]): void;
  /** Number of fetches of `url`. */
  count(url: string): number;
  restore(): void;
}

/**
 * Install a global-fetch stub serving discovery, JWKS, and token endpoints. Caches are cleared on
 * install and on `restore()` so no test inherits state.
 */
export function installTestIdp(
  opts: {
    keys?: TestKey[];
    idToken?: string;
    discoveryDoc?: Record<string, unknown>;
  } = {}
): TestIdp {
  const originalFetch = globalThis.fetch;
  const idp: TestIdp = {
    keys: opts.keys ?? [],
    calls: [],
    tokenRequests: [],
    discoveryDoc: opts.discoveryDoc ?? {
      issuer: TEST_ISSUER,
      authorization_endpoint: `${TEST_ISSUER}/authorize`,
      token_endpoint: TEST_TOKEN_ENDPOINT,
      jwks_uri: TEST_JWKS_URI,
    },
    idToken: opts.idToken ?? '',
    setKeys(keys) {
      idp.keys = keys;
    },
    count(url) {
      return idp.calls.filter((call) => call === url).length;
    },
    restore() {
      globalThis.fetch = originalFetch;
      clearDiscoveryCache();
      clearJwksCache();
    },
  };

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    idp.calls.push(url);
    if (url === TEST_DISCOVERY_URL) {
      return Promise.resolve(new Response(JSON.stringify(idp.discoveryDoc), { status: 200 }));
    }
    if (url === TEST_JWKS_URI) {
      return Promise.resolve(
        new Response(JSON.stringify({ keys: idp.keys.map((key) => key.publicJwk) }), { status: 200 })
      );
    }
    if (url === TEST_TOKEN_ENDPOINT) {
      idp.tokenRequests.push(new URLSearchParams(String(init?.body ?? '')));
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'at', id_token: idp.idToken, token_type: 'Bearer' }), {
          status: 200,
        })
      );
    }
    return Promise.reject(new Error(`Unexpected fetch in test: ${url}`));
  }) as typeof fetch;

  clearDiscoveryCache();
  clearJwksCache();
  return idp;
}

/** `config.authMode` is readonly; tests swap it and always restore. */
export async function withAuthMode(mode: AuthMode, fn: () => Promise<void> | void): Promise<void> {
  const original = config.authMode;
  Object.defineProperty(config, 'authMode', { value: mode, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(config, 'authMode', { value: original, configurable: true, writable: true });
  }
}

/** Swap `config.oidc` for well-formed client credentials plus an allowlist parsed from `allowlistEnv`. */
export async function withOidcConfig(
  allowlistEnv: Parameters<typeof parseOidcAllowlist>[0],
  fn: () => Promise<void> | void,
  discoveryUrl: string = TEST_DISCOVERY_URL
): Promise<void> {
  const originalOidc = config.oidc;
  Object.defineProperty(config, 'oidc', {
    value: {
      discoveryUrl,
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      allowlist: parseOidcAllowlist(allowlistEnv),
    },
    configurable: true,
    writable: true,
  });
  try {
    await fn();
  } finally {
    Object.defineProperty(config, 'oidc', { value: originalOidc, configurable: true, writable: true });
  }
}
