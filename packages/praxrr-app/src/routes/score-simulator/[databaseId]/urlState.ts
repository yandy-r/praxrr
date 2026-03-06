const VALID_MEDIA_TYPES = new Set(['movie', 'series'] as const);
const VALID_ARR_TYPES = new Set(['radarr', 'sonarr'] as const);
const MAX_SHARE_URL_LENGTH = 2000;

type MediaType = 'movie' | 'series';
type ArrType = 'radarr' | 'sonarr';
type ScoreOverrideMap = Record<string, number>;

export interface SimulatorUrlState {
	title?: string;
	mediaType?: MediaType;
	profile?: string;
	compare?: string;
	arrType?: ArrType;
	batch?: string[];
	batchMediaType?: MediaType;
	overrides?: ScoreOverrideMap;
}

function getNonEmptyParam(searchParams: URLSearchParams, key: string): string | undefined {
	const value = searchParams.get(key);
	if (!value) {
		return undefined;
	}

	return value.trim().length > 0 ? value : undefined;
}

function decodeBatchParam(encoded: string | undefined): string[] | undefined {
	if (!encoded) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(atob(encoded));
		if (!Array.isArray(parsed)) {
			return undefined;
		}

		const batch = parsed
			.filter((item): item is string => typeof item === 'string')
			.filter((item) => item.trim().length > 0);

		return batch.length > 0 ? batch : undefined;
	} catch {
		return undefined;
	}
}

function decodeOverridesParam(encoded: string | undefined): ScoreOverrideMap | undefined {
	if (!encoded) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(atob(encoded));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return undefined;
		}

		const normalized: ScoreOverrideMap = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (key.length === 0 || typeof value !== 'number' || !Number.isFinite(value)) {
				continue;
			}

			normalized[key] = Math.round(value);
		}

		if (Object.keys(normalized).length === 0) {
			return undefined;
		}

		return normalized;
	} catch {
		return undefined;
	}
}

function validateMediaType(value: string | undefined): MediaType | undefined {
	if (!value) {
		return undefined;
	}

	return VALID_MEDIA_TYPES.has(value as MediaType) ? (value as MediaType) : undefined;
}

function validateArrType(value: string | undefined): ArrType | undefined {
	if (!value) {
		return undefined;
	}

	return VALID_ARR_TYPES.has(value as ArrType) ? (value as ArrType) : undefined;
}

function createUrl(baseUrl: string, searchParams: URLSearchParams): string {
	try {
		const base =
			typeof window !== 'undefined' && window.location?.origin
				? new URL(baseUrl, window.location.origin)
				: new URL(baseUrl);
		base.search = searchParams.toString();
		return base.toString();
	} catch {
		const query = searchParams.toString();
		if (!query) {
			return baseUrl;
		}

		const separator = baseUrl.includes('?') ? '&' : '?';
		return `${baseUrl}${separator}${query}`;
	}
}

function copyWithExecCommand(text: string): boolean {
	const textArea = document.createElement('textarea');
	textArea.value = text;
	textArea.setAttribute('readonly', '');
	textArea.style.position = 'fixed';
	textArea.style.top = '-9999px';
	textArea.style.left = '-9999px';
	document.body.appendChild(textArea);
	textArea.select();
	textArea.setSelectionRange(0, textArea.value.length);

	const copied = document.execCommand('copy');
	document.body.removeChild(textArea);
	return copied;
}

export function parseUrlState(searchParams: URLSearchParams): SimulatorUrlState {
	return {
		title: getNonEmptyParam(searchParams, 'title'),
		mediaType: validateMediaType(getNonEmptyParam(searchParams, 'mediaType')),
		profile: getNonEmptyParam(searchParams, 'profile'),
		compare: getNonEmptyParam(searchParams, 'compare'),
		arrType: validateArrType(getNonEmptyParam(searchParams, 'arrType')),
		batch: decodeBatchParam(getNonEmptyParam(searchParams, 'batch')),
		batchMediaType: validateMediaType(getNonEmptyParam(searchParams, 'batchMediaType')),
		overrides: decodeOverridesParam(getNonEmptyParam(searchParams, 'overrides')),
	};
}

export function serializeUrlState(state: SimulatorUrlState): URLSearchParams {
	const searchParams = new URLSearchParams();
	const setStringParam = (key: string, value: string | undefined): void => {
		if (value && value.trim().length > 0) {
			searchParams.set(key, value);
		}
	};

	setStringParam('title', state.title);
	setStringParam('mediaType', state.mediaType);
	setStringParam('profile', state.profile);
	setStringParam('compare', state.compare);
	setStringParam('arrType', state.arrType);
	setStringParam('batchMediaType', state.batchMediaType);

	if (state.batch && state.batch.length > 0) {
		searchParams.set('batch', btoa(JSON.stringify(state.batch)));
	}

	if (state.overrides && Object.keys(state.overrides).length > 0) {
		searchParams.set('overrides', btoa(JSON.stringify(state.overrides)));
	}

	return searchParams;
}

export async function copyShareLink(
	state: SimulatorUrlState,
	baseUrl: string
): Promise<{ success: boolean; truncated: boolean }> {
	let truncated = false;
	let serializedState = { ...state };
	let searchParams = serializeUrlState(serializedState);
	let fullUrl = createUrl(baseUrl, searchParams);

	if (fullUrl.length > MAX_SHARE_URL_LENGTH) {
		if (serializedState.overrides && Object.keys(serializedState.overrides).length > 0) {
			serializedState = { ...serializedState, overrides: undefined };
			truncated = true;
			searchParams = serializeUrlState(serializedState);
			fullUrl = createUrl(baseUrl, searchParams);
		}

		if (fullUrl.length > MAX_SHARE_URL_LENGTH && serializedState.batch && serializedState.batch.length > 0) {
			serializedState = { ...serializedState, batch: undefined };
			truncated = true;
			searchParams = serializeUrlState(serializedState);
			fullUrl = createUrl(baseUrl, searchParams);
		}
	}

	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(fullUrl);
			return { success: true, truncated };
		}
	} catch {
		// Fall through to execCommand fallback.
	}

	try {
		if (typeof document === 'undefined' || !document.body) {
			return { success: false, truncated };
		}

		const copied = copyWithExecCommand(fullUrl);
		return { success: copied, truncated };
	} catch {
		return { success: false, truncated };
	}
}
