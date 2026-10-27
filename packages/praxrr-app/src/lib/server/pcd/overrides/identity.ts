/**
 * Local overrides: entity identity and action keys.
 *
 * Replays published user ops in id order to attribute each op to the entity it addresses by
 * its CURRENT name (renames move the entity; deletes end it; creates start a new one). This is
 * the inverse of `resolveOpMetadataEntity` (the op vocabulary -> resolved entity types).
 */

import type { PcdOp } from '$db/queries/pcdOps.ts';
import type { ArrAppType } from '$shared/pcd/types.ts';
import { inverseOpMetadataEntity } from '../resolved/layerDiff.ts';
import type { ResolvedEntityType } from '../resolved/types.ts';
import { type EntityGroup, type EntityRef, USER_OP_ACTION_ID_KEY } from './types.ts';

export type { EntityGroup } from './types.ts';

const ARR_AGNOSTIC_TYPES: ReadonlySet<ResolvedEntityType> = new Set<ResolvedEntityType>([
  'delayProfile',
  'regularExpression',
  'customFormat',
  'qualityProfile',
]);

/** Stable string key of an entity identity, shared by the identity map and lookups. */
export function entityKeyOf(
  entityType: ResolvedEntityType,
  arrType: ArrAppType | null | undefined,
  name: string
): string {
  const arr = ARR_AGNOSTIC_TYPES.has(entityType) ? '' : (arrType ?? '');
  return `${entityType}|${arr}|${name}`;
}

export interface ParsedUserOpMetadata {
  operation: string | null;
  entity: string | null;
  name: string | null;
  previousName: string | null;
  stableKeyKey: string | null;
  stableKeyValue: string | null;
  changedFields: string[];
  groupId: string | null;
  actionId: string | null;
  dependsOn: Array<{ entity: string; key: string; value: string }>;
  title: string | null;
  summary: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Defensive parse of `pcd_ops.metadata`. Unknown/malformed metadata yields all-null fields
 * (the op is then treated as unmapped), never an error.
 */
export function parseUserOpMetadata(raw: string | null): ParsedUserOpMetadata {
  const empty: ParsedUserOpMetadata = {
    operation: null,
    entity: null,
    name: null,
    previousName: null,
    stableKeyKey: null,
    stableKeyValue: null,
    changedFields: [],
    groupId: null,
    actionId: null,
    dependsOn: [],
    title: null,
    summary: null,
  };
  if (!raw) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const record = parsed as Record<string, unknown>;

  const stableKey =
    record.stable_key && typeof record.stable_key === 'object' && !Array.isArray(record.stable_key)
      ? (record.stable_key as Record<string, unknown>)
      : null;

  const changedFields = Array.isArray(record.changed_fields)
    ? record.changed_fields.filter((field): field is string => typeof field === 'string')
    : [];

  const dependsOn: ParsedUserOpMetadata['dependsOn'] = [];
  if (Array.isArray(record.depends_on)) {
    for (const dependency of record.depends_on) {
      if (!dependency || typeof dependency !== 'object') continue;
      const entry = dependency as Record<string, unknown>;
      const entity = asString(entry.entity);
      const key = asString(entry.key);
      const value = asString(entry.value);
      if (entity && key && value) dependsOn.push({ entity, key, value });
    }
  }

  return {
    operation: asString(record.operation),
    entity: asString(record.entity),
    name: asString(record.name),
    previousName: asString(record.previousName),
    stableKeyKey: stableKey ? asString(stableKey.key) : null,
    stableKeyValue: stableKey ? asString(stableKey.value) : null,
    changedFields,
    groupId: asString(record.group_id),
    actionId: asString(record[USER_OP_ACTION_ID_KEY]),
    dependsOn,
    title: asString(record.title),
    summary: asString(record.summary),
  };
}

/** Undo unit of an op: `action:<id>` | `group:<id>` | `op:<id>` (in that precedence). */
export function actionKeyOf(op: PcdOp): string {
  const metadata = parseUserOpMetadata(op.metadata);
  if (metadata.actionId) return `action:${metadata.actionId}`;
  if (metadata.groupId) return `group:${metadata.groupId}`;
  return `op:${op.id}`;
}

interface MutableEntity {
  entityMeta: string;
  entityType: ResolvedEntityType;
  arrType: ArrAppType | null;
  originName: string;
  currentName: string;
  ops: PcdOp[];
  hasCreate: boolean;
  hasDelete: boolean;
  hasRename: boolean;
  deleted: boolean;
}

/**
 * Attributes published user ops to entities (spec §2.2).
 *
 * - Ops are replayed in ascending `id`.
 * - The op's target name is `T = stable_key.value ?? name` (the pre-op name for updates, which
 *   also covers the earlier ops of a rename save: they carry the NEW `name` but the OLD key).
 * - create: starts a new entity; rename (`previousName` set, `name` different): moves the
 *   entity found via `T` to `name`; delete: ends the entity; anything else attaches via
 *   `T`, then `name`, then `previousName`.
 * - Finally entities ending with the same `(entityType, arrType, currentName)` are merged
 *   (delete then re-create of one name).
 *
 * Ops whose entity is not in the resolved vocabulary (`test_entity`, unparseable metadata,
 * missing name) are returned in `unmapped`.
 */
export function resolveUserOpEntities(ops: readonly PcdOp[]): {
  entities: Map<string, EntityGroup>;
  unmapped: PcdOp[];
} {
  const sorted = [...ops].sort((a, b) => a.id - b.id);
  const unmapped: PcdOp[] = [];
  const all: MutableEntity[] = [];
  const alias = new Map<string, MutableEntity>();

  const aliasKey = (entityMeta: string, name: string): string => `${entityMeta}|${name}`;

  for (const op of sorted) {
    const metadata = parseUserOpMetadata(op.metadata);
    const mapped = metadata.entity ? inverseOpMetadataEntity(metadata.entity) : null;
    if (!metadata.entity || !metadata.name || !mapped) {
      unmapped.push(op);
      continue;
    }

    const entityMeta = metadata.entity;
    const name = metadata.name;
    const target = metadata.stableKeyValue ?? name;
    const previousName = metadata.previousName;

    const createEntity = (initialName: string): MutableEntity => {
      const entity: MutableEntity = {
        entityMeta,
        entityType: mapped.entityType,
        arrType: mapped.arrType,
        originName: initialName,
        currentName: initialName,
        ops: [],
        hasCreate: false,
        hasDelete: false,
        hasRename: false,
        deleted: false,
      };
      all.push(entity);
      alias.set(aliasKey(entityMeta, initialName), entity);
      return entity;
    };

    const find = (...names: Array<string | null>): MutableEntity | undefined => {
      for (const candidate of names) {
        if (!candidate) continue;
        const found = alias.get(aliasKey(entityMeta, candidate));
        if (found) return found;
      }
      return undefined;
    };

    if (metadata.operation === 'create') {
      const entity = createEntity(name);
      entity.hasCreate = true;
      entity.ops.push(op);
      continue;
    }

    if (metadata.operation === 'delete') {
      const entity = find(target, name, previousName) ?? createEntity(target);
      alias.delete(aliasKey(entityMeta, entity.currentName));
      alias.delete(aliasKey(entityMeta, target));
      alias.delete(aliasKey(entityMeta, name));
      entity.currentName = name;
      entity.hasDelete = true;
      entity.deleted = true;
      entity.ops.push(op);
      continue;
    }

    if (previousName && previousName !== name) {
      const entity = find(target, previousName) ?? createEntity(previousName);
      alias.delete(aliasKey(entityMeta, entity.currentName));
      alias.delete(aliasKey(entityMeta, target));
      alias.delete(aliasKey(entityMeta, previousName));
      entity.currentName = name;
      entity.hasRename = true;
      entity.deleted = false;
      alias.set(aliasKey(entityMeta, name), entity);
      entity.ops.push(op);
      continue;
    }

    const entity = find(target, name, previousName) ?? createEntity(target);
    entity.ops.push(op);
  }

  const entities = new Map<string, EntityGroup>();
  for (const entity of all) {
    // A user-deleted base entity is addressed by its base name; anything created or renamed
    // by the user by its current name.
    const name = entity.deleted && !entity.hasCreate ? entity.originName : entity.currentName;
    const key = entityKeyOf(entity.entityType, entity.arrType, name);
    const existing = entities.get(key);
    if (existing) {
      existing.ops.push(...entity.ops);
      existing.hasCreate ||= entity.hasCreate;
      existing.hasDelete ||= entity.hasDelete;
      existing.hasRename ||= entity.hasRename;
      continue;
    }
    const ref: EntityRef = { entityType: entity.entityType, arrType: entity.arrType, name };
    entities.set(key, {
      ref,
      originName: entity.originName,
      ops: [...entity.ops],
      hasCreate: entity.hasCreate,
      hasDelete: entity.hasDelete,
      hasRename: entity.hasRename,
    });
  }
  for (const group of entities.values()) {
    group.ops.sort((a, b) => a.id - b.id);
  }

  return { entities, unmapped };
}
