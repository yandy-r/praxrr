import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
  BundleImportFailedError,
  BundleInvalidError,
  BundlePlanMismatchError,
  importBundle,
  pcdManager,
  canWriteToBase,
  parseOperationLayer,
  type PCDCache,
  type OperationLayer,
  type WriteResult,
} from '$pcd/index.ts';
import {
  ENTITY_TYPES,
  getLidarrMediaManagementPortableEntry,
  type EntityType,
  type PortableCustomFormat,
  type PortableDelayProfile,
  type PortableQualityProfile,
  type PortableRegularExpression,
  type PortableLidarrMediaSettings,
  type PortableLidarrNaming,
  type PortableLidarrQualityDefinitions,
  type PortableMediaSettings,
  type PortableQualityDefinitions,
  type PortableRadarrNaming,
  type PortableSonarrNaming,
  type PortableLidarrMetadataProfile,
  validatePortableMigrationMetadata,
} from '$shared/pcd/portable.ts';
import { BUNDLE_MAX_JSON_BYTES, validateBundle, validateCollisionOptions } from '$shared/pcd/bundle.ts';
import * as deserialize from '$pcd/entities/deserialize.ts';
import { createLidarrNaming } from '$pcd/entities/mediaManagement/naming/create.ts';
import { validatePortableData } from '$pcd/entities/validate.ts';
import { logger } from '$logger/logger.ts';

/**
 * Mapping of portable entity deserializers used during import.
 *
 * @remarks
 * Each deserializer validates and materializes the portable payload for the target
 * entity type. This map centralizes type-specific conversion paths for easy extension.
 */
export const _deserializeDependencies = {
  deserializeDelayProfile: deserialize.deserializeDelayProfile,
  deserializeRegularExpression: deserialize.deserializeRegularExpression,
  deserializeCustomFormat: deserialize.deserializeCustomFormat,
  deserializeQualityProfile: deserialize.deserializeQualityProfile,
  deserializeRadarrNaming: deserialize.deserializeRadarrNaming,
  deserializeSonarrNaming: deserialize.deserializeSonarrNaming,
  deserializeLidarrMediaSettings: deserialize.deserializeLidarrMediaSettings,
  deserializeRadarrMediaSettings: deserialize.deserializeRadarrMediaSettings,
  deserializeSonarrMediaSettings: deserialize.deserializeSonarrMediaSettings,
  deserializeRadarrQualityDefinitions: deserialize.deserializeRadarrQualityDefinitions,
  deserializeSonarrQualityDefinitions: deserialize.deserializeSonarrQualityDefinitions,
  deserializeLidarrQualityDefinitions: deserialize.deserializeLidarrQualityDefinitions,
  deserializeLidarrMetadataProfile: deserialize.deserializeLidarrMetadataProfile,
} as const;

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set(ENTITY_TYPES);

/**
 * POST /api/v1/pcd/import
 *
 * Import a portable PCD entity into a selected database and operation layer.
 *
 * Body (required):
 * - databaseId: target PCD database ID
 * - layer: 'base' or 'user'
 * - entityType: portable entity type
 * - data: portable entity payload
 * - migration: optional migration metadata
 *
 * Bundle import: a body containing a `bundle` key is handled by `handleBundleImport` instead
 * (`{ databaseId, layer, bundle, dryRun?, collisions? }`); the legacy path below is unchanged.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  let bodyBytes = 0;
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength !== null) {
      const declared = parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > BUNDLE_MAX_JSON_BYTES) {
        return json({ error: `Bundle request exceeds the ${BUNDLE_MAX_JSON_BYTES} byte limit` }, { status: 400 });
      }
    }
    const text = await request.text();
    bodyBytes = new TextEncoder().encode(text).byteLength;
    if (bodyBytes > BUNDLE_MAX_JSON_BYTES) {
      return json({ error: `Bundle request exceeds the ${BUNDLE_MAX_JSON_BYTES} byte limit` }, { status: 400 });
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && !Array.isArray(body) && Object.hasOwn(body, 'bundle')) {
    return handleBundleImport(body);
  }

  const { databaseId, layer, entityType, data, migration } = body;

  if (databaseId === undefined || !layer || !entityType || !data) {
    return json({ error: 'Missing required fields: databaseId, layer, entityType, data' }, { status: 400 });
  }

  if (migration !== undefined) {
    const migrationError = validatePortableMigrationMetadata(migration);
    if (migrationError) {
      return json({ error: migrationError }, { status: 400 });
    }
  }

  if (typeof databaseId !== 'number' || !Number.isInteger(databaseId)) {
    return json({ error: 'Invalid databaseId' }, { status: 400 });
  }

  const layerResult = parseOperationLayer(layer);
  if ('error' in layerResult) {
    return json({ error: layerResult.error }, { status: 400 });
  }
  const parsedLayer = layerResult.value;

  if (!VALID_ENTITY_TYPES.has(entityType as string)) {
    return json({ error: `Invalid entityType: ${entityType}` }, { status: 400 });
  }

  const typedEntityType = entityType as EntityType;

  if (parsedLayer === 'base' && !canWriteToBase(databaseId as number)) {
    return json({ error: 'Cannot write to base layer' }, { status: 403 });
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return json({ error: 'Invalid portable payload: data must be an object' }, { status: 400 });
  }

  const lidarrPayloadError = validateLidarrPayload(typedEntityType, data as Record<string, unknown>);
  if (lidarrPayloadError) {
    return json({ error: lidarrPayloadError }, { status: 400 });
  }

  const validationError = validatePortableData(typedEntityType, data as Record<string, unknown>);
  if (validationError) {
    return json({ error: validationError }, { status: 400 });
  }

  const cache = pcdManager.getCache(databaseId as number);
  if (!cache) {
    return json({ error: 'Database cache not available' }, { status: 500 });
  }

  try {
    const result = await deserializeEntity({
      databaseId: databaseId as number,
      cache,
      layer: parsedLayer,
      entityType: typedEntityType,
      data: data as Record<string, unknown>,
    });

    if (!result?.success) {
      const errorMessage = result?.error ?? 'Import failed';
      await logger.warn('Import route received non-successful deserialize write result', {
        source: 'PCDImport',
        meta: {
          databaseId: databaseId as number,
          layer: parsedLayer,
          entityType,
          error: errorMessage,
        },
      });
      const status = isValidationError(errorMessage) ? 400 : 500;
      return json({ error: errorMessage }, { status });
    }

    return json({ success: true });
  } catch (err) {
    const message = getErrorMessage(err);
    await logger.error('Import route failed while writing portable entity', {
      source: 'PCDImport',
      meta: {
        databaseId: databaseId as number,
        layer: parsedLayer,
        entityType,
        error: message,
      },
    });
    const status = isValidationError(err) ? 400 : 500;
    return json({ error: message }, { status });
  }
};

/**
 * Bundle import: validates the request, then delegates to `importBundle`.
 * - 200: report (dry run, or a successful apply)
 * - 400: invalid request / caps / unresolved references / entities failing preflight (report attached)
 * - 403: base layer not writable
 * - 500: mid-apply failure (report attached; `rolledBack` is true only when the restore and recompile succeeded)
 */
async function handleBundleImport(body: Record<string, unknown>): Promise<Response> {
  const { databaseId, layer, bundle, dryRun, collisions, expectedPlanDigest } = body;

  if (databaseId === undefined || !layer) {
    return json({ error: 'Missing required fields: databaseId, layer, bundle' }, { status: 400 });
  }
  if (typeof databaseId !== 'number' || !Number.isInteger(databaseId)) {
    return json({ error: 'Invalid databaseId' }, { status: 400 });
  }

  const layerResult = parseOperationLayer(layer);
  if ('error' in layerResult) {
    return json({ error: layerResult.error }, { status: 400 });
  }
  const parsedLayer = layerResult.value;

  if (parsedLayer === 'base' && !canWriteToBase(databaseId)) {
    return json({ error: 'Cannot write to base layer' }, { status: 403 });
  }

  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    return json({ error: 'dryRun must be a boolean' }, { status: 400 });
  }
  if (expectedPlanDigest !== undefined && typeof expectedPlanDigest !== 'string') {
    return json({ error: 'expectedPlanDigest must be a string' }, { status: 400 });
  }

  const bundleResult = validateBundle(bundle);
  if ('error' in bundleResult) {
    return json({ error: bundleResult.error }, { status: 400 });
  }

  const collisionResult = validateCollisionOptions(collisions);
  if ('error' in collisionResult) {
    return json({ error: collisionResult.error }, { status: 400 });
  }

  if (!pcdManager.getCache(databaseId)) {
    return json({ error: 'Database cache not available' }, { status: 500 });
  }

  const isDryRun = dryRun === true;
  try {
    const report = await importBundle({
      databaseId,
      layer: parsedLayer,
      bundle: bundleResult.bundle,
      dryRun: isDryRun,
      collisions: collisionResult.options,
      expectedPlanDigest: expectedPlanDigest as string | undefined,
    });

    if (!isDryRun && !report.applied) {
      const error =
        report.missingReferences.length > 0
          ? 'Bundle references entities that exist neither in the bundle nor in the target database'
          : 'Bundle import failed validation; nothing was written';
      return json({ error, report, missingReferences: report.missingReferences }, { status: 400 });
    }

    return json(report);
  } catch (err) {
    if (err instanceof BundleImportFailedError) {
      await logger.error('Bundle import failed and was rolled back', {
        source: 'PCDImport',
        meta: { databaseId, layer: parsedLayer, error: err.message },
      });
      return json(
        { error: err.message, report: err.report, rolledBack: err.report.rolledBack === true },
        { status: 500 }
      );
    }
    if (err instanceof BundlePlanMismatchError) {
      return json({ error: err.message, report: err.report }, { status: 409 });
    }
    if (err instanceof BundleInvalidError) {
      return json({ error: err.message }, { status: 400 });
    }
    const message = getErrorMessage(err);
    await logger.error('Bundle import failed', {
      source: 'PCDImport',
      meta: { databaseId, layer: parsedLayer, error: message },
    });
    return json({ error: message }, { status: isValidationError(err) ? 400 : 500 });
  }
}

interface DeserializeArgs {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  entityType: EntityType;
  data: Record<string, unknown>;
}

async function deserializeEntity({ databaseId, cache, layer, entityType, data }: DeserializeArgs) {
  const opts = { databaseId, cache, layer };

  switch (entityType) {
    case 'delay_profile':
      return _deserializeDependencies.deserializeDelayProfile({
        ...opts,
        portable: data as unknown as PortableDelayProfile,
      });
    case 'regular_expression':
      return _deserializeDependencies.deserializeRegularExpression({
        ...opts,
        portable: data as unknown as PortableRegularExpression,
      });
    case 'custom_format':
      return _deserializeDependencies.deserializeCustomFormat({
        ...opts,
        portable: data as unknown as PortableCustomFormat,
      });
    case 'quality_profile':
      return _deserializeDependencies.deserializeQualityProfile({
        ...opts,
        portable: data as unknown as PortableQualityProfile,
      });
    case 'radarr_naming':
      return _deserializeDependencies.deserializeRadarrNaming({
        ...opts,
        portable: data as unknown as PortableRadarrNaming,
      });
    case 'sonarr_naming':
      return _deserializeDependencies.deserializeSonarrNaming({
        ...opts,
        portable: data as unknown as PortableSonarrNaming,
      });
    case 'lidarr_naming':
      return createLidarrNaming({ ...opts, input: data as unknown as PortableLidarrNaming });
    case 'radarr_media_settings':
      return _deserializeDependencies.deserializeRadarrMediaSettings({
        ...opts,
        portable: data as unknown as PortableMediaSettings,
      });
    case 'sonarr_media_settings':
      return _deserializeDependencies.deserializeSonarrMediaSettings({
        ...opts,
        portable: data as unknown as PortableMediaSettings,
      });
    case 'lidarr_media_settings':
      return _deserializeDependencies.deserializeLidarrMediaSettings({
        ...opts,
        portable: data as unknown as PortableLidarrMediaSettings,
      });
    case 'radarr_quality_definitions':
      return _deserializeDependencies.deserializeRadarrQualityDefinitions({
        ...opts,
        portable: data as unknown as PortableQualityDefinitions,
      });
    case 'sonarr_quality_definitions':
      return _deserializeDependencies.deserializeSonarrQualityDefinitions({
        ...opts,
        portable: data as unknown as PortableQualityDefinitions,
      });
    case 'lidarr_quality_definitions':
      return _deserializeDependencies.deserializeLidarrQualityDefinitions({
        ...opts,
        portable: data as unknown as PortableLidarrQualityDefinitions,
      });
    case 'lidarr_metadata_profile':
      return _deserializeDependencies.deserializeLidarrMetadataProfile({
        ...opts,
        portable: data as unknown as PortableLidarrMetadataProfile,
      });
  }

  const exhaustiveCheck: never = entityType;
  throw new Error(`Unsupported entity type: ${exhaustiveCheck}`);
}

function validateLidarrPayload(entityType: EntityType, data: Record<string, unknown>): string | null {
  if (entityType === 'lidarr_metadata_profile') {
    const requiredFields = ['name', 'description', 'primaryTypes', 'secondaryTypes', 'releaseStatuses'];
    const missingRequiredFields = requiredFields.filter((field) => !Object.hasOwn(data, field));
    if (missingRequiredFields.length > 0) {
      return `Unsupported payload for lidarr_metadata_profile: missing required fields: ${missingRequiredFields.join(', ')}`;
    }

    const unsupportedFields = Object.keys(data)
      .filter((field) => !requiredFields.includes(field))
      .sort((a, b) => a.localeCompare(b));
    if (unsupportedFields.length > 0) {
      return `Unsupported payload for lidarr_metadata_profile: unsupported fields: ${unsupportedFields.join(', ')}`;
    }
  }

  const matrixEntry = getLidarrMediaManagementPortableEntry(entityType);
  if (!matrixEntry) {
    return null;
  }

  const mixedFields = (matrixEntry.forbiddenFields ?? [])
    .filter((field) => Object.hasOwn(data, field))
    .sort((a, b) => a.localeCompare(b));
  if (mixedFields.length > 0) {
    return `Mixed payload for ${entityType}: unsupported fields from another model: ${mixedFields.join(', ')}`;
  }

  const missingRequiredFields = matrixEntry.requiredFields.filter((field) => !Object.hasOwn(data, field));
  if (missingRequiredFields.length > 0) {
    return `Unsupported payload for ${entityType}: missing required fields: ${missingRequiredFields.join(', ')}`;
  }

  const allowedFields = new Set(matrixEntry.requiredFields);
  const unsupportedFields = Object.keys(data)
    .filter((field) => !allowedFields.has(field))
    .sort((a, b) => a.localeCompare(b));
  if (unsupportedFields.length > 0) {
    return `Unsupported payload for ${entityType}: unsupported fields: ${unsupportedFields.join(', ')}`;
  }

  return null;
}

function isValidationError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('already exists') ||
    message.includes('unsupported') ||
    message.includes('required') ||
    message.includes('invalid') ||
    message.includes('missing') ||
    message.includes('must') ||
    message.includes('cannot')
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Import failed';
}
