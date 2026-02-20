/**
 * Section diff helpers
 *
 * Combines namespace-aware entity matching with deep diff generation.
 */

import { type DiffOptions, type PreviewArrayKeyStrategy, diffToFieldChanges } from './diff.ts';
import type { EntityChange, FieldChange } from './types.ts';
import { findNamespaceMatch, normalizeNamespaceDisplayName } from '../namespace.ts';
import type { SyncPreviewAction } from './types.ts';

/**
 * Invariant: array comparison key strategy is explicit.
 * Arrays are compared by stable keys where possible and only fall back to index
 * when no strategy is provided for the path.
 */
export const CUSTOM_FORMAT_ARRAY_KEY_STRATEGIES: readonly PreviewArrayKeyStrategy[] = [
  {
    path: 'specifications',
    selectKey: (specification) => {
      const name = typeof specification.name === 'string' ? specification.name : '';
      const implementation =
        typeof specification.implementation === 'string' ? specification.implementation : '';
      return `${name}:${implementation}`;
    },
  },
];

/**
 * Invariant: quality profile nested arrays are keyed by semantic identifiers.
 * - `items` is matched by quality name (or group name).
 * - `items.items` is matched by quality name.
 * - `formatItems` is matched by `format` ID.
 */
export const QUALITY_PROFILE_ARRAY_KEY_STRATEGIES: readonly PreviewArrayKeyStrategy[] = [
  {
    path: 'items',
    selectKey: (item) => {
      const typed = item as {
        quality?: { name?: string };
        name?: string;
      };
      return typed.quality?.name ?? typed.name ?? '';
    },
  },
  {
    path: 'items.items',
    selectKey: (item) => {
      const typed = item as { quality?: { name?: string } };
      return typed.quality?.name ?? '';
    },
  },
  {
    path: 'formatItems',
    selectKey: (item) => {
      const format = (item as { format?: unknown }).format;
      return String(format ?? '');
    },
  },
];

/**
 * Invariant: metadata and quality definition collections are matched by quality-type key.
 */
export const QUALITY_DEFINITION_ARRAY_KEY_STRATEGIES: readonly PreviewArrayKeyStrategy[] = [
  {
    path: 'qualityDefinitions',
    selectKey: (item) => {
      const typed = item as {
        quality?: { name?: string };
        name?: string;
      };
      return typed.quality?.name ?? typed.name ?? '';
    },
  },
];

export const METADATA_PROFILE_ARRAY_KEY_STRATEGIES: readonly PreviewArrayKeyStrategy[] = [
  {
    path: 'primaryAlbumTypes',
    selectKey: (item) => {
      const typed = item as { albumType?: { name?: string; id?: number } };
      return String(typed.albumType?.id ?? typed.albumType?.name ?? '');
    },
  },
  {
    path: 'secondaryAlbumTypes',
    selectKey: (item) => {
      const typed = item as { albumType?: { name?: string; id?: number } };
      return String(typed.albumType?.id ?? typed.albumType?.name ?? '');
    },
  },
  {
    path: 'releaseStatuses',
    selectKey: (item) => {
      const typed = item as { releaseStatus?: { name?: string; id?: number } };
      return String(typed.releaseStatus?.id ?? typed.releaseStatus?.name ?? '');
    },
  },
];

interface NamedEntityDiffParams<TDesired extends Record<string, unknown>, TCurrent extends Record<string, unknown>> {
  readonly entityType: string;
  readonly desiredEntities: readonly TDesired[];
  readonly currentEntities: readonly TCurrent[];
  readonly desiredName: (entity: TDesired) => string;
  readonly currentName?: (entity: TCurrent) => string;
  readonly desiredComparable?: (entity: TDesired) => unknown;
  readonly currentComparable?: (entity: TCurrent) => unknown;
  readonly currentRemoteId?: (entity: TCurrent) => number | null;
  readonly ignoredFields?: readonly string[];
  readonly arrayKeyStrategies?: readonly PreviewArrayKeyStrategy[];
  readonly sortChangesBy?: (change: EntityChange) => string;
}

interface SingletonEntityDiffParams<TDesired extends Record<string, unknown>, TCurrent extends Record<string, unknown>> {
  readonly entityType: string;
  readonly name: string;
  readonly desiredEntity: TDesired | null;
  readonly currentEntity: TCurrent | null;
  readonly desiredComparable?: (entity: TDesired) => unknown;
  readonly currentComparable?: (entity: TCurrent) => unknown;
  readonly currentRemoteId?: (entity: TCurrent) => number | null;
  readonly ignoredFields?: readonly string[];
  readonly arrayKeyStrategies?: readonly PreviewArrayKeyStrategy[];
}

function getEntityId(entity: Record<string, unknown>): number | null {
  const raw = entity.id;
  return typeof raw === 'number' ? raw : null;
}

function compareForAction(current: unknown, desired: unknown, options: DiffOptions): {
  action: SyncPreviewAction;
  fields: readonly FieldChange[];
} {
  const fields = diffToFieldChanges(current, desired, options);
  if (fields.length === 0) return { action: 'unchanged', fields: [] };
  return { action: current === null ? 'create' : 'update', fields };
}

/**
 * Build preview diff changes for a named collection.
 *
 * Namespace matching precedence:
 * 1. exact desired -> current name match
 * 2. stripped name match (for namespaced remote entities)
 * 3. deterministic tie-break on shortest/lexicographic suffix when ambiguous
 */
export function diffEntityCollection<TDesired extends Record<string, unknown>, TCurrent extends Record<string, unknown>>(
  params: NamedEntityDiffParams<TDesired, TCurrent>
): EntityChange[] {
  const readCurrentName = params.currentName ?? ((entity: TCurrent) =>
    String((entity as { name?: unknown }).name ?? '')
  );
  const currentNames = params.currentEntities.map(readCurrentName);

  const consumed = new Set<number>();
  const comparatorOptions: DiffOptions = {
    ignoredFields: params.ignoredFields,
    arrayKeyStrategies: params.arrayKeyStrategies,
  };

  const changes: EntityChange[] = [];

  for (const desiredEntity of params.desiredEntities) {
    const desiredName = params.desiredName(desiredEntity);
    const match = findNamespaceMatch(desiredName, currentNames, consumed);

    if (!match) {
      const createFields = diffToFieldChanges(
        null,
        params.desiredComparable ? params.desiredComparable(desiredEntity) : desiredEntity,
        comparatorOptions
      );

      changes.push({
        entityType: params.entityType,
        name: normalizeNamespaceDisplayName(desiredName),
        action: 'create',
        remoteId: null,
        fields: createFields,
      });
      continue;
    }

    consumed.add(match.index);
    const currentEntity = params.currentEntities[match.index];
    const currentPayload = params.currentComparable
      ? params.currentComparable(currentEntity)
      : currentEntity;
    const desiredPayload = params.desiredComparable
      ? params.desiredComparable(desiredEntity)
      : desiredEntity;

    const { action, fields } = compareForAction(currentPayload, desiredPayload, comparatorOptions);

    changes.push({
      entityType: params.entityType,
      name: normalizeNamespaceDisplayName(match.matchKind === 'exact'
        ? desiredName
        : match.remoteName),
      action,
      remoteId: params.currentRemoteId
        ? params.currentRemoteId(currentEntity)
        : getEntityId(currentEntity as Record<string, unknown>),
      fields,
    });
  }

  for (let index = 0; index < params.currentEntities.length; index += 1) {
    if (consumed.has(index)) continue;

    const currentEntity = params.currentEntities[index];
    const remoteName = normalizeNamespaceDisplayName(readCurrentName(currentEntity));
    changes.push({
      entityType: params.entityType,
      name: remoteName,
      action: 'delete',
      remoteId: params.currentRemoteId
        ? params.currentRemoteId(currentEntity)
        : getEntityId(currentEntity as Record<string, unknown>),
      fields: [],
    });
  }

  const sortBy = params.sortChangesBy ?? ((change: EntityChange) => change.name);
  return changes.slice().sort((left, right) => sortBy(left).localeCompare(sortBy(right)));
}

/**
 * Build a singleton entity diff with preview-friendly actions.
 */
export function diffSingletonEntity<TDesired extends Record<string, unknown>, TCurrent extends Record<string, unknown>>(
  params: SingletonEntityDiffParams<TDesired, TCurrent>
): EntityChange {
  const comparatorOptions: DiffOptions = {
    ignoredFields: params.ignoredFields,
    arrayKeyStrategies: params.arrayKeyStrategies,
  };

  const emptyState: EntityChange = {
    entityType: params.entityType,
    name: normalizeNamespaceDisplayName(params.name),
    action: 'unchanged',
    remoteId: null,
    fields: [],
  };

  if (!params.desiredEntity && !params.currentEntity) {
    return emptyState;
  }

  if (!params.desiredEntity) {
    return {
      entityType: params.entityType,
      name: normalizeNamespaceDisplayName(params.name),
      action: 'delete',
      remoteId: params.currentEntity
        ? params.currentRemoteId
          ? params.currentRemoteId(params.currentEntity)
          : getEntityId(params.currentEntity as Record<string, unknown>)
        : null,
      fields: [],
    };
  }

  if (!params.currentEntity) {
    return {
      entityType: params.entityType,
      name: normalizeNamespaceDisplayName(params.name),
      action: 'create',
      remoteId: null,
      fields: diffToFieldChanges(
        null,
        params.desiredComparable ? params.desiredComparable(params.desiredEntity) : params.desiredEntity,
        comparatorOptions
      ),
    };
  }

  const currentPayload = params.currentComparable
    ? params.currentComparable(params.currentEntity)
    : params.currentEntity;
  const desiredPayload = params.desiredComparable
    ? params.desiredComparable(params.desiredEntity)
    : params.desiredEntity;

  const { action, fields } = compareForAction(currentPayload, desiredPayload, comparatorOptions);

  return {
    entityType: params.entityType,
    name: normalizeNamespaceDisplayName(params.name),
    action,
    remoteId: params.currentRemoteId
      ? params.currentRemoteId(params.currentEntity)
      : getEntityId(params.currentEntity as Record<string, unknown>),
    fields,
  };
}

/**
 * Minimal helper when a section requires only field updates and has no entity identity.
 */
export function diffUnidentifiedPayload(
  name: string,
  entityType: string,
  desiredPayload: unknown,
  currentPayload: unknown | null,
  comparatorOptions: DiffOptions = {}
): EntityChange {
  if (!currentPayload) {
    return {
      entityType,
      name: normalizeNamespaceDisplayName(name),
      action: 'create',
      remoteId: null,
      fields: diffToFieldChanges(null, desiredPayload, comparatorOptions),
    };
  }

  const { action, fields } = compareForAction(currentPayload, desiredPayload, comparatorOptions);
  return {
    entityType,
    name: normalizeNamespaceDisplayName(name),
    action,
    remoteId: null,
    fields,
  };
}
