import type { ScoreOverrideMap } from './helpers.ts';

const VALID_MEDIA_TYPES = new Set(['movie', 'series'] as const);
const VALID_ARR_TYPES = new Set(['radarr', 'sonarr'] as const);
const MAX_SHARE_URL_LENGTH = 2000;

type MediaType = 'movie' | 'series';
type ArrType = 'radarr' | 'sonarr';

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
export type ShareLinkMode = 'full' | 'safe';

function getNonEmptyParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key);
  if (!value || value.length === 0) {
    return undefined;
  }

  return value;
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

function parseBatchParam(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(atob(value));
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      return undefined;
    }

    return parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseOverridesParam(value: string | undefined): ScoreOverrideMap | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(atob(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const normalized: ScoreOverrideMap = {};
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        continue;
      }

      normalized[key] = Math.round(rawValue);
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function createUrl(baseUrl: string, searchParams: URLSearchParams): string {
  const query = searchParams.toString();
  if (!query) {
    return baseUrl;
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${query}`;
}

function copyUsingExecCommand(text: string): boolean {
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
    batch: parseBatchParam(getNonEmptyParam(searchParams, 'batch')),
    batchMediaType: validateMediaType(getNonEmptyParam(searchParams, 'batchMediaType')),
    overrides: parseOverridesParam(getNonEmptyParam(searchParams, 'overrides')),
  };
}

export function serializeUrlState(state: SimulatorUrlState): URLSearchParams {
  const searchParams = new URLSearchParams();

  const setStringParam = (key: string, value: string | undefined): void => {
    if (value && value.length > 0) {
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

  if (state.overrides) {
    const normalizedOverrides: ScoreOverrideMap = {};
    for (const [key, rawValue] of Object.entries(state.overrides) as Array<[string, number]>) {
      if (!Number.isFinite(rawValue)) {
        continue;
      }

      normalizedOverrides[key] = Math.round(rawValue);
    }

    if (Object.keys(normalizedOverrides).length > 0) {
      searchParams.set('overrides', btoa(JSON.stringify(normalizedOverrides)));
    }
  }

  return searchParams;
}

export async function copyShareLink(
  state: SimulatorUrlState,
  baseUrl: string,
  options?: { mode?: ShareLinkMode }
): Promise<{ success: boolean; truncated: boolean }> {
  let truncated = false;
  const mode = options?.mode ?? 'full';
  let currentState: SimulatorUrlState = { ...state };
  if (mode === 'safe') {
    currentState = {
      ...currentState,
      title: undefined,
      batch: undefined,
    };
  }
  let fullUrl = createUrl(baseUrl, serializeUrlState(currentState));

  if (fullUrl.length > MAX_SHARE_URL_LENGTH) {
    if (currentState.overrides && Object.keys(currentState.overrides).length > 0) {
      currentState = { ...currentState, overrides: undefined };
      truncated = true;
      fullUrl = createUrl(baseUrl, serializeUrlState(currentState));
    }

    if (fullUrl.length > MAX_SHARE_URL_LENGTH && currentState.batch && currentState.batch.length > 0) {
      currentState = { ...currentState, batch: undefined };
      truncated = true;
      fullUrl = createUrl(baseUrl, serializeUrlState(currentState));
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

    const copied = copyUsingExecCommand(fullUrl);
    return { success: copied, truncated };
  } catch {
    return { success: false, truncated };
  }
}
