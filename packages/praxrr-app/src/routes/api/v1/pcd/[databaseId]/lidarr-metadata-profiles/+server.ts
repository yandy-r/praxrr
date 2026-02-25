import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { canWriteToBase, parseOperationLayer, pcdManager, type OperationLayer, type PCDCache } from '$pcd/index.ts';
import type { LidarrMetadataProfileListItem } from '$shared/pcd/display.ts';
import type { PortableMetadataProfileType } from '$shared/pcd/portable.ts';
import * as metadataProfiles from '$pcd/entities/metadataProfiles/index.ts';

interface ProfileTypeInput {
  id: number;
  name: string;
  allowed: boolean;
}

interface MetadataProfileRow {
  id: number;
  name: string;
  description: string | null;
  primaryAlbumTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  secondaryAlbumTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  releaseStatuses: Array<{ statusId: number; name: string; allowed: boolean }>;
}

interface CreateMetadataProfileRequest {
  layer: OperationLayer;
  name: string;
  description: string | null;
  primaryTypes: ProfileTypeInput[];
  secondaryTypes: ProfileTypeInput[];
  releaseStatuses: ProfileTypeInput[];
}

const POSITIVE_INTEGER_ID = /^\d+$/;
const RESERVED_METADATA_PROFILE_NAME = 'none';
const MIN_SELECTION_ERROR = 'Each metadata profile section must include at least one allowed entry';
const LIDARR_METADATA_PROFILE_SCHEMA_ERROR = 'This database does not expose Lidarr metadata profile tables';

const LIDARR_TABLE_QUERY_ERRORS = [
  'no such table: lidarr_metadata_profiles',
  'no such table: lidarr_metadata_profile_primary_types',
  'no such table: lidarr_metadata_profile_secondary_types',
  'no such table: lidarr_metadata_profile_release_statuses',
];

function parseDatabaseId(rawId: string | undefined): { value: number } | { error: string } {
  if (!rawId) {
    return { error: 'Missing databaseId' };
  }

  if (!POSITIVE_INTEGER_ID.test(rawId)) {
    return { error: 'Invalid databaseId' };
  }

  const databaseId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(databaseId) || databaseId <= 0) {
    return { error: 'Invalid databaseId' };
  }

  return { value: databaseId };
}

function getDatabase(databaseId: number): { value: PCDCache } | { error: string; status: number } {
  const database = pcdManager.getById(databaseId);
  if (!database) {
    return { error: 'Database not found', status: 404 };
  }

  const cache = pcdManager.getCache(databaseId);
  if (!cache) {
    return { error: 'Database cache not available', status: 500 };
  }

  return { value: cache };
}

function isLidarrMetadataProfileSchemaError(message: string): boolean {
  return LIDARR_TABLE_QUERY_ERRORS.some((fragment) => message.includes(fragment));
}

async function validateLidarrMetadataProfileSupport(database: PCDCache): Promise<boolean> {
  try {
    await database.kb.selectFrom('lidarr_metadata_profiles').select('id').limit(1).executeTakeFirst();

    await database.kb
      .selectFrom('lidarr_metadata_profile_primary_types')
      .select('metadata_profile_name')
      .limit(1)
      .executeTakeFirst();

    await database.kb
      .selectFrom('lidarr_metadata_profile_secondary_types')
      .select('metadata_profile_name')
      .limit(1)
      .executeTakeFirst();

    await database.kb
      .selectFrom('lidarr_metadata_profile_release_statuses')
      .select('metadata_profile_name')
      .limit(1)
      .executeTakeFirst();

    return true;
  } catch (error) {
    if (error instanceof Error && isLidarrMetadataProfileSchemaError(error.message)) {
      return false;
    }
    throw error;
  }
}

function parseMetadataTypeArray(raw: unknown, fieldName: string): { value: ProfileTypeInput[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: `${fieldName} must be an array` };
  }

  const rows: ProfileTypeInput[] = [];

  for (const rawRow of raw) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      return { error: `${fieldName} must contain objects` };
    }

    const row = rawRow as Record<string, unknown>;
    const id = typeof row.id === 'number' && Number.isInteger(row.id) ? row.id : null;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const allowed = typeof row.allowed === 'boolean' ? row.allowed : null;

    if (id === null) {
      return { error: `${fieldName} entries require an integer id` };
    }

    if (!name) {
      return { error: `${fieldName} entries require a name` };
    }

    if (allowed === null) {
      return { error: `${fieldName} entries require a boolean allowed field` };
    }

    rows.push({ id, name, allowed });
  }

  return { value: rows };
}

function validateCreatePayload(body: unknown): { value: CreateMetadataProfileRequest } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid request body' };
  }

  const root = body as Record<string, unknown>;
  const name = typeof root.name === 'string' ? root.name.trim() : '';
  if (!name) {
    return { error: 'Profile name is required' };
  }

  if (name.toLowerCase() === RESERVED_METADATA_PROFILE_NAME) {
    return { error: `'None' is a reserved profile name` };
  }

  const description =
    root.description === undefined || root.description === null
      ? null
      : typeof root.description === 'string'
        ? root.description.trim() || null
        : null;
  if (root.description !== undefined && root.description !== null && typeof root.description !== 'string') {
    return { error: 'Description must be a string or null' };
  }

  const layerResult = parseOperationLayer(root.layer);
  if ('error' in layerResult) {
    return { error: layerResult.error };
  }

  const primaryTypesResult = parseMetadataTypeArray(root.primaryTypes, 'primaryTypes');
  if ('error' in primaryTypesResult) {
    return { error: primaryTypesResult.error };
  }

  const secondaryTypesResult = parseMetadataTypeArray(root.secondaryTypes, 'secondaryTypes');
  if ('error' in secondaryTypesResult) {
    return { error: secondaryTypesResult.error };
  }

  const releaseStatusesResult = parseMetadataTypeArray(root.releaseStatuses, 'releaseStatuses');
  if ('error' in releaseStatusesResult) {
    return { error: releaseStatusesResult.error };
  }

  const hasPrimaryAllowed = primaryTypesResult.value.some((entry) => entry.allowed);
  const hasSecondaryAllowed = secondaryTypesResult.value.some((entry) => entry.allowed);
  const hasReleaseStatusAllowed = releaseStatusesResult.value.some((entry) => entry.allowed);

  if (!hasPrimaryAllowed || !hasSecondaryAllowed || !hasReleaseStatusAllowed) {
    return { error: MIN_SELECTION_ERROR };
  }

  return {
    value: {
      layer: layerResult.value,
      name,
      description,
      primaryTypes: primaryTypesResult.value,
      secondaryTypes: secondaryTypesResult.value,
      releaseStatuses: releaseStatusesResult.value,
    },
  };
}

function toPortableTypeRows(types: ProfileTypeInput[]): Array<PortableMetadataProfileType> {
  return types.map((type) => ({
    id: type.id,
    name: type.name,
    allowed: type.allowed,
  }));
}

function toMetadataProfileListItemRows(
  profiles: MetadataProfileRow[],
  metadataById: Map<number, string>
): LidarrMetadataProfileListItem[] {
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    updated_at: metadataById.get(profile.id) ?? '',
    primaryTypeCount: profile.primaryAlbumTypes.length,
    secondaryTypeCount: profile.secondaryAlbumTypes.length,
    releaseStatusCount: profile.releaseStatuses.length,
    primaryAllowedCount: profile.primaryAlbumTypes.filter((entry) => entry.allowed).length,
    secondaryAllowedCount: profile.secondaryAlbumTypes.filter((entry) => entry.allowed).length,
    releaseStatusAllowedCount: profile.releaseStatuses.filter((entry) => entry.allowed).length,
  }));
}

function getWriteErrorStatus(message: string): number {
  if (isLidarrMetadataProfileSchemaError(message)) {
    return 400;
  }

  if (message.includes('Database instance not found') || message.includes('not found')) {
    return 404;
  }

  if (
    message.includes('cannot write to base') ||
    message.includes('Cannot write to base layer') ||
    message.includes('Base layer requires')
  ) {
    return 403;
  }

  if (
    message.includes('already exists') ||
    message.includes('reserved') ||
    message.includes('required') ||
    message.includes('No allowed') ||
    message.includes('Validation failed')
  ) {
    return 400;
  }

  return 500;
}

export const GET: RequestHandler = async ({ params }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId);
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const database = getDatabase(databaseIdResult.value);
  if ('error' in database) {
    return json({ error: database.error }, { status: database.status });
  }

  try {
    const isSupported = await validateLidarrMetadataProfileSupport(database.value);
    if (!isSupported) {
      return json({ error: LIDARR_METADATA_PROFILE_SCHEMA_ERROR }, { status: 400 });
    }

    const profiles = await metadataProfiles.list(database.value);
    if (profiles.length === 0) {
      return json([]);
    }

    const metadataProfileRows = await database.value.kb
      .selectFrom('lidarr_metadata_profiles')
      .select(['id', 'updated_at'])
      .where(
        'id',
        'in',
        profiles.map((profile) => profile.id)
      )
      .execute();

    const updatedAtById = new Map<number, string>(metadataProfileRows.map((row) => [row.id, row.updated_at]));

    return json(toMetadataProfileListItemRows(profiles, updatedAtById));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list metadata profiles';
    const status = isLidarrMetadataProfileSchemaError(message) ? 400 : 500;
    return json({ error: message }, { status });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId);
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const database = getDatabase(databaseIdResult.value);
  if ('error' in database) {
    return json({ error: database.error }, { status: database.status });
  }

  let payload: CreateMetadataProfileRequest;
  const isSupported = await validateLidarrMetadataProfileSupport(database.value);
  if (!isSupported) {
    return json({ error: LIDARR_METADATA_PROFILE_SCHEMA_ERROR }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const result = validateCreatePayload(body);
  if ('error' in result) {
    return json({ error: result.error }, { status: 400 });
  }
  payload = result.value;

  if (payload.layer === 'base' && !canWriteToBase(databaseIdResult.value)) {
    return json({ error: 'Cannot write to base layer without personal access token' }, { status: 403 });
  }

  try {
    const result = await metadataProfiles.create({
      databaseId: databaseIdResult.value,
      cache: database.value,
      layer: payload.layer,
      input: {
        name: payload.name,
        description: payload.description,
        primaryAlbumTypes: toPortableTypeRows(payload.primaryTypes).map((type) => ({
          typeId: type.id,
          name: type.name,
          allowed: type.allowed,
        })),
        secondaryAlbumTypes: toPortableTypeRows(payload.secondaryTypes).map((type) => ({
          typeId: type.id,
          name: type.name,
          allowed: type.allowed,
        })),
        releaseStatuses: toPortableTypeRows(payload.releaseStatuses).map((type) => ({
          statusId: type.id,
          name: type.name,
          allowed: type.allowed,
        })),
      },
    });

    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Create failed';
    const status = getWriteErrorStatus(message);
    return json({ error: message }, { status });
  }
};
