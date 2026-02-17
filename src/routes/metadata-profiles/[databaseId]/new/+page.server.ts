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
			mergeById(
				profiles.flatMap((profile) =>
					profile.primaryAlbumTypes.map((entry) => ({
						id: entry.typeId,
						name: entry.name,
						allowed: entry.allowed
					}))
				)
			)
		),
		secondaryTypes: ensureAtLeastOneAllowed(
			mergeById(
				profiles.flatMap((profile) =>
					profile.secondaryAlbumTypes.map((entry) => ({
						id: entry.typeId,
						name: entry.name,
						allowed: entry.allowed
					}))
				)
			)
		),
		releaseStatuses: ensureAtLeastOneAllowed(
			mergeById(
				profiles.flatMap((profile) =>
					profile.releaseStatuses.map((entry) => ({
						id: entry.statusId,
						name: entry.name,
						allowed: entry.allowed
					}))
				)
			)
		)
	};

	return {
		currentDatabase,
		canWriteToBase: canWriteToBase(currentDatabaseId),
		initialData
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
			secondaryTypes = parseMetadataTypes(
				formData.get('secondaryTypes') as string | null,
				'secondaryTypes'
			);
			releaseStatuses = parseMetadataTypes(formData.get('releaseStatuses') as string | null, 'releaseStatuses');
		} catch (err) {
			return fail(400, { error: err instanceof Error ? err.message : 'Invalid profile section data' });
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
					releaseStatuses
				})
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => null);
				return fail(response.status, { error: toResponseError(payload) });
			}

			if (cache) {
				await cache.kb.destroy();
			}

			return redirect(303, `/metadata-profiles/${currentDatabaseId}`);
		} catch (err) {
			return fail(500, {
				error: err instanceof Error ? err.message : 'Failed to create metadata profile'
			});
		}
	}
};
