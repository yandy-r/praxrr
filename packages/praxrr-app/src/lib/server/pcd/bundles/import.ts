/**
 * Bundle import: atomic multi-entity import with dry run and collision policies.
 *
 * Flow (all under the per-database override lock):
 *  1. `planBundle` resolves, per entity, create / skip / rename / overwrite against the live cache,
 *     applies rename propagation to referencing payloads and computes unresolved references.
 *  2. Dry run: the plan is executed against an ephemeral writable cache. Entity writers run
 *     unchanged but their `writeOperation` calls are redirected into the sandbox (see
 *     `writerRedirect.ts`), so nothing reaches `pcd_ops` / `pcd_op_history` and the live cache is
 *     untouched.
 *  3. Real apply: a sandbox preflight must be error-free, then the plan is executed live inside an
 *     op-creation recorder. Any failure restores the pre-import `pcd_ops` snapshot (including prior
 *     user ops superseded by overwrites), deletes every op/history row the import created, and
 *     rebuilds the cache (compensating rollback; the async cache compile forbids one SQLite
 *     transaction).
 */

import { withOpCreationRecorder, type CreatedOpRecord } from '$db/opCreationRecorder.ts';
import { databaseInstancesQueries, disableDatabaseInstance } from '$db/queries/databaseInstances.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import { withDatabaseOverrideLock } from '../conflicts/override.ts';
import { PCDCache } from '../database/cache.ts';
import { compile, invalidate, withAutoOverrideSuppressed } from '../database/compiler.ts';
import { getCache, withScopedCache } from '../database/registry.ts';
import { deserializeByEntityType } from '../entities/deserialize.ts';
import {
  normalizeLidarrMetadataProfileReleaseStatusRows,
  normalizeLidarrMetadataProfileTypeRows,
} from '../entities/metadataProfiles/normalize.ts';
import { validatePortableData } from '../entities/validate.ts';
import * as cfQueries from '../entities/customFormats/index.ts';
import * as delayProfileQueries from '../entities/delayProfiles/index.ts';
import * as metadataProfileQueries from '../entities/metadataProfiles/index.ts';
import * as mediaSettingsQueries from '../entities/mediaManagement/media-settings/index.ts';
import * as namingQueries from '../entities/mediaManagement/naming/index.ts';
import * as qualityDefinitionQueries from '../entities/mediaManagement/quality-definitions/index.ts';
import * as qpQueries from '../entities/qualityProfiles/index.ts';
import * as regexQueries from '../entities/regularExpressions/index.ts';
import { withNewUserOpAction } from '../ops/actionContext.ts';
import { withDeferredCompile } from '../ops/writer.ts';
import type { OperationLayer, WriteOptions, WriteResult } from '../core/types.ts';
import { compiledQueryToSql } from '../utils/sql.ts';
import {
  bundleEntityKey,
  generateRenamedName,
  resolveCollisionPolicy,
  validateBundle,
  type BundleCollisionOptions,
  type PcdBundle,
  type PcdBundleMissingRef,
} from '$shared/pcd/bundle.ts';
import type {
  EntityType,
  PortableCustomFormat,
  PortableDelayProfile,
  PortableEntityData,
  PortableLidarrMetadataProfile,
  PortableLidarrNaming,
  PortableMediaSettings,
  PortableQualityDefinitions,
  PortableQualityProfile,
  PortableRadarrNaming,
  PortableRegularExpression,
  PortableSonarrNaming,
} from '$shared/pcd/portable.ts';
import { sortBundleEntries } from './closure.ts';
import { createHash } from 'node:crypto';
import { withWriterScope } from './writerRedirect.ts';

const SOURCE = 'PCDBundleImport';

export interface ImportedBundleEntity {
  entityType: EntityType;
  name: string;
}
const ALL_LAYERS = new Set<'schema' | 'base' | 'tweaks' | 'user'>(['schema', 'base', 'tweaks', 'user']);

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export type BundleOutcomeAction = 'create' | 'skip' | 'rename' | 'overwrite' | 'error';

export interface BundleEntityOutcome {
  entityType: EntityType;
  /** Name as it appears in the bundle. */
  name: string;
  /** Name the entity has (or would have) in the target database. */
  finalName: string;
  action: BundleOutcomeAction;
  error?: string;
}

export interface BundleImportError {
  entityType: EntityType;
  name: string;
  error: string;
}

export interface BundleImportReport {
  /** Hash over the ordered plan outcomes plus the pre-import `pcd_ops` target state. */
  planDigest: string;
  dryRun: boolean;
  /** True only when a non-dry-run import wrote its operations. */
  applied: boolean;
  rolledBack?: boolean;
  outcomes: BundleEntityOutcome[];
  missingReferences: PcdBundleMissingRef[];
  errors: BundleImportError[];
}

export interface BundleImportOptions {
  databaseId: number;
  /**
   * Reject the import with a plan mismatch when the plan computed from the current database
   * state does not match this digest (e.g. another write landed after the dry run).
   */
  expectedPlanDigest?: string;
  layer: OperationLayer;
  bundle: PcdBundle;
  dryRun: boolean;
  collisions: BundleCollisionOptions;
}

/** A bundle entry failed portable-payload validation (route maps to 400). */
export class BundleInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleInvalidError';
  }
}

/** The plan changed since the dry run the caller based `expectedPlanDigest` on (route maps to 409). */
export class BundlePlanMismatchError extends Error {
  readonly report: BundleImportReport;
  constructor(report: BundleImportReport) {
    super('The import plan no longer matches the database; run a new dry run');
    this.name = 'BundlePlanMismatchError';
    this.report = report;
  }
}

/** A failure mid-apply; every write was rolled back. Carries the report to return. */
export class BundleImportFailedError extends Error {
  readonly report: BundleImportReport;
  constructor(message: string, report: BundleImportReport, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BundleImportFailedError';
    this.report = report;
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate every entry's portable payload (the per-type shape checks the legacy import route
 * applies). Returns an error message or null.
 */
export function validateBundleEntries(bundle: PcdBundle): string | null {
  for (let index = 0; index < bundle.entities.length; index++) {
    const entry = bundle.entities[index];
    const prefix = `bundle.entities[${index}] (${entry.entityType})`;
    const error = validatePortableData(entry.entityType, entry.data as unknown as Record<string, unknown>);
    if (error) return `${prefix}: ${error}`;

    // Reference shape checks: malformed scores/patterns must surface as a 400 instead of a raw
    // TypeError during planning.
    if (entry.entityType === 'quality_profile') {
      const scores = (entry.data as PortableQualityProfile).customFormatScores;
      for (const [scoreIndex, score] of scores.entries()) {
        if (!score || typeof score !== 'object' || typeof score.customFormatName !== 'string') {
          return `${prefix}: customFormatScores[${scoreIndex}].customFormatName must be a non-empty string`;
        }
      }
    } else if (entry.entityType === 'custom_format') {
      const conditions = (entry.data as PortableCustomFormat).conditions;
      for (const [conditionIndex, condition] of conditions.entries()) {
        if (!condition || typeof condition !== 'object' || typeof condition.name !== 'string') {
          return `${prefix}: conditions[${conditionIndex}] must be an object with a name`;
        }
        if (condition.patterns !== undefined) {
          if (!Array.isArray(condition.patterns)) {
            return `${prefix}: conditions[${conditionIndex}].patterns must be an array`;
          }
          for (const [patternIndex, pattern] of condition.patterns.entries()) {
            if (!pattern || typeof pattern !== 'object' || typeof pattern.name !== 'string') {
              return `${prefix}: conditions[${conditionIndex}].patterns[${patternIndex}].name must be a non-empty string`;
            }
          }
        }
      }
    }
  }
  return null;
}

// ============================================================================
// PLANNING
// ============================================================================

const ENTITY_TABLES: Record<EntityType, string> = {
  delay_profile: 'delay_profiles',
  regular_expression: 'regular_expressions',
  custom_format: 'custom_formats',
  quality_profile: 'quality_profiles',
  radarr_naming: 'radarr_naming',
  sonarr_naming: 'sonarr_naming',
  lidarr_naming: 'lidarr_naming',
  radarr_media_settings: 'radarr_media_settings',
  sonarr_media_settings: 'sonarr_media_settings',
  lidarr_media_settings: 'lidarr_media_settings',
  radarr_quality_definitions: 'radarr_quality_definitions',
  sonarr_quality_definitions: 'sonarr_quality_definitions',
  lidarr_quality_definitions: 'lidarr_quality_definitions',
  lidarr_metadata_profile: 'lidarr_metadata_profiles',
};

/** lowercased name -> actual stored name, for one entity type. */
function readExistingNames(cache: PCDCache, entityType: EntityType): Map<string, string> {
  const table = ENTITY_TABLES[entityType];
  const rows = cache.query<{ name: string }>(`SELECT DISTINCT name FROM ${table}`);
  return new Map(rows.map((row) => [row.name.toLowerCase(), row.name]));
}

interface PlannedEntity {
  entityType: EntityType;
  name: string;
  finalName: string;
  action: Exclude<BundleOutcomeAction, 'error'>;
  /** Stored name of the colliding entity (overwrite / skip / rename). */
  existingName: string | null;
  /** Payload to write: renamed and with references rewritten. */
  data: PortableEntityData;
  /** Indexes into `missingReferences` owned by this entity (non-empty => excluded from execution). */
  hasMissingRefs: boolean;
}

interface BundlePlan {
  entities: PlannedEntity[];
  imported: ImportedBundleEntity[];
  missingReferences: PcdBundleMissingRef[];
}

/** Every portable payload carries a non-empty string `name` (validated before planning). */
function entityName(data: PortableEntityData): string {
  return data.name;
}

/**
 * Resolve a reference to the exact stored (or renamed-to) name, case-insensitively. Returns null
 * when the reference resolves nowhere.
 */
function canonicalName(resolvable: Map<string, string>, name: string): string | null {
  return resolvable.get(name.toLowerCase()) ?? null;
}

function lowerSet(values: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const value of values) set.add(value.toLowerCase());
  return set;
}

/**
 * Resolve actions, rename propagation and unresolved references for `bundle` against `cache`.
 * Pure with respect to the cache (reads only).
 */
export function planBundle(cache: PCDCache, bundle: PcdBundle, collisions: BundleCollisionOptions): BundlePlan {
  const entries = sortBundleEntries(bundle.entities);
  const existingByType = new Map<EntityType, Map<string, string>>();
  const existingFor = (entityType: EntityType) => {
    let names = existingByType.get(entityType);
    if (!names) {
      names = readExistingNames(cache, entityType);
      existingByType.set(entityType, names);
    }
    return names;
  };

  // Pass 1: actions and final names. Renamed names must also avoid names already claimed by
  // other renamed bundle entities of the same type.
  const claimedByType = new Map<EntityType, Set<string>>();
  const claimedFor = (entityType: EntityType) => {
    let claimed = claimedByType.get(entityType);
    if (!claimed) {
      claimed = new Set<string>();
      claimedByType.set(entityType, claimed);
    }
    return claimed;
  };
  for (const entry of entries) {
    claimedFor(entry.entityType).add(entityName(entry.data).toLowerCase());
  }

  const decisions = entries.map((entry) => {
    const name = entityName(entry.data);
    const existingName = existingFor(entry.entityType).get(name.toLowerCase()) ?? null;
    if (existingName === null) {
      return { entry, name, finalName: name, action: 'create' as const, existingName };
    }
    const policy = resolveCollisionPolicy(collisions, entry.entityType, name);
    if (policy === 'skip') return { entry, name, finalName: existingName, action: 'skip' as const, existingName };
    if (policy === 'overwrite') {
      return { entry, name, finalName: existingName, action: 'overwrite' as const, existingName };
    }
    const taken = lowerSet([...existingFor(entry.entityType).keys(), ...claimedFor(entry.entityType)]);
    const finalName = generateRenamedName(name, taken);
    claimedFor(entry.entityType).add(finalName.toLowerCase());
    return { entry, name, finalName, action: 'rename' as const, existingName };
  });

  const renames = new Map<EntityType, Map<string, string>>();
  for (const decision of decisions) {
    if (decision.action !== 'rename') continue;
    const map = renames.get(decision.entry.entityType) ?? new Map<string, string>();
    map.set(decision.name.toLowerCase(), decision.finalName);
    renames.set(decision.entry.entityType, map);
  }
  // Bundle entries that were renamed also resolve references to their renamed name.
  const bundleTargets = new Map<EntityType, Map<string, string>>();
  for (const decision of decisions) {
    if (decision.action === 'skip') continue;
    const map = bundleTargets.get(decision.entry.entityType) ?? new Map<string, string>();
    map.set(decision.name.toLowerCase(), decision.finalName);
    bundleTargets.set(decision.entry.entityType, map);
  }
  // Reference resolution targets: renamed names for in-bundle entities and the exact stored names
  // for entities already in the database — both keyed by lowercase. References are rewritten to the
  // resolved name so a case mismatch against the target database never becomes an FK failure.
  const referenceTargets = new Map<EntityType, Map<string, string>>();
  const referenceTargetFor = (entityType: EntityType): Map<string, string> => {
    let targets = referenceTargets.get(entityType);
    if (targets) return targets;
    targets = new Map<string, string>();
    for (const [lower, stored] of existingFor(entityType)) targets.set(lower, stored);
    // Bundle entries resolve to their final name (renamed when renamed, skipped keeps existing).
    for (const [lower, final] of bundleTargets.get(entityType) ?? []) {
      targets.set(lower, final);
    }
    referenceTargets.set(entityType, targets);
    return targets;
  };
  const resolveReference = (entityType: EntityType, name: string): string | null =>
    canonicalName(referenceTargetFor(entityType), name);

  // Pass 2: payload rewriting and missing references.
  const missingReferences: PcdBundleMissingRef[] = [];
  const entities: PlannedEntity[] = decisions.map((decision) => {
    const { entry, name, finalName, action, existingName } = decision;
    const data = structuredClone(entry.data) as PortableEntityData;
    data.name = finalName;
    let hasMissingRefs = false;
    const reportMissing = (toType: EntityType, toName: string) => {
      if (action === 'skip') return;
      hasMissingRefs = true;
      missingReferences.push({ fromType: entry.entityType, fromName: name, toType, toName });
    };

    if (entry.entityType === 'quality_profile') {
      for (const score of (data as PortableQualityProfile).customFormatScores) {
        const resolved = resolveReference('custom_format', score.customFormatName);
        if (resolved === null) reportMissing('custom_format', score.customFormatName);
        else score.customFormatName = resolved;
      }
    } else if (entry.entityType === 'custom_format') {
      for (const condition of (data as PortableCustomFormat).conditions) {
        for (const pattern of condition.patterns ?? []) {
          const resolved = resolveReference('regular_expression', pattern.name);
          if (resolved === null) reportMissing('regular_expression', pattern.name);
          else pattern.name = resolved;
        }
      }
    }

    return { entityType: entry.entityType, name, finalName, action, existingName, data, hasMissingRefs };
  });

  const imported = entities
    .filter((entity) => entity.action !== 'skip')
    .map((entity) => ({ entityType: entity.entityType, name: entity.finalName }));
  return { entities, imported, missingReferences };
}

/**
 * Deterministic digest of the plan and the target state it was computed from (max op id and max
 * `updated_at`). A changed digest means the dry-run preview no longer reflects the database.
 */
export function computeBundlePlanDigest(
  plan: BundlePlan,
  snapshot: ReadonlyArray<PcdOp>,
  databaseId: number,
  layer: OperationLayer
): string {
  const outcomes = planOutcomes(plan).map((outcome) =>
    [outcome.entityType, outcome.name.toLowerCase(), outcome.finalName, outcome.action].join(' ')
  );
  const ops = snapshot
    .filter((op) => op.database_id === databaseId)
    .map((op) => [op.id, op.state, op.content_hash].join(':'))
    .sort();
  return createHash('sha256')
    .update(JSON.stringify([layer, outcomes, ops]))
    .digest('hex')
    .slice(0, 16);
}

function planOutcomes(plan: BundlePlan): BundleEntityOutcome[] {
  return plan.entities.map((entity) => ({
    entityType: entity.entityType,
    name: entity.name,
    finalName: entity.finalName,
    action: entity.action,
  }));
}

/**
 * Precheck that the deferred-apply SQL updates are visible in the live cache. When deferring the
 * full recompile, `writeOperation` execs each op's SQL directly on the live cache (the writer's
 * fast path), so a later entity reads the earlier ones without a recompile. Fail loudly when the
 * cache does not reflect an entity's rows.
 */
function assertCacheReflected(databaseId: number, plan: BundlePlan, justApplied: PlannedEntity): void {
  if (plan.entities.length === 0) return;
  const cache = getCache(databaseId);
  if (!cache) throw new Error('Database cache not available');
  // A cheap probe: the just-applied entity must be visible by name.
  const table = ENTITY_TABLES[justApplied.entityType];
  const rows = cache.query<{ name: string }>(
    `SELECT name FROM ${table} WHERE lower(name) = lower(?)`,
    justApplied.finalName
  );
  if (rows.length === 0) {
    throw new Error(
      `${justApplied.entityType} "${justApplied.finalName}" is not visible in the live cache after deferred apply`
    );
  }
}

// ============================================================================
// ENTITY EXECUTION (shared by sandbox and live)
// ============================================================================

function assertWriteOk(result: unknown, context: string): void {
  if (result && typeof result === 'object' && (result as { success?: unknown }).success === false) {
    throw new Error((result as { error?: string }).error || `${context} failed`);
  }
}

function requireCache(databaseId: number): PCDCache {
  const cache = getCache(databaseId);
  if (!cache) throw new Error('Database cache not available');
  return cache;
}

async function rowIdByName(cache: PCDCache, entityType: EntityType, name: string): Promise<number> {
  const table = ENTITY_TABLES[entityType];
  const row = cache.queryOne<{ id: number }>(`SELECT id FROM ${table} WHERE name = ?`, name);
  if (!row) throw new Error(`${entityType} "${name}" not found`);
  return row.id;
}

/** Write one planned entity (create / rename / overwrite). `skip` is never executed. */
async function executeEntity(databaseId: number, layer: OperationLayer, planned: PlannedEntity): Promise<void> {
  if (planned.action === 'overwrite') {
    await overwriteEntity(databaseId, layer, planned);
    return;
  }
  const result = await deserializeByEntityType({
    databaseId,
    cache: requireCache(databaseId),
    layer,
    entityType: planned.entityType,
    data: planned.data,
  });
  assertWriteOk(result, `Create ${planned.entityType} "${planned.finalName}"`);
}

/**
 * Update an existing entity in place with value-guarded update handlers (never delete + create).
 * Local data absent from the bundle (for example extra quality profile scores) is left untouched.
 */
async function overwriteEntity(databaseId: number, layer: OperationLayer, planned: PlannedEntity): Promise<void> {
  const name = planned.existingName;
  if (name === null) throw new Error(`Cannot overwrite ${planned.entityType} "${planned.name}": no existing entity`);
  const label = `Overwrite ${planned.entityType} "${name}"`;
  const base = { databaseId, layer };

  switch (planned.entityType) {
    case 'delay_profile': {
      const portable = planned.data as PortableDelayProfile;
      const cache = requireCache(databaseId);
      const current = await delayProfileQueries.getByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(await delayProfileQueries.update({ ...base, cache, current, input: { ...portable, name } }), label);
      return;
    }
    case 'regular_expression': {
      const portable = planned.data as PortableRegularExpression;
      const cache = requireCache(databaseId);
      const current = await regexQueries.get(cache, await rowIdByName(cache, 'regular_expression', name));
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await regexQueries.update({
          ...base,
          cache,
          current,
          input: {
            name,
            pattern: portable.pattern,
            tags: portable.tags,
            description: portable.description,
            regex101Id: portable.regex101Id,
          },
        }),
        label
      );
      return;
    }
    case 'custom_format': {
      const portable = planned.data as PortableCustomFormat;
      let cache = requireCache(databaseId);
      const current = await cfQueries.general(cache, await rowIdByName(cache, 'custom_format', name));
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await cfQueries.updateGeneral({
          ...base,
          cache,
          current,
          input: {
            name,
            description: portable.description ?? '',
            includeInRename: portable.includeInRename,
            tags: portable.tags,
          },
        }),
        label
      );

      cache = requireCache(databaseId);
      const originalConditions = await cfQueries.getConditionsForEvaluation(cache, name);
      assertWriteOk(
        await cfQueries.updateConditions({
          ...base,
          cache,
          formatName: name,
          originalConditions,
          conditions: portable.conditions,
        }),
        label
      );

      // Tests: replace the stored set with the bundle set (keyed by lowercased title + type).
      // Deletes run first so cancelOutCreate can drop a same-bundle create of a removed test.
      const testKey = (title: string, type: string) => `${title.toLowerCase()}\u0000${type}`;
      const stored = await cfQueries.listTests(requireCache(databaseId), name);
      const storedByKey = new Map(stored.map((test) => [testKey(test.title, test.type), test]));
      const wantedKeys = new Set<string>();
      for (const test of portable.tests) wantedKeys.add(testKey(test.title, test.type));
      for (const [key, existing] of storedByKey) {
        if (!wantedKeys.has(key)) {
          assertWriteOk(await cfQueries.deleteTest({ ...base, formatName: name, current: existing }), label);
        }
      }
      for (const test of portable.tests) {
        const key = testKey(test.title, test.type);
        const input = {
          title: test.title,
          type: test.type,
          should_match: test.shouldMatch,
          description: test.description,
        };
        const existing = storedByKey.get(key);
        if (!existing) {
          assertWriteOk(await cfQueries.createTest({ ...base, formatName: name, input }), label);
        } else if (existing.should_match !== test.shouldMatch || (existing.description ?? null) !== test.description) {
          assertWriteOk(await cfQueries.updateTest({ ...base, formatName: name, current: existing, input }), label);
        }
      }
      return;
    }
    case 'quality_profile': {
      const portable = planned.data as PortableQualityProfile;
      let cache = requireCache(databaseId);
      const current = await qpQueries.general(cache, await rowIdByName(cache, 'quality_profile', name));
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await qpQueries.updateGeneral({
          ...base,
          cache,
          current,
          input: {
            name,
            description: portable.description ?? '',
            tags: portable.tags,
            language: portable.language,
          },
        }),
        label
      );

      cache = requireCache(databaseId);
      assertWriteOk(
        await qpQueries.updateQualities({
          ...base,
          cache,
          profileName: name,
          input: { orderedItems: portable.orderedItems },
        }),
        label
      );

      cache = requireCache(databaseId);
      assertWriteOk(
        await qpQueries.updateScoring({
          ...base,
          cache,
          profileName: name,
          input: {
            minimumScore: portable.minimumScore,
            upgradeUntilScore: portable.upgradeUntilScore,
            upgradeScoreIncrement: portable.upgradeScoreIncrement,
            customFormatScores: portable.customFormatScores,
          },
        }),
        label
      );
      return;
    }
    case 'radarr_naming': {
      const portable = planned.data as PortableRadarrNaming;
      const cache = requireCache(databaseId);
      const current = await namingQueries.getRadarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await namingQueries.updateRadarrNaming({ ...base, cache, current, input: { ...portable, name } }),
        label
      );
      return;
    }
    case 'sonarr_naming': {
      const portable = planned.data as PortableSonarrNaming;
      const cache = requireCache(databaseId);
      const current = await namingQueries.getSonarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await namingQueries.updateSonarrNaming({ ...base, cache, current, input: { ...portable, name } }),
        label
      );
      return;
    }
    case 'lidarr_naming': {
      const portable = planned.data as PortableLidarrNaming;
      const cache = requireCache(databaseId);
      const current = await namingQueries.getLidarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await namingQueries.updateLidarrNaming({ ...base, cache, current, input: { ...portable, name } }),
        label
      );
      return;
    }
    case 'radarr_media_settings': {
      const portable = planned.data as PortableMediaSettings;
      const cache = requireCache(databaseId);
      const current = await mediaSettingsQueries.getRadarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await mediaSettingsQueries.updateRadarrMediaSettings({ ...base, cache, current, input: { ...portable, name } }),
        label
      );
      return;
    }
    case 'sonarr_media_settings': {
      const portable = planned.data as PortableMediaSettings;
      const cache = requireCache(databaseId);
      const current = await mediaSettingsQueries.getSonarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await mediaSettingsQueries.updateSonarrMediaSettings({ ...base, cache, current, input: { ...portable, name } }),
        label
      );
      return;
    }
    case 'lidarr_media_settings': {
      const portable = planned.data as PortableMediaSettings;
      const cache = requireCache(databaseId);
      const current = await mediaSettingsQueries.getLidarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await mediaSettingsQueries.updateLidarrMediaSettings({ ...base, cache, current, input: { ...portable, name } }),
        label
      );
      return;
    }
    case 'radarr_quality_definitions': {
      const portable = planned.data as PortableQualityDefinitions;
      const cache = requireCache(databaseId);
      const current = await qualityDefinitionQueries.getRadarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await qualityDefinitionQueries.updateRadarrQualityDefinitions({
          ...base,
          cache,
          current,
          input: { name, entries: portable.entries },
        }),
        label
      );
      return;
    }
    case 'sonarr_quality_definitions': {
      const portable = planned.data as PortableQualityDefinitions;
      const cache = requireCache(databaseId);
      const current = await qualityDefinitionQueries.getSonarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await qualityDefinitionQueries.updateSonarrQualityDefinitions({
          ...base,
          cache,
          current,
          input: { name, entries: portable.entries },
        }),
        label
      );
      return;
    }
    case 'lidarr_quality_definitions': {
      const portable = planned.data as PortableQualityDefinitions;
      const cache = requireCache(databaseId);
      const current = await qualityDefinitionQueries.getLidarrByName(cache, name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await qualityDefinitionQueries.updateLidarrQualityDefinitions({
          ...base,
          cache,
          current,
          input: { name, entries: portable.entries },
        }),
        label
      );
      return;
    }
    case 'lidarr_metadata_profile': {
      const portable = planned.data as PortableLidarrMetadataProfile;
      const cache = requireCache(databaseId);
      const current = (await metadataProfileQueries.list(cache)).find((profile) => profile.name === name);
      if (!current) throw new Error(`${label}: not found`);
      assertWriteOk(
        await metadataProfileQueries.update({
          ...base,
          cache,
          current,
          input: {
            name,
            description: portable.description,
            primaryAlbumTypes: normalizeLidarrMetadataProfileTypeRows('primary', portable.primaryTypes),
            secondaryAlbumTypes: normalizeLidarrMetadataProfileTypeRows('secondary', portable.secondaryTypes),
            releaseStatuses: normalizeLidarrMetadataProfileReleaseStatusRows(portable.releaseStatuses),
          },
        }),
        label
      );
      return;
    }
    default: {
      const exhaustive: never = planned.entityType;
      throw new Error(`Unsupported entity type: ${exhaustive}`);
    }
  }
}

// ============================================================================
// SANDBOX (dry run / preflight)
// ============================================================================

/**
 * Execute the plan against an ephemeral writable cache. Each entity runs in its own SAVEPOINT so a
 * failing entity leaves no partial writes behind. Entities with unresolved references or `skip`
 * are not executed. Returns per-entity errors.
 */
async function runPlanInSandbox(
  databaseId: number,
  layer: OperationLayer,
  plan: BundlePlan
): Promise<BundleImportError[]> {
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) throw new Error(`Database ${databaseId} not found`);

  const sandbox = new PCDCache(instance.local_path, databaseId);
  const errors: BundleImportError[] = [];
  try {
    await sandbox.buildReadOnly({ layers: ALL_LAYERS });
    const raw = sandbox.getRawDb();
    if (!raw) throw new Error('Bundle import sandbox database is unavailable');

    const apply = (options: WriteOptions): Promise<WriteResult> => {
      try {
        raw.exec(`${options.queries.map(compiledQueryToSql).join(';\n\n')};`);
        return Promise.resolve({ success: true });
      } catch (error) {
        return Promise.resolve({ success: false, error: `Validation failed: ${String(error)}` });
      }
    };

    await withScopedCache(databaseId, sandbox, async () => {
      for (const [index, planned] of plan.entities.entries()) {
        if (planned.action === 'skip' || planned.hasMissingRefs) continue;
        // One savepoint per entity: a failing multi-write entity (e.g. a CF whose second op
        // fails) leaves the sandbox exactly as it was before the entity started, so later
        // entities — and the report — never see its partial rows.
        const savepoint = `bundle_sp_${index}`;
        raw.exec(`SAVEPOINT ${savepoint}`);
        try {
          await withWriterScope(apply, () => executeEntity(databaseId, layer, planned));
          raw.exec(`RELEASE ${savepoint}`);
        } catch (error) {
          raw.exec(`ROLLBACK TO ${savepoint}`);
          raw.exec(`RELEASE ${savepoint}`);
          errors.push({
            entityType: planned.entityType,
            name: planned.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  } finally {
    sandbox.close();
  }
  return errors;
}

function withErrors(outcomes: BundleEntityOutcome[], errors: readonly BundleImportError[]): BundleEntityOutcome[] {
  const byKey = new Map(errors.map((error) => [bundleEntityKey(error.entityType, error.name), error]));
  return outcomes.map((outcome) => {
    const error = byKey.get(bundleEntityKey(outcome.entityType, outcome.name));
    return error ? { ...outcome, action: 'error' as const, error: error.error } : outcome;
  });
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Test seam (mirrors `_serializeDependencies` / `_deserializeDependencies` in the pcd routes):
 * `afterLiveEntity` runs after each live-applied entity so tests can inject a mid-bundle failure.
 */
export const _bundleImportDependencies: {
  afterLiveEntity?: (index: number, planned: { entityType: EntityType; name: string }) => void | Promise<void>;
} = {};

/**
 * Import a bundle. Dry runs and failed preflights return a report (`applied: false`); a real
 * apply returns `applied: true` on success, or throws `BundleImportFailedError` after a full
 * rollback. Callers must validate the bundle (`validateBundle`) and the caller's layer permission
 * first; payload shapes are re-validated here.
 */
export function importBundle(options: BundleImportOptions): Promise<BundleImportReport> {
  const validated = validateBundle(options.bundle);
  if ('error' in validated) throw new BundleInvalidError(validated.error);
  const entryError = validateBundleEntries(validated.bundle);
  if (entryError) throw new BundleInvalidError(entryError);

  return withDatabaseOverrideLock(options.databaseId, () =>
    importBundleLocked({ ...options, bundle: validated.bundle })
  );
}

async function importBundleLocked(options: BundleImportOptions): Promise<BundleImportReport> {
  const { databaseId, layer, bundle, dryRun, collisions } = options;

  const liveCache = getCache(databaseId);
  if (!liveCache) throw new Error('Database cache not available');

  const snapshot = pcdOpsQueries.listByDatabase(databaseId);
  const plan = planBundle(liveCache, bundle, collisions);
  const instance = databaseInstancesQueries.getById(databaseId);
  if (!instance) throw new Error(`Database ${databaseId} not found`);
  const planDigest = computeBundlePlanDigest(plan, snapshot, databaseId, layer);
  const baseReport: BundleImportReport = {
    planDigest,
    dryRun,
    applied: false,
    outcomes: planOutcomes(plan),
    missingReferences: plan.missingReferences,
    errors: [],
  };

  if (options.expectedPlanDigest !== undefined && options.expectedPlanDigest !== planDigest) {
    throw new BundlePlanMismatchError(baseReport);
  }

  if (!dryRun && plan.missingReferences.length > 0) {
    return baseReport;
  }

  // Dry run and real-apply preflight share the sandbox execution.
  const sandboxErrors = await runPlanInSandbox(databaseId, layer, plan);
  const reportWithSandbox: BundleImportReport = {
    ...baseReport,
    outcomes: withErrors(baseReport.outcomes, sandboxErrors),
    errors: sandboxErrors,
  };
  if (dryRun || sandboxErrors.length > 0) {
    return reportWithSandbox;
  }

  return applyPlanLive(databaseId, layer, plan, baseReport, snapshot, instance);
}

async function applyPlanLive(
  databaseId: number,
  layer: OperationLayer,
  plan: BundlePlan,
  baseReport: BundleImportReport,
  snapshot: ReadonlyArray<PcdOp>,
  instance: { local_path: string }
): Promise<BundleImportReport> {
  const created: CreatedOpRecord = { opIds: [], historyIds: [], updatedOpIds: [] };
  let current: PlannedEntity | null = null;

  try {
    // Defer the per-write compile for user-layer bundles only; base-layer writes keep their
    // per-write compile so every step's validation runs against the fully recompiled cache.
    const runPlan = () =>
      withOpCreationRecorder(created, () =>
        withNewUserOpAction(async () => {
          for (const [index, planned] of plan.entities.entries()) {
            if (planned.action === 'skip') continue;
            current = planned;
            await executeEntity(databaseId, layer, planned);
            await _bundleImportDependencies.afterLiveEntity?.(index, planned);
            // Cache-state precheck: the deferred-apply SQL exec updates the live cache, so the
            // next entity's deserializer sees this entity's rows.
            assertCacheReflected(databaseId, plan, planned);
          }
        })
      );
    await withAutoOverrideSuppressed(databaseId, () => (layer === 'user' ? withDeferredCompile(runPlan) : runPlan()));
  } catch (error) {
    const failed = current as PlannedEntity | null;
    const cause = error instanceof Error ? error.message : String(error);
    await logger.error('Bundle import failed; rolling back', {
      source: SOURCE,
      meta: {
        databaseId,
        entityType: failed?.entityType,
        name: failed?.name,
        error: cause,
        createdOps: created.opIds.length,
      },
    });
    const rollback = await rollbackLiveImport(databaseId, instance.local_path, snapshot, created);
    const rolledBack = rollback.restored && rollback.recompiled && !rollback.cleanupFailed;

    const errors: BundleImportError[] = failed
      ? [{ entityType: failed.entityType, name: failed.name, error: cause }]
      : [];
    throw new BundleImportFailedError(
      rolledBack ? cause : `${cause} — ${describeIncompleteRollback(rollback)}`,
      {
        ...baseReport,
        applied: false,
        rolledBack,
        outcomes: withErrors(baseReport.outcomes, errors),
        errors,
      },
      { cause: error }
    );
  }

  // One final compile outside the auto-override suppression so remaining pre-existing conflicts
  // resolve normally. The per-write compiles above are suppressed; this one is not. A failure to
  // compile — or any entity missing from the rebuilt cache — means the ops the import persisted do
  // not hold together, so roll back the whole import and surface the real rollback outcome.
  let finalCache: PCDCache | undefined;
  let verifyErrors: BundleImportError[] = [];
  try {
    await compile(instance.local_path, databaseId);
    finalCache = getCache(databaseId);
    const namesByType = new Map<EntityType, Map<string, string>>();
    const missingAfter = finalCache
      ? plan.imported.filter((imported) => {
          let names = namesByType.get(imported.entityType);
          if (!names) {
            names = readExistingNames(finalCache as PCDCache, imported.entityType);
            namesByType.set(imported.entityType, names);
          }
          return names.get(imported.name.toLowerCase()) === undefined;
        })
      : plan.imported;
    verifyErrors = missingAfter.map((imported) => ({ ...imported, error: 'Entity missing after import' }));
  } catch (compileError) {
    verifyErrors = plan.imported.map((imported) => ({ ...imported, error: String(compileError) }));
  }

  if (verifyErrors.length > 0) {
    await logger.error('Bundle import failed final compile/verify; rolling back', {
      source: SOURCE,
      meta: { databaseId, createdOps: created.opIds.length, verifyErrors: verifyErrors.length },
    });
    const rollback = await rollbackLiveImport(databaseId, instance.local_path, snapshot, created);
    const rolledBack = rollback.restored && rollback.recompiled && !rollback.cleanupFailed;
    throw new BundleImportFailedError(
      rolledBack
        ? `Bundle import failed final compile/verify: ${verifyErrors[0].error}`
        : `Bundle import failed final compile/verify (${verifyErrors[0].error}) — ${describeIncompleteRollback(rollback)}`,
      {
        ...baseReport,
        applied: false,
        rolledBack,
        outcomes: withErrors(baseReport.outcomes, verifyErrors),
        errors: verifyErrors,
      }
    );
  }

  await logger.info('Bundle import applied', {
    source: SOURCE,
    meta: { databaseId, layer, entities: plan.entities.length, createdOps: created.opIds.length },
  });
  return { ...baseReport, applied: true };
}

function describeIncompleteRollback(rollback: BundleRollbackResult): string {
  if (!rollback.restored) return 'rollback was incomplete: operations could not be restored; the database was disabled';
  if (!rollback.recompiled) {
    return 'rollback was incomplete: operations were restored but the cache rebuild failed and will retry on the next compile';
  }
  return 'rollback was incomplete: operations were restored but history written by the rollback recompile could not be removed';
}

/**
 * Undo a failed live import: restore every pre-existing op row the import touched, delete every
 * op/history row it created, then rebuild the cache. If the restore itself fails the rows may be a
 * hybrid, so the database is disabled (same signal as a failed cache build).
 */
export interface BundleRollbackResult {
  restored: boolean;
  recompiled: boolean;
  /** True when the rollback recompile's own history cleanup failed. */
  cleanupFailed: boolean;
}

async function rollbackLiveImport(
  databaseId: number,
  localPath: string,
  snapshot: ReadonlyArray<PcdOp>,
  created: CreatedOpRecord
): Promise<BundleRollbackResult> {
  try {
    pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, created);
  } catch (restoreError) {
    let disabled = false;
    try {
      disabled = disableDatabaseInstance(databaseId);
    } catch {
      // Best effort: never replace the original import error.
    }
    invalidate(databaseId);
    await logger.error('Failed to restore operations after failed bundle import', {
      source: SOURCE,
      meta: { databaseId, disabled, error: String(restoreError) },
    });
    return { restored: false, recompiled: false, cleanupFailed: false };
  }

  // Rebuild the cache from the restored rows. Every compile records a `pcd_op_history` batch for the
  // pre-existing ops; record and delete those rows too so the rollback leaves history exactly as it
  // was before the import (the cache itself is unaffected by history rows).
  invalidate(databaseId);
  const rebuilt: CreatedOpRecord = { opIds: [], historyIds: [], updatedOpIds: [] };
  try {
    await withAutoOverrideSuppressed(databaseId, () =>
      withOpCreationRecorder(rebuilt, () => compile(localPath, databaseId))
    );
  } catch (compileError) {
    invalidate(databaseId);
    await logger.error('Failed to recompile after rolling back bundle import', {
      source: SOURCE,
      meta: { databaseId, error: String(compileError) },
    });
    return { restored: true, recompiled: false, cleanupFailed: false };
  }
  try {
    pcdOpsQueries.restoreImportSnapshot(databaseId, snapshot, rebuilt);
  } catch (restoreError) {
    await logger.error('Failed to remove history written by the rollback recompile', {
      source: SOURCE,
      meta: { databaseId, error: String(restoreError) },
    });
    return { restored: true, recompiled: true, cleanupFailed: true };
  }
  return { restored: true, recompiled: true, cleanupFailed: false };
}
