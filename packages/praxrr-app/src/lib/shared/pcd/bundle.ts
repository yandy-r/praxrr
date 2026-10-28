/**
 * PCD entity bundles: shared types, caps, structural validation and collision helpers.
 *
 * Used by the server (export/import) and the client (import UI). Contains no server
 * imports; per-entity payload validation stays in `$pcd/entities/validate.ts`, which the
 * server runs on every entry before any write.
 */

import { ENTITY_TYPES, type EntityType, type PortableEntityData } from './portable.ts';

export type { EntityType };

export const BUNDLE_VERSION = 1;
export const BUNDLE_MAX_ENTITIES = 1000;
export const BUNDLE_MAX_JSON_BYTES = 5 * 1024 * 1024;

export type BundleCollisionPolicy = 'skip' | 'rename' | 'overwrite';

export const BUNDLE_COLLISION_POLICIES: readonly BundleCollisionPolicy[] = ['skip', 'rename', 'overwrite'];

export interface PcdBundleEntry {
  entityType: EntityType;
  data: PortableEntityData;
}

export interface PcdBundle {
  version: number;
  entities: PcdBundleEntry[];
}

/** A reference that resolves neither inside the bundle nor in the target database. */
export interface PcdBundleMissingRef {
  fromType: EntityType;
  fromName: string;
  toType: EntityType;
  toName: string;
}

export interface BundleCollisionOptions {
  default: BundleCollisionPolicy;
  /** Keyed by `bundleEntityKey(entityType, name)`; lookups are case-insensitive. */
  perEntity?: Record<string, BundleCollisionPolicy>;
}

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(ENTITY_TYPES);

export function isBundleCollisionPolicy(value: unknown): value is BundleCollisionPolicy {
  return typeof value === 'string' && (BUNDLE_COLLISION_POLICIES as readonly string[]).includes(value);
}

/**
 * Canonical case-insensitive identity of a bundle entity: `<entityType>:<lowercased name>`.
 */
export function bundleEntityKey(entityType: string, name: string): string {
  return `${entityType}:${name.toLowerCase()}`;
}

/**
 * Structural validation of an untrusted bundle value. Returns the typed bundle or an error
 * message. Does not validate per-entity payload shape (the server does that per entry).
 */
export function validateBundle(input: unknown): { bundle: PcdBundle } | { error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'bundle must be an object' };
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.version !== BUNDLE_VERSION) {
    return { error: `bundle.version must be ${BUNDLE_VERSION}` };
  }

  if (!Array.isArray(candidate.entities)) {
    return { error: 'bundle.entities must be an array' };
  }
  if (candidate.entities.length === 0) {
    return { error: 'bundle.entities must contain at least 1 entity' };
  }
  if (candidate.entities.length > BUNDLE_MAX_ENTITIES) {
    return { error: `bundle.entities exceeds the maximum of ${BUNDLE_MAX_ENTITIES} entities` };
  }

  const seen = new Set<string>();
  const entities: PcdBundleEntry[] = [];
  for (let index = 0; index < candidate.entities.length; index++) {
    const entry = candidate.entities[index];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: `bundle.entities[${index}] must be an object` };
    }
    const { entityType, data } = entry as Record<string, unknown>;
    if (typeof entityType !== 'string' || !VALID_ENTITY_TYPES.has(entityType)) {
      return { error: `bundle.entities[${index}].entityType is invalid: ${String(entityType)}` };
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { error: `bundle.entities[${index}].data must be an object` };
    }
    const name = (data as Record<string, unknown>).name;
    if (typeof name !== 'string' || name.length === 0 || name.trim().length === 0) {
      return { error: `bundle.entities[${index}].data.name must be a non-empty string` };
    }
    const key = bundleEntityKey(entityType, name);
    if (seen.has(key)) {
      return { error: `bundle.entities[${index}] duplicates ${entityType} "${name}"` };
    }
    seen.add(key);
    entities.push({ entityType: entityType as EntityType, data: data as PortableEntityData });
  }

  return { bundle: { version: BUNDLE_VERSION, entities } };
}

/**
 * Structural validation of the `collisions` request field.
 */
export function validateCollisionOptions(input: unknown): { options: BundleCollisionOptions } | { error: string } {
  if (input === undefined || input === null) {
    return { options: { default: 'skip', perEntity: {} } };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'collisions must be an object' };
  }
  const candidate = input as Record<string, unknown>;
  const defaultPolicy = candidate.default ?? 'skip';
  if (!isBundleCollisionPolicy(defaultPolicy)) {
    return { error: `collisions.default must be one of: ${BUNDLE_COLLISION_POLICIES.join(', ')}` };
  }
  const perEntity: Record<string, BundleCollisionPolicy> = {};
  if (candidate.perEntity !== undefined && candidate.perEntity !== null) {
    if (typeof candidate.perEntity !== 'object' || Array.isArray(candidate.perEntity)) {
      return { error: 'collisions.perEntity must be an object' };
    }
    for (const [key, policy] of Object.entries(candidate.perEntity as Record<string, unknown>)) {
      if (!isBundleCollisionPolicy(policy)) {
        return { error: `collisions.perEntity["${key}"] must be one of: ${BUNDLE_COLLISION_POLICIES.join(', ')}` };
      }
      perEntity[key.toLowerCase()] = policy;
    }
  }
  return { options: { default: defaultPolicy, perEntity } };
}

/**
 * Resolve the collision policy for one entity: a per-entity override (case-insensitive key)
 * beats the default.
 */
export function resolveCollisionPolicy(
  options: BundleCollisionOptions,
  entityType: string,
  name: string
): BundleCollisionPolicy {
  const perEntity = options.perEntity;
  if (perEntity) {
    const wanted = bundleEntityKey(entityType, name);
    for (const [key, policy] of Object.entries(perEntity)) {
      if (key.toLowerCase() === wanted) return policy;
    }
  }
  return options.default;
}

/**
 * Generate `"<name> (2)"`, `"<name> (3)"`, ... the first candidate whose lowercased form is
 * not in `takenLowercase`. Does not mutate the set.
 */
export function generateRenamedName(name: string, takenLowercase: ReadonlySet<string>): string {
  for (let suffix = 2; ; suffix++) {
    const candidate = `${name} (${suffix})`;
    if (!takenLowercase.has(candidate.toLowerCase())) return candidate;
  }
}
