import { browser } from '$app/environment';
import { startRegistration, startAuthentication, browserSupportsWebAuthn, WebAuthnError } from '@simplewebauthn/browser';

/**
 * Client-safe view of a registered passkey (mirrors the server WebAuthnCredentialSummary).
 */
export interface WebAuthnCredentialSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
}

export { WebAuthnError };

/**
 * True when the current browser can perform WebAuthn ceremonies. Always false during SSR.
 */
export function supportsWebAuthn(): boolean {
  return browser && browserSupportsWebAuthn();
}

/**
 * POST JSON to an API endpoint, throwing the server's { error } message on a non-2xx response.
 */
async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

/**
 * Register a new passkey for the logged-in user. Runs the browser create() ceremony between the
 * server options and verify calls. Throws WebAuthnError on user cancel / unsupported, or Error with
 * the server message on a failed verify.
 */
export async function registerPasskey(
  name?: string
): Promise<{ verified: boolean; credential: WebAuthnCredentialSummary }> {
  const { options } = await postJson<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
    '/api/v1/auth/webauthn/registration/options'
  );
  const attestation = await startRegistration({ optionsJSON: options });
  return postJson('/api/v1/auth/webauthn/registration/verify', { response: attestation, name });
}

/**
 * Passwordless login via a discoverable passkey. Runs the browser get() ceremony between the server
 * options and verify calls. The verify endpoint sets the session cookie server-side; the caller
 * navigates on success.
 */
export async function authenticatePasskey(): Promise<{ verified: boolean }> {
  const { options } = await postJson<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
    '/api/v1/auth/webauthn/authentication/options'
  );
  const assertion = await startAuthentication({ optionsJSON: options });
  return postJson('/api/v1/auth/webauthn/authentication/verify', { response: assertion });
}
