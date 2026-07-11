/**
 * Pure, fail-fast plugin manifest validator (issue #35, Phase-1).
 *
 * {@link validatePluginManifest} narrows an untrusted `unknown` (a parsed `praxrr.plugin.json`) into a
 * {@link PluginManifest}, accumulating ALL field errors in one pass. It enforces strict `apiVersion`
 * membership, id slug + non-empty name/version, `runtime === 'wasm'`, an `.wasm` entry with an
 * absolute/drive/traversal guard, unknown-top-level-key rejection, unknown/forbidden capability and
 * unknown extension-point rejection (fail-closed), and least-privilege via `checkCapabilityGrant`.
 * PURE: no I/O, no `Deno.env`, client + server safe.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md and implementation-notes.md.
 */

import { CAPABILITY_IDS, checkCapabilityGrant } from './capabilities.ts';
import { EXTENSION_POINT_IDS } from './extensionPoints.ts';
import {
  SUPPORTED_PLUGIN_API_VERSIONS,
  type CapabilityId,
  type ExtensionPointId,
  type ManifestValidationResult,
  type PluginEngines,
  type PluginManifest,
  type PluginManifestIssue,
} from './types.ts';

/** The complete set of accepted top-level manifest keys; anything else is rejected fail-closed. */
const KNOWN_MANIFEST_KEYS: readonly string[] = [
  'apiVersion',
  'id',
  'name',
  'version',
  'runtime',
  'entry',
  'extensionPoints',
  'capabilities',
  'description',
  'author',
  'engines',
];

// Widen the literal-union arrays to `readonly string[]` so `.includes(rawString)` type-checks (TS2345).
const SUPPORTED_API_VERSION_SET: readonly string[] = SUPPORTED_PLUGIN_API_VERSIONS;
const CAPABILITY_ID_SET: readonly string[] = CAPABILITY_IDS;
const EXTENSION_POINT_ID_SET: readonly string[] = EXTENSION_POINT_IDS;

/** Reverse-dns slug: dot-separated lowercase segments, each starting/ending alphanumeric. */
const PLUGIN_ID_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && CAPABILITY_ID_SET.includes(value);
}

function isExtensionPointId(value: unknown): value is ExtensionPointId {
  return typeof value === 'string' && EXTENSION_POINT_ID_SET.includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(field: string, code: string, message: string): PluginManifestIssue {
  return { field, code, message };
}

/** Validate the `entry` field shape without ever reading or executing it. */
function validateEntry(raw: unknown, errors: PluginManifestIssue[]): void {
  if (raw === undefined) {
    errors.push(issue('entry', 'missing', 'entry is required'));
    return;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    errors.push(issue('entry', 'empty', 'entry must be a non-empty string'));
    return;
  }
  if (!raw.endsWith('.wasm')) {
    errors.push(issue('entry', 'invalid_format', 'entry must end with .wasm'));
  }
  if (raw.startsWith('/')) {
    errors.push(issue('entry', 'unsafe_entry', 'entry must be a relative path (absolute path rejected)'));
  }
  if (/^[a-zA-Z]:/.test(raw)) {
    errors.push(issue('entry', 'unsafe_entry', 'entry must not be a Windows drive path'));
  }
  if (raw.includes('\\')) {
    errors.push(issue('entry', 'unsafe_entry', 'entry must not contain backslashes'));
  }
  if (raw.split(/[\\/]/).includes('..')) {
    errors.push(issue('entry', 'unsafe_entry', 'entry must not contain a parent-directory (..) segment'));
  }
}

/** Validate the optional `engines` object; returns the projected value on success. */
function validateEngines(raw: unknown, errors: PluginManifestIssue[]): PluginEngines | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isPlainObject(raw)) {
    errors.push(issue('engines', 'invalid_type', 'engines must be an object'));
    return undefined;
  }
  const praxrr = raw.praxrr;
  if (praxrr !== undefined && (typeof praxrr !== 'string' || praxrr.trim().length === 0)) {
    errors.push(issue('engines.praxrr', 'invalid_type', 'engines.praxrr must be a non-empty semver range string'));
    return undefined;
  }
  return typeof praxrr === 'string' ? { praxrr } : {};
}

/**
 * Validate a parsed manifest, accumulating every field error in one pass. Returns a narrowed
 * {@link PluginManifest} on success or all {@link PluginManifestIssue}s on failure.
 */
export function validatePluginManifest(raw: unknown): ManifestValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [issue('', 'invalid_type', 'manifest must be a JSON object')] };
  }

  const errors: PluginManifestIssue[] = [];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_MANIFEST_KEYS.includes(key)) {
      errors.push(issue(key, 'unknown_key', `unknown top-level manifest key: ${key}`));
    }
  }

  const apiVersion = raw.apiVersion;
  if (apiVersion === undefined) {
    errors.push(issue('apiVersion', 'missing', 'apiVersion is required'));
  } else if (typeof apiVersion !== 'string' || !SUPPORTED_API_VERSION_SET.includes(apiVersion)) {
    errors.push(
      issue(
        'apiVersion',
        'unsupported_api_version',
        `apiVersion must be one of: ${SUPPORTED_PLUGIN_API_VERSIONS.join(', ')}`
      )
    );
  }

  const id = raw.id;
  if (id === undefined) {
    errors.push(issue('id', 'missing', 'id is required'));
  } else if (typeof id !== 'string' || id.trim().length === 0) {
    errors.push(issue('id', 'empty', 'id must be a non-empty string'));
  } else if (!PLUGIN_ID_PATTERN.test(id)) {
    errors.push(issue('id', 'invalid_format', 'id must be a reverse-dns slug (lowercase, dot-separated)'));
  }

  const name = raw.name;
  if (name === undefined) {
    errors.push(issue('name', 'missing', 'name is required'));
  } else if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push(issue('name', 'empty', 'name must be a non-empty string'));
  }

  const version = raw.version;
  if (version === undefined) {
    errors.push(issue('version', 'missing', 'version is required'));
  } else if (typeof version !== 'string' || version.trim().length === 0) {
    errors.push(issue('version', 'empty', 'version must be a non-empty string'));
  }

  const runtime = raw.runtime;
  if (runtime === undefined) {
    errors.push(issue('runtime', 'missing', 'runtime is required'));
  } else if (runtime !== 'wasm') {
    errors.push(issue('runtime', 'invalid_format', "runtime must be 'wasm'"));
  }

  validateEntry(raw.entry, errors);

  const declaredPoints: ExtensionPointId[] = [];
  const rawPoints = raw.extensionPoints;
  if (rawPoints === undefined) {
    errors.push(issue('extensionPoints', 'missing', 'extensionPoints is required'));
  } else if (!Array.isArray(rawPoints)) {
    errors.push(issue('extensionPoints', 'invalid_type', 'extensionPoints must be an array'));
  } else if (rawPoints.length === 0) {
    errors.push(issue('extensionPoints', 'empty', 'extensionPoints must be non-empty'));
  } else {
    rawPoints.forEach((point, index) => {
      if (isExtensionPointId(point)) {
        declaredPoints.push(point);
      } else {
        errors.push(
          issue(`extensionPoints[${index}]`, 'unknown_extension_point', `unknown extension point: ${String(point)}`)
        );
      }
    });
  }

  const declaredCapabilities: CapabilityId[] = [];
  const rawCapabilities = raw.capabilities;
  if (rawCapabilities === undefined) {
    errors.push(issue('capabilities', 'missing', 'capabilities is required'));
  } else if (!Array.isArray(rawCapabilities)) {
    errors.push(issue('capabilities', 'invalid_type', 'capabilities must be an array'));
  } else {
    rawCapabilities.forEach((capability, index) => {
      if (isCapabilityId(capability)) {
        declaredCapabilities.push(capability);
      } else {
        errors.push(issue(`capabilities[${index}]`, 'unknown_capability', `unknown capability: ${String(capability)}`));
      }
    });
  }

  // Least-privilege: each requested capability must be consumable by at least one declared point.
  for (const capability of declaredCapabilities) {
    const grantedBySomePoint = declaredPoints.some((point) => checkCapabilityGrant(point, capability));
    if (!grantedBySomePoint) {
      errors.push(
        issue(
          'capabilities',
          'least_privilege',
          `capability ${capability} is not consumable by any declared extension point`
        )
      );
    }
  }

  const description = raw.description;
  if (description !== undefined && typeof description !== 'string') {
    errors.push(issue('description', 'invalid_type', 'description must be a string'));
  }

  const author = raw.author;
  if (author !== undefined && typeof author !== 'string') {
    errors.push(issue('author', 'invalid_type', 'author must be a string'));
  }

  const engines = validateEngines(raw.engines, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: PluginManifest = {
    apiVersion: apiVersion as string,
    id: id as string,
    name: name as string,
    version: version as string,
    runtime: 'wasm',
    entry: raw.entry as string,
    extensionPoints: declaredPoints,
    capabilities: declaredCapabilities,
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof author === 'string' ? { author } : {}),
    ...(engines !== undefined ? { engines } : {}),
  };

  return { ok: true, manifest };
}
