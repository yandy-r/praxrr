import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { canWriteToBase, pcdManager, type OperationLayer, type PCDCache } from '$pcd/index.ts';
import type { LidarrMetadataProfileListItem } from '$shared/pcd/display.ts';
import type { PortableMetadataProfileType } from '$shared/pcd/portable.ts';
import * as metadataProfiles from '$pcd/entities/metadataProfiles/index.ts';

interface ProfileTypeInput {
  id: number;
  name: string;
  allowed: boolean;
}

interface CreateMetadataProfileRequest {
  layer: OperationLayer;
  name: string;
  description: string | null;
  primaryTypes: ProfileTypeInput[];
  secondaryTypes: ProfileTypeInput[];
  releaseStatuses: ProfileTypeInput[];
}

const VALID_LAYERS: ReadonlySet<OperationLayer> = new Set(['user', 'base']);
const POSITIVE_INTEGER_ID = /^\d+$/;
const RESERVED_METADATA_PROFILE_NAME = 'none';

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

function parseLayer(rawLayer: unknown): { value: OperationLayer } | { error: string } {
  if (!rawLayer) {
    return { value: 'user' };
  }

  if (typeof rawLayer !== 'string' || !VALID_LAYERS.has(rawLayer as OperationLayer)) {
    return { error: 'Invalid layer' };
  }

  return { value: rawLayer as OperationLayer };
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

function parsePortableMetadataTypeArray(
  raw: unknown,
  fieldName: string
): { value: ProfileTypeInput[] } | { error: string } {
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

function validateCreatePayload(body: unknown):
  | {
      value: CreateMetadataProfileRequest;
    }
  | {
      error: string;
    } {
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
        ? root.description.trim()
        : null;
  if (root.description !== undefined && root.description !== null && typeof root.description !== 'string') {
    return { error: 'Description must be a string or null' };
  }

  const layerResult = parseLayer(root.layer);
  if ('error' in layerResult) {
    return { error: layerResult.error };
  }

  const primaryTypesResult = parsePortableMetadataTypeArray(root.primaryTypes, 'primaryTypes');
  if ('error' in primaryTypesResult) {
    return { error: primaryTypesResult.error };
  }

  const secondaryTypesResult = parsePortableMetadataTypeArray(root.secondaryTypes, 'secondaryTypes');
  if ('error' in secondaryTypesResult) {
    return { error: secondaryTypesResult.error };
  }

  const releaseStatusesResult = parsePortableMetadataTypeArray(root.releaseStatuses, 'releaseStatuses');
  if ('error' in releaseStatusesResult) {
    return { error: releaseStatusesResult.error };
  }

  const hasPrimaryAllowed = primaryTypesResult.value.some((entry) => entry.allowed);
  const hasSecondaryAllowed = secondaryTypesResult.value.some((entry) => entry.allowed);
  const hasReleaseStatusAllowed = releaseStatusesResult.value.some((entry) => entry.allowed);

  if (!hasPrimaryAllowed || !hasSecondaryAllowed || !hasReleaseStatusAllowed) {
    return { error: 'Each metadata profile section must include at least one allowed entry' };
  }

  const value: CreateMetadataProfileRequest = {
    layer: layerResult.value,
    name,
    description,
    primaryTypes: primaryTypesResult.value,
    secondaryTypes: secondaryTypesResult.value,
    releaseStatuses: releaseStatusesResult.value,
  };

  return { value };
}

function toPortableTypeRows(types: ProfileTypeInput[]): Array<PortableMetadataProfileType> {
  return types.map((type) => ({
    id: type.id,
    name: type.name,
    allowed: type.allowed,
  }));
}

function toMetadataProfileListItemRows(
  profiles: Array<{
    id: number;
    name: string;
    description: string | null;
    primaryAlbumTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
    secondaryAlbumTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
    releaseStatuses: Array<{ statusId: number; name: string; allowed: boolean }>;
  }>,
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
  if (message.includes('Database instance not found') || message.includes('not found')) {
    return 404;
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

  if (message.includes('Base layer requires')) {
    return 403;
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
    const profiles = await metadataProfiles.list(database.value);
    if (profiles.length === 0) {
      return json([]);
    }

    const profileRows = await database.value.kb
      .selectFrom('lidarr_metadata_profiles')
      .select(['id', 'updated_at'])
      .where(
        'id',
        'in',
        profiles.map((profile) => profile.id)
      )
      .execute();

    const metadataById = new Map(profileRows.map((row) => [row.id, row.updated_at]));

    return json(toMetadataProfileListItemRows(profiles, metadataById));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list metadata profiles';
    return json({ error: message }, { status: message.includes('not found') ? 404 : 500 });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId);
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const databaseId = databaseIdResult.value;
  const database = getDatabase(databaseId);
  if ('error' in database) {
    return json({ error: database.error }, { status: database.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payloadResult = validateCreatePayload(body);
  if ('error' in payloadResult) {
    return json({ error: payloadResult.error }, { status: 400 });
  }

  if (payloadResult.value.layer === 'base' && !canWriteToBase(databaseId)) {
    return json({ error: 'Cannot write to base layer without personal access token' }, { status: 403 });
  }

  try {
    const result = await metadataProfiles.create({
      databaseId,
      cache: database.value,
      layer: payloadResult.value.layer,
      input: {
        name: payloadResult.value.name,
        description: payloadResult.value.description,
        primaryAlbumTypes: toPortableTypeRows(payloadResult.value.primaryTypes).map((type) => ({
          typeId: type.id,
          name: type.name,
          allowed: type.allowed,
        })),
        secondaryAlbumTypes: toPortableTypeRows(payloadResult.value.secondaryTypes).map((type) => ({
          typeId: type.id,
          name: type.name,
          allowed: type.allowed,
        })),
        releaseStatuses: payloadResult.value.releaseStatuses.map((type) => ({
          statusId: type.id,
          name: type.name,
          allowed: type.allowed,
        })),
      },
    });

    if (!result.success) {
      const message = result.error ?? 'Failed to create metadata profile';
      return json({ error: message }, { status: getWriteErrorStatus(message) });
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create metadata profile';
    return json({ error: message }, { status: 500 });
  }
};
