import { error, fail, redirect } from '@sveltejs/kit';
import type { ServerLoad, Actions } from '@sveltejs/kit';
import { canWriteToBase, pcdManager } from '$pcd/index.ts';
import * as metadataProfileQueries from '$pcd/entities/metadataProfiles/index.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';

interface MetadataProfileFormType {
  id: number;
  name: string;
  allowed: boolean;
}

type MetadataProfileSummary = Awaited<ReturnType<typeof metadataProfileQueries.list>>[number];

interface ParsedPayload {
  layer: 'user' | 'base';
  name: string;
  description: string | null;
  primaryTypes: MetadataProfileFormType[];
  secondaryTypes: MetadataProfileFormType[];
  releaseStatuses: MetadataProfileFormType[];
}

interface ParsedPayloadError {
  error: string;
  status: number;
}

const RESERVED_METADATA_PROFILE_NAME = 'none';

function parseMetadataTypes(raw: string | null, fieldName: string): MetadataProfileFormType[] {
  if (!raw) {
    throw new Error(`Missing ${fieldName}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${fieldName} must contain valid JSON`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be an array`);
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }

    const typed = entry as Record<string, unknown>;
    const id = typeof typed.id === 'number' && Number.isInteger(typed.id) ? typed.id : null;
    const name = typeof typed.name === 'string' ? typed.name.trim() : '';
    const allowed = typeof typed.allowed === 'boolean' ? typed.allowed : null;

    if (id === null) {
      throw new Error(`${fieldName}[${index}] id must be an integer`);
    }

    if (name.length === 0) {
      throw new Error(`${fieldName}[${index}] name is required`);
    }

    if (allowed === null) {
      throw new Error(`${fieldName}[${index}] allowed must be true or false`);
    }

    return { id, name, allowed };
  });
}

function validateSectionSelection(rows: MetadataProfileFormType[], sectionName: string): string | null {
  if (!rows.some((entry) => entry.allowed)) {
    return `At least one ${sectionName} option must be allowed`;
  }

  return null;
}

function parsePayload(formData: FormData): { payload: ParsedPayload } | ParsedPayloadError {
  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const description = (formData.get('description') as string | null)?.trim() ?? null;
  const layer = (formData.get('layer') as 'user' | 'base' | null) ?? 'user';

  if (!name) {
    return { error: 'Profile name is required', status: 400 };
  }

  if (name.toLowerCase() === RESERVED_METADATA_PROFILE_NAME) {
    return { error: `'None' is a reserved profile name`, status: 400 };
  }

  let primaryTypes: MetadataProfileFormType[];
  let secondaryTypes: MetadataProfileFormType[];
  let releaseStatuses: MetadataProfileFormType[];

  try {
    primaryTypes = parseMetadataTypes(formData.get('primaryTypes') as string | null, 'primaryTypes');
    secondaryTypes = parseMetadataTypes(formData.get('secondaryTypes') as string | null, 'secondaryTypes');
    releaseStatuses = parseMetadataTypes(formData.get('releaseStatuses') as string | null, 'releaseStatuses');
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Invalid profile section data',
      status: 400,
    } as const;
  }

  const primaryValidation = validateSectionSelection(primaryTypes, 'primary');
  if (primaryValidation) {
    return { error: primaryValidation, status: 400 };
  }

  const secondaryValidation = validateSectionSelection(secondaryTypes, 'secondary');
  if (secondaryValidation) {
    return { error: secondaryValidation, status: 400 };
  }

  const releaseValidation = validateSectionSelection(releaseStatuses, 'release status');
  if (releaseValidation) {
    return { error: releaseValidation, status: 400 };
  }

  return {
    payload: {
      layer,
      name,
      description,
      primaryTypes,
      secondaryTypes,
      releaseStatuses,
    },
  };
}

function toResponseError(response: unknown): string {
  if (response && typeof response === 'object' && 'error' in response) {
    const candidate = (response as { error?: unknown }).error;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return 'Validation failed';
}

function getCurrentProfile(
  profiles: MetadataProfileSummary[],
  rawName: string | null
): MetadataProfileSummary | undefined {
  if (!rawName) {
    return undefined;
  }

  const targetName = decodeURIComponent(rawName);
  return profiles.find((profile) => profile.name === targetName);
}

export const load: ServerLoad = async ({ params }) => {
  const { databaseId, name } = params;

  if (!databaseId || !name) {
    throw error(400, 'Missing parameters');
  }

  const currentDatabaseId = parseInt(databaseId, 10);
  if (isNaN(currentDatabaseId)) {
    throw error(400, 'Invalid database ID');
  }

  const currentDatabase = pcdManager.getById(currentDatabaseId);
  if (!currentDatabase) {
    throw error(404, 'Database not found');
  }

  const cache = pcdManager.getCache(currentDatabaseId);
  if (!cache) {
    throw error(500, 'Database cache not available');
  }

  const metadataProfiles = await metadataProfileQueries.list(cache);
  const currentProfile = getCurrentProfile(metadataProfiles, name);

  if (!currentProfile) {
    throw error(404, 'Metadata profile not found');
  }

  return {
    currentDatabase,
    currentProfile: {
      name: currentProfile.name,
      description: currentProfile.description,
      primaryTypes: currentProfile.primaryAlbumTypes.map((entry) => ({
        id: entry.typeId,
        name: entry.name,
        allowed: entry.allowed,
      })),
      secondaryTypes: currentProfile.secondaryAlbumTypes.map((entry) => ({
        id: entry.typeId,
        name: entry.name,
        allowed: entry.allowed,
      })),
      releaseStatuses: currentProfile.releaseStatuses.map((entry) => ({
        id: entry.statusId,
        name: entry.name,
        allowed: entry.allowed,
      })),
    },
    canWriteToBase: canWriteToBase(currentDatabaseId),
  };
};

export const actions: Actions = {
  update: async ({ params, request, fetch }) => {
    const { databaseId, name: rawName } = params;

    if (!databaseId || !rawName) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const metadataProfiles = await metadataProfileQueries.list(cache);
    const currentProfile = getCurrentProfile(metadataProfiles, rawName);

    if (!currentProfile) {
      return fail(404, { error: 'Metadata profile not found' });
    }

    const formData = await request.formData();
    const parsed = parsePayload(formData);

    if ('error' in parsed) {
      return fail(parsed.status, { error: parsed.error });
    }

    if (parsed.payload.layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    let response: Response;
    try {
      response = await fetch(`/api/v1/pcd/${currentDatabaseId}/lidarr-metadata-profiles/${currentProfile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.payload),
      });
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : 'Failed to update metadata profile',
      });
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, { error: toResponseError(payload) });
    }

    if (parsed.payload.name !== currentProfile.name) {
      arrSyncQueries.updateMetadataProfileName(currentProfile.name, parsed.payload.name, {
        databaseId: currentDatabaseId,
      });
    }

    return redirect(303, `/metadata-profiles/${currentDatabaseId}/${encodeURIComponent(parsed.payload.name)}`);
  },

  delete: async ({ params, request, fetch }) => {
    const { databaseId, name: rawName } = params;

    if (!databaseId || !rawName) {
      return fail(400, { error: 'Missing parameters' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const metadataProfiles = await metadataProfileQueries.list(cache);
    const currentProfile = getCurrentProfile(metadataProfiles, rawName);

    if (!currentProfile) {
      return fail(404, { error: 'Metadata profile not found' });
    }

    const formData = await request.formData();
    const layer = (formData.get('layer') as 'user' | 'base' | null) ?? 'user';

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    let response: Response;
    try {
      response = await fetch(`/api/v1/pcd/${currentDatabaseId}/lidarr-metadata-profiles/${currentProfile.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layer, name: currentProfile.name }),
      });
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : 'Failed to delete metadata profile',
      });
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return fail(response.status, { error: toResponseError(payload) });
    }

    return redirect(303, `/metadata-profiles/${currentDatabaseId}`);
  },
};
