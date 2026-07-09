import { parseUserAgent } from '$auth/userAgent.ts';
import type { WebAuthnCredentialRow } from '$db/queries/webauthnCredentials.ts';

/**
 * Client-safe view of a stored credential (no key material) for the management UI.
 */
export interface WebAuthnCredentialSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
}

/**
 * Signature-counter clone detection.
 *
 * Reject only when the presented counter did not advance AND the stored counter is > 0. Many
 * platform/synced passkeys (Touch ID, iCloud Keychain) always report 0 and never increment —
 * rejecting `newCounter === 0 && stored === 0` would break every login from those authenticators.
 */
export function isCounterRegression(newCounter: number, storedCounter: number): boolean {
  return newCounter <= storedCounter && storedCounter > 0;
}

/**
 * Derive a friendly default credential name from the request's user agent
 * (e.g. "Chrome 120 on macOS 14"). Falls back to "Passkey" when the UA is unknown.
 */
export function defaultCredentialName(userAgent: string): string {
  const { browser, os } = parseUserAgent(userAgent);
  if (browser === 'Unknown' && os === 'Unknown') {
    return 'Passkey';
  }
  return `${browser} on ${os}`;
}

/**
 * Map a stored credential row to its client-safe summary.
 */
export function toCredentialSummary(row: WebAuthnCredentialRow): WebAuthnCredentialSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
  };
}
