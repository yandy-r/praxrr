/**
 * Shared config validation and send-time URL guards for notification provider modules.
 * Error strings name the field only; they never echo submitted values (which may be secrets).
 */

import { assertSafeOutboundUrl } from '$arr/urlSafety.ts';
import type { ProviderFormInput } from '../registry.ts';
import { NotificationDeliveryError } from '../base/delivery.ts';

/** Trimmed string value of a form field; '' when absent or not a string. */
export function readString(input: ProviderFormInput, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate a required user-supplied http(s) URL: presence, parseability, scheme, and the SSRF
 * metadata/link-local guard. `label` names the URL's owner (e.g. 'Webhook', 'Gotify server');
 * messages read "<label> URL ...", and include at most the hostname, never path or query tokens.
 */
export function parseHttpUrl(raw: string, label: string): { ok: true; url: string } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: `${label} URL is required` };
  try {
    assertSafeOutboundUrl(raw, label);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `${label} URL is not allowed` };
  }
  return { ok: true, url: raw };
}

/**
 * Re-check a stored URL immediately before sending (configs may predate the guard).
 * Throws a delivery error with zero attempts because no request was made.
 */
export function assertSafeDeliveryUrl(url: string, label: string): void {
  const result = parseHttpUrl(url, label);
  if (!result.ok) throw new NotificationDeliveryError(result.error, 0);
}

/**
 * Masking forms of a URL secret: the stored value plus its WHATWG-normalized `href`, because
 * fetch and HTTP errors echo the normalized form (case, percent-encoding, trailing slash).
 */
export function urlSecretValues(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const href = new URL(value).href;
    return href === value ? [value] : [value, href];
  } catch {
    return [value];
  }
}
