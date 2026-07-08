import type { components } from '$api/v1.d.ts';
import type { ImpactArrType } from './helpers.ts';

type ProposedChange = components['schemas']['ProposedChange'];

const MAX_SHARE_URL_LENGTH = 2000;
const VALID_ARR_TYPES = new Set<ImpactArrType>(['radarr', 'sonarr']);
const VALID_CHANGE_KINDS = new Set(['set_cf_score', 'set_profile_setting']);
const VALID_SETTING_FIELDS = new Set(['minimum_custom_format_score', 'upgrade_until_score', 'upgrade_score_increment']);

/** Encode an arbitrary string to base64 using UTF-8, avoiding btoa's
 *  InvalidCharacterError on non-Latin-1 characters (e.g. anime titles). */
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Decode a base64 string produced by {@link toBase64} back to UTF-8 text. */
function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function warnInvalidUrlStateParam(paramName: string, reason: string, error?: unknown): void {
  const message = `[impact-simulator:urlState] Ignoring invalid "${paramName}" query param: ${reason}`;
  if (error) {
    console.warn(message, error);
    return;
  }

  console.warn(message);
}

function warnClipboardCopyFailure(
  strategy: 'navigator.clipboard.writeText' | 'document.execCommand',
  error: unknown
): void {
  console.warn(`[impact-simulator:urlState] ${strategy} failed during share-link copy`, error);
}

export interface ImpactUrlState {
  arrType?: ImpactArrType;
  profileNames?: string[];
  releases?: string[];
  proposedChanges?: ProposedChange[];
}

export type ShareLinkMode = 'full' | 'safe';

function getNonEmptyParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key);
  if (!value || value.length === 0) {
    return undefined;
  }

  return value;
}

function parseArrType(value: string | undefined): ImpactArrType | undefined {
  if (!value) {
    return undefined;
  }

  return VALID_ARR_TYPES.has(value as ImpactArrType) ? (value as ImpactArrType) : undefined;
}

function parseStringArrayParam(paramName: string, value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fromBase64(value));
    if (!Array.isArray(parsed)) {
      warnInvalidUrlStateParam(paramName, 'decoded value is not an array');
      return undefined;
    }

    if (!parsed.every((entry) => typeof entry === 'string')) {
      warnInvalidUrlStateParam(paramName, 'decoded array contains non-string entries');
      return undefined;
    }

    return parsed.length > 0 ? parsed : undefined;
  } catch (error) {
    warnInvalidUrlStateParam(paramName, 'failed to decode or parse value', error);
    return undefined;
  }
}

function isProposedChange(value: unknown): value is ProposedChange {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const change = value as Record<string, unknown>;
  if (typeof change.kind !== 'string' || !VALID_CHANGE_KINDS.has(change.kind)) {
    return false;
  }

  if (typeof change.profileName !== 'string') {
    return false;
  }

  if (change.kind === 'set_cf_score') {
    return typeof change.customFormatName === 'string' && Number.isFinite(change.score);
  }

  return typeof change.field === 'string' && VALID_SETTING_FIELDS.has(change.field) && Number.isFinite(change.value);
}

function parseChangesParam(value: string | undefined): ProposedChange[] | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fromBase64(value));
    if (!Array.isArray(parsed)) {
      warnInvalidUrlStateParam('changes', 'decoded value is not an array');
      return undefined;
    }

    const changes = parsed.filter(isProposedChange);
    return changes.length > 0 ? changes : undefined;
  } catch (error) {
    warnInvalidUrlStateParam('changes', 'failed to decode or parse value', error);
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

export function parseUrlState(searchParams: URLSearchParams): ImpactUrlState {
  return {
    arrType: parseArrType(getNonEmptyParam(searchParams, 'arrType')),
    profileNames: parseStringArrayParam('profiles', getNonEmptyParam(searchParams, 'profiles')),
    releases: parseStringArrayParam('releases', getNonEmptyParam(searchParams, 'releases')),
    proposedChanges: parseChangesParam(getNonEmptyParam(searchParams, 'changes')),
  };
}

export function serializeUrlState(state: ImpactUrlState): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (state.arrType) {
    searchParams.set('arrType', state.arrType);
  }

  if (state.profileNames && state.profileNames.length > 0) {
    searchParams.set('profiles', toBase64(JSON.stringify(state.profileNames)));
  }

  if (state.releases && state.releases.length > 0) {
    searchParams.set('releases', toBase64(JSON.stringify(state.releases)));
  }

  if (state.proposedChanges && state.proposedChanges.length > 0) {
    searchParams.set('changes', toBase64(JSON.stringify(state.proposedChanges)));
  }

  return searchParams;
}

export async function copyShareLink(
  state: ImpactUrlState,
  baseUrl: string,
  options?: { mode?: ShareLinkMode }
): Promise<{ success: boolean; truncated: boolean }> {
  let truncated = false;
  const mode = options?.mode ?? 'full';
  let currentState: ImpactUrlState = { ...state };
  if (mode === 'safe') {
    currentState = { ...currentState, releases: undefined };
  }
  let fullUrl = createUrl(baseUrl, serializeUrlState(currentState));

  if (fullUrl.length > MAX_SHARE_URL_LENGTH) {
    if (currentState.proposedChanges && currentState.proposedChanges.length > 0) {
      currentState = { ...currentState, proposedChanges: undefined };
      truncated = true;
      fullUrl = createUrl(baseUrl, serializeUrlState(currentState));
    }

    if (fullUrl.length > MAX_SHARE_URL_LENGTH && currentState.releases && currentState.releases.length > 0) {
      currentState = { ...currentState, releases: undefined };
      truncated = true;
      fullUrl = createUrl(baseUrl, serializeUrlState(currentState));
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(fullUrl);
      return { success: true, truncated };
    }
  } catch (error) {
    warnClipboardCopyFailure('navigator.clipboard.writeText', error);
  }

  try {
    if (typeof document === 'undefined' || !document.body) {
      return { success: false, truncated };
    }

    const copied = copyUsingExecCommand(fullUrl);
    return { success: copied, truncated };
  } catch (error) {
    warnClipboardCopyFailure('document.execCommand', error);
    return { success: false, truncated };
  }
}
