/**
 * Plugin boundary projection + secret scrubbing (issue #35, Phase-1).
 *
 * The sole place domain data is projected for plugins (mirrors the least-privilege projection in
 * `mcp/context.ts`). {@link buildCapabilityInput} copies ONLY a minimal, JSON-safe allow-list of
 * top-level fields per granted capability into a structured-clone-safe {@link PluginJsonValue}
 * snapshot; {@link scrubPluginBoundary} then runs the heuristic `redactSecrets` scrubber from
 * `mcp/redact.ts` as defense-in-depth. The allow-list is the PRIMARY guarantee — `redactSecrets` is
 * key-suffix-only and cannot catch a secret in a benign-named field or a URL query string. The host
 * runs `scrubPluginBoundary` at the seam immediately before any executor call, so even a projection
 * regression cannot leak an api_key/token across the boundary.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import type { CapabilityId, PluginJsonValue } from '$shared/plugins/index.ts';
import { redactSecrets } from '../mcp/redact.ts';

/**
 * The minimal, observe-only, JSON-safe top-level fields a granted capability may project.
 * `read:resolved-profile` and `read:sync-preview` are now FINALIZED against their real producers
 * (a PcdQualityProfile with an injected Arr-explicit `arrType`, and a GeneratePreviewResult,
 * respectively). `read:custom-format` and `read:config-validation` remain unwired Phase-1 placeholders,
 * tightened once their real snapshot types finalize. Keyed by every {@link CapabilityId} so adding a
 * capability forces a matching allow-list entry.
 */
const CAPABILITY_FIELD_ALLOWLIST: Record<CapabilityId, readonly string[]> = {
  'read:resolved-profile': ['arrType', 'id', 'name', 'qualities', 'customFormats'],
  'read:sync-preview': ['arrType', 'instanceId', 'summary', 'sections'],
  'read:custom-format': ['formatId', 'name', 'specifications'],
  'read:config-validation': ['valid', 'issues', 'entity'],
};

/**
 * Narrow to a PLAIN object (`{}` / `Object.create(null)`) whose entries can be recursed. Class
 * instances such as `Date`/`Map`/`Set`/`RegExp` are rejected so they drop to `undefined` in
 * {@link toJsonSafe} (matching the doc-comment / `JSON.stringify` intent) instead of serializing to `{}`.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-convert an arbitrary value into a structured-clone-safe {@link PluginJsonValue}, or `undefined`
 * when the value cannot be represented as JSON (functions, symbols, bigints, `undefined`, or class
 * instances such as `Date`/`Map`). Non-finite numbers collapse to `null` so the result round-trips
 * through `JSON.parse(JSON.stringify(...))`. Callers drop `undefined` object entries and coerce
 * `undefined` array elements to `null`, matching `JSON.stringify` semantics.
 */
function toJsonSafe(value: unknown): PluginJsonValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((item) => {
      const converted = toJsonSafe(item);
      return converted === undefined ? null : converted;
    });
  }
  if (isPlainRecord(value)) {
    const out: Record<string, PluginJsonValue> = {};
    for (const [key, val] of Object.entries(value)) {
      const converted = toJsonSafe(val);
      if (converted !== undefined) {
        out[key] = converted;
      }
    }
    return out;
  }
  return undefined;
}

/**
 * Project a least-privilege, JSON-safe snapshot for a single granted capability: copy ONLY the
 * allow-listed top-level fields present on `source`, deep-converted to {@link PluginJsonValue}. Returns
 * `null` (no snapshot) when the capability has no allow-list, `source` is not a plain object, or none of
 * the allow-listed fields are present — plugins never receive live domain objects, DB rows, config,
 * env, or credential-bearing values, only this minimal projection.
 */
export function buildCapabilityInput(capability: CapabilityId, source: unknown): PluginJsonValue {
  const allowList: readonly string[] | undefined = CAPABILITY_FIELD_ALLOWLIST[capability];
  if (allowList === undefined || !isPlainRecord(source)) {
    return null;
  }
  const projected: Record<string, PluginJsonValue> = {};
  for (const field of allowList) {
    if (!Object.hasOwn(source, field)) {
      continue;
    }
    const converted = toJsonSafe(source[field]);
    if (converted !== undefined) {
      projected[field] = converted;
    }
  }
  if (Object.keys(projected).length === 0) {
    return null;
  }
  return projected;
}

/**
 * Defense-in-depth scrub applied at the host seam, immediately before any executor call. Runs the
 * heuristic `redactSecrets` from `mcp/redact.ts`, replacing secret-shaped string values (keys ending in
 * api_key/token/secret/password/credential/authorization) with `[REDACTED]`. This is a
 * belt-and-suspenders backstop only — the allow-list projection in {@link buildCapabilityInput} is the
 * primary guarantee, since `redactSecrets` matches by key-suffix and cannot catch a secret in a
 * benign-named field.
 */
export function scrubPluginBoundary(value: PluginJsonValue): PluginJsonValue {
  return redactSecrets(value);
}
