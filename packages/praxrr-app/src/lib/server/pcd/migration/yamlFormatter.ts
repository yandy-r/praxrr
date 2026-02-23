import { stringify as stringifyYaml } from 'yaml';
import type { PortableMigrationMetadata } from '$shared/pcd/portable.ts';
import { validatePortableMigrationMetadata } from '$shared/pcd/portable.ts';

interface JsonLikeRecord {
  [key: string]: JsonLikeValue;
}

type JsonLikeValue = string | number | boolean | null | JsonLikeRecord | JsonLikeValue[];

export interface DeterministicYamlFormatOptions {
  readonly migration?: PortableMigrationMetadata;
}

const RESERVED_MIGRATION_KEY = 'migration';

const YAML_STRINGIFY_OPTIONS = {
  indent: 2,
  lineWidth: 0,
  defaultKeyType: 'PLAIN',
  defaultStringType: 'PLAIN',
  nullStr: 'null',
  trueStr: 'true',
  falseStr: 'false',
  singleQuote: true,
  sortMapEntries: false,
} as const;

/**
 * Stringifies portable payload data using deterministic YAML output rules.
 *
 * - Object key order is preserved to match portable interface ordering.
 * - Null values are emitted explicitly as `null`.
 * - Empty lists use flow style (`[]`) while populated lists use block style.
 * - Optional migration metadata is emitted first with fixed field ordering.
 */
export function formatDeterministicYaml(
  portable: Readonly<Record<string, unknown>>,
  options: DeterministicYamlFormatOptions = {}
): string {
  assertPlainObject(portable, 'portable');

  if (Object.hasOwn(portable, RESERVED_MIGRATION_KEY)) {
    throw new Error('portable payload must not include top-level migration metadata');
  }

  const normalizedPortable = normalizeRecord(portable, 'portable');
  const output: JsonLikeRecord = {};

  if (options.migration !== undefined) {
    output.migration = normalizeMigrationMetadata(options.migration);
  }

  for (const [key, value] of Object.entries(normalizedPortable)) {
    output[key] = value;
  }

  const yaml = stringifyYaml(output, YAML_STRINGIFY_OPTIONS);
  return `${yaml.replace(/\n*$/u, '')}\n`;
}

function normalizeMigrationMetadata(migration: PortableMigrationMetadata): JsonLikeRecord {
  const validationError = validatePortableMigrationMetadata(migration);
  if (validationError) {
    throw new Error(`Invalid migration metadata: ${validationError}`);
  }

  const normalized: JsonLikeRecord = {};
  normalized.format = normalizeValue(migration.format, 'migration.format');
  normalized.version = normalizeValue(migration.version, 'migration.version');
  normalized.source = normalizeValue(migration.source, 'migration.source');

  return normalized;
}

function normalizeRecord(input: Readonly<Record<string, unknown>>, path: string): JsonLikeRecord {
  const normalized: JsonLikeRecord = {};

  for (const key of Object.keys(input)) {
    const value = input[key];
    if (typeof value === 'undefined') {
      continue;
    }
    normalized[key] = normalizeValue(value, `${path}.${key}`);
  }

  return normalized;
}

function normalizeValue(input: unknown, path: string): JsonLikeValue {
  if (input === null) {
    return null;
  }

  if (typeof input === 'string' || typeof input === 'boolean') {
    return input;
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`${path} must be a finite number`);
    }

    return input;
  }

  if (Array.isArray(input)) {
    return input.map((entry, index) => normalizeValue(entry, `${path}[${index}]`));
  }

  if (typeof input === 'undefined') {
    return null;
  }

  if (typeof input !== 'object') {
    throw new Error(`${path} has unsupported value type: ${typeof input}`);
  }

  if (!isPlainObject(input)) {
    throw new Error(`${path} must be a plain object`);
  }

  return normalizeRecord(input, path);
}

function assertPlainObject(input: unknown, path: string): asserts input is Readonly<Record<string, unknown>> {
  if (!isPlainObject(input)) {
    throw new Error(`${path} must be a plain object`);
  }
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
