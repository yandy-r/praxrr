/**
 * Preview diff primitives
 *
 * These helpers produce field-level `FieldChange` records used by preview hooks.
 *
 * Invariants:
 * 1) Array comparison strategy is explicit and deterministic.
 *    - For paths with a declared key strategy, entries are matched by stable key.
 *    - For paths without a strategy, entries are compared by array index.
 *    - Acceptance example: quality profile `formatItems` is compared by `format`,
 *      not by index order.
 *
 * 2) Volatile fields are ignored.
 *    - ID-like and metadata fields are excluded before comparison.
 *    - Acceptance example: id/links differences do not trigger update actions.
 *
 * 3) Null vs missing semantics are stable.
 *    - `null` and missing fields are treated as equivalent.
 *    - Acceptance example: `{ cutoff: null }` and `{}` are considered equal for diff.
 */

import type { FieldChange } from './types.ts';

/** Strategy for matching array items while diffing nested arrays. */
export interface PreviewArrayKeyStrategy {
  /** Dot path to the array (for example `items`, `formatItems`, `items.items`). */
  readonly path: string;
  /** Stable key extractor for array entries at `path`. */
  readonly selectKey: (item: Record<string, unknown>) => string;
}

/** Diff behavior options. */
export interface DiffOptions {
  readonly ignoredFields?: readonly string[];
  readonly arrayKeyStrategies?: readonly PreviewArrayKeyStrategy[];
  readonly nullAndMissingAreEqual?: boolean;
}

const DEFAULT_IGNORED_FIELDS = new Set([
  'id',
  'links',
  'created',
  'updated',
  'createdAt',
  'updatedAt',
  'revision',
  'lastExecution',
  'lastExecutionTime',
  'lastModified',
  'dateAdded',
  'dateUpdated',
]);

const DEFAULT_ARRAY_KEY_STRATEGIES: PreviewArrayKeyStrategy[] = [];

interface DiffContext {
  ignoredFields: Set<string>;
  arrayKeyStrategies: ReadonlyMap<string, PreviewArrayKeyStrategy>;
  nullAndMissingAreEqual: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

function createContext(options: DiffOptions = {}): DiffContext {
  const ignoredFields = new Set<string>(DEFAULT_IGNORED_FIELDS);
  for (const field of options.ignoredFields ?? []) {
    ignoredFields.add(field);
  }

  const arrayKeyStrategies = new Map<string, PreviewArrayKeyStrategy>();
  for (const strategy of DEFAULT_ARRAY_KEY_STRATEGIES.concat(options.arrayKeyStrategies ?? [])) {
    arrayKeyStrategies.set(strategy.path, strategy);
  }

  return {
    ignoredFields,
    arrayKeyStrategies,
    nullAndMissingAreEqual: options.nullAndMissingAreEqual ?? true,
  };
}

function normalizeValue(value: unknown, path: string, context: DiffContext): unknown {
  if (isNullish(value)) return null;

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry, path, context));
  }

  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (context.ignoredFields.has(key)) continue;
      normalized[key] = normalizeValue(value[key], path ? `${path}.${key}` : key, context);
    }
    return normalized;
  }

  return value;
}

function valueEqual(a: unknown, b: unknown, context: DiffContext): boolean {
  if (context.nullAndMissingAreEqual && isNullish(a) && isNullish(b)) return true;
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;

  return false;
}

function appendPath(path: string, segment: string): string {
  return path ? `${path}.${segment}` : segment;
}

function arrayToKeyedMap(items: unknown[], strategy: PreviewArrayKeyStrategy): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const key = strategy.selectKey(isPlainObject(item) ? item : { value: item });
    const keyWithFallback = key.length > 0 ? key : String(index);
    const existing = map.get(keyWithFallback);

    if (existing) {
      existing.push(item);
    } else {
      map.set(keyWithFallback, [item]);
    }
  }

  return map;
}

function fieldTypeFor(current: unknown, desired: unknown): FieldChange['type'] {
  const currentMissing = current === undefined;
  const desiredMissing = desired === undefined;

  if (currentMissing && !desiredMissing) return 'added';
  if (!currentMissing && desiredMissing) return 'removed';
  return 'changed';
}

function formatPathIndex(segment: string): string {
  return `[${segment}]`;
}

function buildArrayPath(path: string, key: string, repeatIndex?: number): string {
  if (repeatIndex !== undefined) {
    return `${path}${formatPathIndex(JSON.stringify(key))}[${repeatIndex}]`;
  }

  return `${path}${formatPathIndex(JSON.stringify(key))}`;
}

function diffValues(current: unknown, desired: unknown, path: string, context: DiffContext): FieldChange[] {
  if (valueEqual(current, desired, context)) return [];

  if (Array.isArray(current) || Array.isArray(desired)) {
    const currentItems = Array.isArray(current) ? current : [];
    const desiredItems = Array.isArray(desired) ? desired : [];
    const strategy = context.arrayKeyStrategies.get(path);

    if (strategy) {
      const currentByKey = arrayToKeyedMap(currentItems, strategy);
      const desiredByKey = arrayToKeyedMap(desiredItems, strategy);

      const keys = new Set<string>([...currentByKey.keys(), ...desiredByKey.keys()]);
      const sortedKeys = [...keys].sort();
      const changes: FieldChange[] = [];

      for (const key of sortedKeys) {
        const currentBucket = currentByKey.get(key) ?? [];
        const desiredBucket = desiredByKey.get(key) ?? [];
        const maxBucketSize = Math.max(currentBucket.length, desiredBucket.length);

        for (let index = 0; index < maxBucketSize; index += 1) {
          const currentItem = currentBucket[index];
          const desiredItem = desiredBucket[index];

          if (currentItem === undefined && desiredItem === undefined) {
            continue;
          }

          if (currentItem === undefined || desiredItem === undefined) {
            const childPath = maxBucketSize > 1 ? buildArrayPath(path, key, index) : buildArrayPath(path, key);
            changes.push({
              field: childPath,
              type: currentItem === undefined ? 'added' : 'removed',
              current: currentItem,
              desired: desiredItem,
            });
            continue;
          }

          const childPath = maxBucketSize > 1 ? buildArrayPath(path, key, index) : buildArrayPath(path, key);
          const arrayChanges = diffValues(currentItem, desiredItem, childPath, context);
          changes.push(...arrayChanges);
        }
      }

      return changes;
    }

    const maxLength = Math.max(currentItems.length, desiredItems.length);
    const changes: FieldChange[] = [];
    for (let index = 0; index < maxLength; index += 1) {
      const childPath = path ? `${path}[${index}]` : `[${index}]`;
      changes.push(...diffValues(currentItems[index], desiredItems[index], childPath, context));
    }
    return changes;
  }

  if (isPlainObject(current) || isPlainObject(desired)) {
    const left = isPlainObject(current) ? current : {};
    const right = isPlainObject(desired) ? desired : {};
    const keys = new Set<string>([...Object.keys(left), ...Object.keys(right)]);

    const changes: FieldChange[] = [];
    const sortedKeys = [...keys].sort();

    for (const key of sortedKeys) {
      const hasLeft = Object.hasOwn(left, key);
      const hasRight = Object.hasOwn(right, key);

      const leftValue = hasLeft ? left[key] : undefined;
      const rightValue = hasRight ? right[key] : undefined;
      const childPath = appendPath(path, key);

      const childChanges = diffValues(leftValue, rightValue, childPath, context);
      if (childChanges.length > 0) {
        changes.push(...childChanges);
        continue;
      }

      // diffValues fully recurses into arrays and objects. When it returns no
      // field-level differences for two values of the same structural type,
      // they are deeply equal — skip the reference-equality fallback which
      // would false-positive on distinct but identical array/object instances.
      if (
        (Array.isArray(leftValue) && Array.isArray(rightValue)) ||
        (isPlainObject(leftValue) && isPlainObject(rightValue))
      ) {
        continue;
      }

      if (!valueEqual(leftValue, rightValue, context)) {
        // This covers scalar leaves and non-strictly-reconcilable pairs.
        changes.push({
          field: childPath,
          type: fieldTypeFor(leftValue, rightValue),
          current: hasLeft ? leftValue : null,
          desired: hasRight ? rightValue : null,
        });
      }
    }

    return changes;
  }

  if (path.length === 0) {
    return [
      {
        field: 'value',
        type: fieldTypeFor(current, desired),
        current,
        desired,
      },
    ];
  }

  return [
    {
      field: path,
      type: fieldTypeFor(current, desired),
      current: isNullish(current) ? null : current,
      desired: isNullish(desired) ? null : desired,
    },
  ];
}

/**
 * Deep compare any two serializable objects and emit preview-ready field changes.
 */
export function diffToFieldChanges(current: unknown, desired: unknown, options: DiffOptions = {}): FieldChange[] {
  const context = createContext(options);
  const normalizedCurrent = normalizeValue(current, '', context);
  const normalizedDesired = normalizeValue(desired, '', context);
  return diffValues(normalizedCurrent, normalizedDesired, '', context);
}
