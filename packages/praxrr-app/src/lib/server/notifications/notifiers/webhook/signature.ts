/**
 * Webhook HMAC signing and custom header parsing.
 */

const MAX_CUSTOM_HEADERS = 20;
/** RFC 7230 token characters. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const RESERVED_HEADERS: Record<string, true> = { 'content-type': true, 'content-length': true, host: true };
const RESERVED_PREFIX = 'x-praxrr-';

/**
 * Sign a webhook body: `sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`.
 * `body` must be the exact bytes sent on the wire.
 */
export async function signWebhookBody(secret: string, timestamp: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

/**
 * Parse `Name: value` lines into a header map. Blank lines are ignored. Errors reference line
 * numbers and header names only; header values are secrets and are never echoed.
 */
export function parseCustomHeaders(
  text: string
): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const lineNumber = index + 1;

    const separator = line.indexOf(':');
    if (separator <= 0) {
      return { ok: false, error: `Custom header line ${lineNumber} must be in "Name: value" format` };
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (!HEADER_NAME_PATTERN.test(name)) {
      return { ok: false, error: `Custom header line ${lineNumber} has an invalid header name` };
    }
    const lowerName = name.toLowerCase();
    if (RESERVED_HEADERS[lowerName] === true || lowerName.startsWith(RESERVED_PREFIX)) {
      return { ok: false, error: `Custom header "${name}" is reserved and cannot be set` };
    }
    if (/[\r\n\0]/.test(value)) {
      return { ok: false, error: `Custom header "${name}" contains invalid characters` };
    }
    if (!value) {
      return { ok: false, error: `Custom header "${name}" must have a value` };
    }
    if (seen.has(lowerName)) {
      return { ok: false, error: `Custom header "${name}" is specified more than once` };
    }
    seen.add(lowerName);
    if (seen.size > MAX_CUSTOM_HEADERS) {
      return { ok: false, error: `At most ${MAX_CUSTOM_HEADERS} custom headers are allowed` };
    }
    headers[name] = value;
  }

  return { ok: true, headers };
}
