/**
 * Defense-in-depth secret scrubber.
 *
 * The MCP surface wraps service functions that already redact secrets (whitelist mappers,
 * fingerprint-only projections). `redactSecrets` is the fail-fast belt-and-suspenders applied at the
 * serialization boundary of EVERY emitted tool/resource result, so a future mapper regression that
 * accidentally serializes a raw `ArrInstance`/`DatabaseInstance` row cannot leak a credential.
 *
 * See design §8 (issue #23).
 */

/** Keys whose values are replaced with a placeholder. Anchored to the end of the key name. */
export const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization)$/i;

/** Keys that must never be redacted even if they otherwise match (fingerprints are safe to expose). */
const FINGERPRINT_KEY_PATTERN = /_fingerprint$/i;

const REDACTED = '[REDACTED]';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-clone `value`, replacing any secret-shaped key's value with `[REDACTED]`. Fingerprint keys
 * are preserved; arrays and plain objects are recursed; primitives pass through untouched.
 */
export function redactSecrets<T>(value: T): T {
  return redactUnknown(value) as T;
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (!FINGERPRINT_KEY_PATTERN.test(key) && SECRET_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactUnknown(val);
      }
    }
    return out;
  }
  return value;
}
