import type { StartupPullEntityDescriptor } from '$lib/server/pull/startup/types.ts';

// Fingerprints normalize scalars and nested structures in a deterministic order, then emit canonical JSON so equal data always hashes identically.

export type StartupMetadataFingerprintInput = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface StartupMetadataFingerprintOptions {
  readonly ignoreKeys?: readonly string[];
  readonly sortArrayValues?: boolean;
  readonly sortObjectKeys?: boolean;
}

interface NormalizerState {
  readonly ignoreKeySet: Set<string>;
  readonly sortObjectKeys: boolean;
  readonly sortArrayValues: boolean;
}

function buildNormalizerState(options: StartupMetadataFingerprintOptions): NormalizerState {
  const ignoreKeys = options.ignoreKeys ?? [];
  return {
    ignoreKeySet: new Set(ignoreKeys.map((key) => key.toLowerCase())),
    sortObjectKeys: options.sortObjectKeys ?? true,
    sortArrayValues: options.sortArrayValues ?? false,
  };
}

function normalizeScalar(value: unknown): string | number | boolean | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof URL) {
    return value.href;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return String(value);
}

function normalizeForFingerprint(
  value: unknown,
  state: NormalizerState
): string | number | boolean | null | Record<string, unknown> | Array<unknown> {
  if (value === null || typeof value !== 'object') {
    return normalizeScalar(value);
  }

  if (Array.isArray(value)) {
    const normalizedItems = value.map((entry) => normalizeForFingerprint(entry, state));
    if (!state.sortArrayValues) {
      return normalizedItems;
    }

    return [...normalizedItems].sort((first, second) => {
      const firstText = canonicalStringify(first);
      const secondText = canonicalStringify(second);
      return firstText.localeCompare(secondText);
    });
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const entries = Object.entries(value)
    .filter(([name]) => !state.ignoreKeySet.has(name.toLowerCase()))
    .map(([name, entryValue]) => {
      const normalizedValue = normalizeForFingerprint(entryValue, state);
      return [name, normalizedValue] as const;
    });

  if (state.sortObjectKeys) {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  }

  return entries.reduce<Record<string, unknown>>((acc, [name, entryValue]) => {
    acc[name] = entryValue;
    return acc;
  }, {});
}

function canonicalStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value !== 'object') {
    return JSON.stringify(normalizeScalar(value));
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return '{}';
  }

  return `{${entries
    .map(([name, entryValue]) => `${JSON.stringify(name)}:${canonicalStringify(entryValue)}`)
    .join(',')}}`;
}

/**
 * Creates a canonical JSON fingerprint string from the given value, normalizing keys and optionally
 * sorting for deterministic output. Returns null for empty/null values.
 *
 * @param value - The input value to fingerprint
 * @param options - Options controlling normalization behavior
 * @returns A canonical fingerprint string, or null if the value is empty/null
 */
export function createStartupMetadataFingerprint(
  value: StartupMetadataFingerprintInput,
  options: StartupMetadataFingerprintOptions = {}
): string | null {
  const normalized = normalizeForFingerprint(value, buildNormalizerState(options));
  const fingerprint = canonicalStringify(normalized);

  if (fingerprint.length === 0 || fingerprint === 'null' || fingerprint === '{}' || fingerprint === '[]') {
    return null;
  }

  return fingerprint;
}

/**
 * Alias for `createStartupMetadataFingerprint`; normalizes a value to a canonical fingerprint string.
 *
 * @param value - The input value to normalize
 * @param options - Options controlling normalization behavior
 * @returns A canonical fingerprint string, or null if the value is empty/null
 */
export function normalizeMetadataForStartupFingerprint(
  value: StartupMetadataFingerprintInput,
  options: StartupMetadataFingerprintOptions = {}
): string | null {
  return createStartupMetadataFingerprint(value, options);
}

/**
 * Returns true if two fingerprint strings are identical (non-null).
 *
 * @param left - The first fingerprint to compare
 * @param right - The second fingerprint to compare
 * @returns Whether both fingerprints are non-null and equal
 */
export function isMetadataFingerprintMatch(left: string | null, right: string | null): boolean {
  if (left === null || right === null) {
    return false;
  }

  return left === right;
}

/**
 * Resolves the fingerprint from a descriptor's stored fingerprint or falls back to generating one
 * from its fields.
 *
 * @param descriptor - The entity descriptor to extract or generate a fingerprint for
 * @param options - Options controlling normalization behavior for generated fingerprints
 * @returns The resolved fingerprint string, or null if one cannot be determined
 */
export function toStartupMetadataFingerprintCandidate(
  descriptor: StartupPullEntityDescriptor,
  options: StartupMetadataFingerprintOptions = {}
): string | null {
  if (typeof descriptor.fingerprint === 'string' && descriptor.fingerprint.length > 0) {
    return descriptor.fingerprint;
  }

  return normalizeMetadataForStartupFingerprint(
    {
      type: descriptor.section,
      name: descriptor.name,
      arrType: descriptor.arrType,
      databaseId: descriptor.databaseId,
    },
    options
  );
}

/**
 * Combines two fingerprint candidates, preferring the remote-first value when `preferRemoteFirst` is set.
 *
 * @param first - The first (typically remote) fingerprint candidate
 * @param second - The second (typically local) fingerprint candidate
 * @param options - Options controlling which candidate takes precedence
 * @returns The selected fingerprint string, or null if both candidates are null
 */
export function buildStartupMetadataFingerprintFromParts(
  first: string | null,
  second: string | null,
  options: { preferRemoteFirst?: boolean } = {}
): string | null {
  if (options.preferRemoteFirst) {
    return first ?? second;
  }

  return second ?? first;
}
