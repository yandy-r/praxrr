import { error, fail, redirect } from '@sveltejs/kit';
import type { ServerLoad, Actions } from '@sveltejs/kit';
import { canWriteToBase, pcdManager } from '$pcd/index.ts';
import * as metadataProfileQueries from '$pcd/entities/metadataProfiles/index.ts';

interface MetadataProfileFormType {
  id: number;
  name: string;
  allowed: boolean;
}

interface MetadataProfileFormData {
  name: string;
  description: string;
  primaryTypes: MetadataProfileFormType[];
  secondaryTypes: MetadataProfileFormType[];
  releaseStatuses: MetadataProfileFormType[];
}

const DEFAULT_PRIMARY_TYPES: MetadataProfileFormType[] = [
  { id: 0, name: 'Album', allowed: true },
  { id: 1, name: 'EP', allowed: false },
  { id: 2, name: 'Single', allowed: false },
  { id: 3, name: 'Broadcast', allowed: false },
  { id: 4, name: 'Other', allowed: false },
];

const DEFAULT_SECONDARY_TYPES: MetadataProfileFormType[] = [
  { id: 0, name: 'Studio', allowed: true },
  { id: 1, name: 'Compilation', allowed: false },
  { id: 2, name: 'Soundtrack', allowed: false },
  { id: 3, name: 'Spokenword', allowed: false },
  { id: 4, name: 'Interview', allowed: false },
  { id: 6, name: 'Live', allowed: false },
  { id: 7, name: 'Remix', allowed: false },
  { id: 8, name: 'DJ-mix', allowed: false },
  { id: 9, name: 'Mixtape/Street', allowed: false },
  { id: 10, name: 'Demo', allowed: false },
  { id: 11, name: 'Audio drama', allowed: false },
];

const DEFAULT_RELEASE_STATUSES: MetadataProfileFormType[] = [
  { id: 0, name: 'Official', allowed: true },
  { id: 1, name: 'Promotion', allowed: false },
  { id: 2, name: 'Bootleg', allowed: false },
  { id: 3, name: 'Pseudo-Release', allowed: false },
];

function mergeById<T extends MetadataProfileFormType>(rows: T[]): T[] {
  const map = new Map<number, T>();

  for (const row of rows) {
    if (map.has(row.id)) {
      continue;
    }

    map.set(row.id, row);
  }

  return [...map.values()];
}

function ensureAtLeastOneAllowed<T extends MetadataProfileFormType>(rows: T[]): T[] {
  if (rows.length === 0) {
    return rows;
  }

  if (rows.some((row) => row.allowed)) {
    return rows;
  }

  return rows.map((row, index) => ({ ...row, allowed: index === 0 }));
}

function fallbackSectionRows(
  rows: MetadataProfileFormType[],
  defaultRows: MetadataProfileFormType[]
): MetadataProfileFormType[] {
  const rowsById = new Map<number, MetadataProfileFormType>();
  const defaultIds = new Set<number>(defaultRows.map((row) => row.id));

  for (const row of rows) {
    if (!rowsById.has(row.id)) {
      rowsById.set(row.id, row);
    }
  }

  const merged = defaultRows.map((defaultRow) => {
    const existingRow = rowsById.get(defaultRow.id);
    if (!existingRow) {
      return defaultRow;
    }

    return {
      id: existingRow.id,
      name: existingRow.name.trim() ? existingRow.name : defaultRow.name,
      allowed: existingRow.allowed,
    };
  });

  for (const row of rowsById.values()) {
    if (!defaultIds.has(row.id)) {
      merged.push(row);
    }
  }

  return merged.sort((a, b) => a.id - b.id);
}

function toResponseError(errorValue: unknown): string {
  if (errorValue && typeof errorValue === 'object' && 'error' in errorValue) {
    const candidate = (errorValue as { error?: unknown }).error;
    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return 'Validation failed';
}

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
    if (typeof typed.id !== 'number' || !Number.isInteger(typed.id)) {
      throw new Error(`${fieldName}[${index}] id must be an integer`);
    }
    const name = typeof typed.name === 'string' ? typed.name.trim() : '';
    const allowed = typeof typed.allowed === 'boolean' ? typed.allowed : null;

    const id = typed.id;

    if (name.length === 0) {
      throw new Error(`${fieldName}[${index}] name is required`);
    }

    if (allowed === null) {
      throw new Error(`${fieldName}[${index}] allowed must be true or false`);
    }

    return { id, name, allowed };
  });
}

const RESERVED_METADATA_PROFILE_NAME = 'none';

function validateSectionSelection(rows: MetadataProfileFormType[], sectionName: string): string | null {
  if (!rows.some((entry) => entry.allowed)) {
    return `At least one ${sectionName} option must be allowed`;
  }

  return null;
}

export const load: ServerLoad = async ({ params }) => {
  const { databaseId } = params;

  if (!databaseId) {
    throw error(400, 'Missing database ID');
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

  const profiles = await metadataProfileQueries.list(cache);

  const initialData: MetadataProfileFormData = {
    name: '',
    description: '',
    primaryTypes: ensureAtLeastOneAllowed(
      fallbackSectionRows(
        mergeById(
          profiles.flatMap((profile) =>
            profile.primaryAlbumTypes.map((entry) => ({
              id: entry.typeId,
              name: entry.name,
              allowed: entry.allowed,
            }))
          )
        ),
        DEFAULT_PRIMARY_TYPES
      )
    ),
    secondaryTypes: ensureAtLeastOneAllowed(
      fallbackSectionRows(
        mergeById(
          profiles.flatMap((profile) =>
            profile.secondaryAlbumTypes.map((entry) => ({
              id: entry.typeId,
              name: entry.name,
              allowed: entry.allowed,
            }))
          )
        ),
        DEFAULT_SECONDARY_TYPES
      )
    ),
    releaseStatuses: ensureAtLeastOneAllowed(
      fallbackSectionRows(
        mergeById(
          profiles.flatMap((profile) =>
            profile.releaseStatuses.map((entry) => ({
              id: entry.statusId,
              name: entry.name,
              allowed: entry.allowed,
            }))
          )
        ),
        DEFAULT_RELEASE_STATUSES
      )
    ),
  };

  return {
    currentDatabase,
    canWriteToBase: canWriteToBase(currentDatabaseId),
    initialData,
  };
};

export const actions: Actions = {
  default: async ({ params, request, fetch }) => {
    const { databaseId } = params;

    if (!databaseId) {
      return fail(400, { error: 'Missing database ID' });
    }

    const currentDatabaseId = parseInt(databaseId, 10);
    if (isNaN(currentDatabaseId)) {
      return fail(400, { error: 'Invalid database ID' });
    }

    if (!pcdManager.getById(currentDatabaseId)) {
      return fail(404, { error: 'Database not found' });
    }

    const cache = pcdManager.getCache(currentDatabaseId);
    if (!cache) {
      return fail(500, { error: 'Database cache not available' });
    }

    const formData = await request.formData();
    const name = (formData.get('name') as string | null)?.trim() ?? '';
    const description = (formData.get('description') as string | null)?.trim() ?? '';
    const layer = (formData.get('layer') as 'user' | 'base' | null) ?? 'user';

    if (!name) {
      return fail(400, { error: 'Profile name is required' });
    }

    let primaryTypes: MetadataProfileFormType[];
    let secondaryTypes: MetadataProfileFormType[];
    let releaseStatuses: MetadataProfileFormType[];

    try {
      primaryTypes = parseMetadataTypes(formData.get('primaryTypes') as string | null, 'primaryTypes');
      secondaryTypes = parseMetadataTypes(formData.get('secondaryTypes') as string | null, 'secondaryTypes');
      releaseStatuses = parseMetadataTypes(formData.get('releaseStatuses') as string | null, 'releaseStatuses');
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : 'Invalid profile section data' });
    }

    const primaryValidation = validateSectionSelection(primaryTypes, 'primary');
    if (primaryValidation) {
      return fail(400, { error: primaryValidation });
    }

    const secondaryValidation = validateSectionSelection(secondaryTypes, 'secondary');
    if (secondaryValidation) {
      return fail(400, { error: secondaryValidation });
    }

    const releaseValidation = validateSectionSelection(releaseStatuses, 'release status');
    if (releaseValidation) {
      return fail(400, { error: releaseValidation });
    }

    if (name.toLowerCase() === RESERVED_METADATA_PROFILE_NAME) {
      return fail(400, { error: `'None' is a reserved profile name` });
    }

    if (layer === 'base' && !canWriteToBase(currentDatabaseId)) {
      return fail(403, { error: 'Cannot write to base layer without personal access token' });
    }

    try {
      const response = await fetch(`/api/v1/pcd/${currentDatabaseId}/lidarr-metadata-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layer,
          name,
          description: description.length > 0 ? description : null,
          primaryTypes,
          secondaryTypes,
          releaseStatuses,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        return fail(response.status, { error: toResponseError(payload) });
      }

      return redirect(303, `/metadata-profiles/${currentDatabaseId}`);
    } catch (err) {
      return fail(500, {
        error: err instanceof Error ? err.message : 'Failed to create metadata profile',
      });
    }
  },
};
