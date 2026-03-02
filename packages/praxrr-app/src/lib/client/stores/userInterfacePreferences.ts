import { browser } from '$app/environment';
import { get, writable, type Readable, type Writable } from 'svelte/store';

const UI_PREFERENCE_ENDPOINT = '/api/v1/ui-preferences';
const DEBOUNCE_MS = 300;
const RETRY_DELAYS_MS = [300, 600, 1200];
const SECTION_KEY_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/;
const SECTION_KEY_MAX_LENGTH = 96;

export type UiPreferenceMode = 'basic' | 'advanced';

export interface UserInterfacePreferenceRecord {
  sectionKey: string;
  mode: UiPreferenceMode;
  updatedAt: string | null;
  persisted: boolean;
}

export interface UserInterfacePreferenceStore {
  section: (sectionKey: string, defaultMode?: UiPreferenceMode) => UserInterfaceSectionPreferenceStore;
  authRequired: Readable<boolean>;
  clearAuthRequired: () => void;
}

export interface UserInterfaceSectionPreferenceStore {
  readonly mode: Writable<UiPreferenceMode>;
  readonly persisted: Readable<boolean>;
  readonly isSyncing: Readable<boolean>;
  readonly updatedAt: Readable<string | null>;
  readonly refresh: () => Promise<void>;
  readonly cleanup: () => void;
}

type UiPreferencePayload = {
  section_key: string;
  mode: UiPreferenceMode;
  updated_at: string | null;
  persisted: boolean;
};

class AuthRequiredError extends Error {
  constructor(message = 'Authentication required to sync preferences') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

class RequestFailedError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'RequestFailedError';
  }
}

interface SectionState {
  sectionKey: string;
  modeStore: Writable<UiPreferenceMode>;
  persisted: Writable<boolean>;
  isSyncing: Writable<boolean>;
  updatedAt: Writable<string | null>;
  pendingMode: UiPreferenceMode | null;
  pendingRevision: number;
  lastAckMode: UiPreferenceMode;
  lastAckUpdatedAt: string | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  inflight: boolean;
  hydration: Promise<void> | null;
  refCount: number;
}

const authRequired = writable(false);
const sectionStates = new Map<string, SectionState>();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isUiPreferenceMode = (value: unknown): value is UiPreferenceMode => {
  return value === 'basic' || value === 'advanced';
};

const isPreferenceRecord = (value: unknown): value is UiPreferencePayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.section_key === 'string' &&
    isUiPreferenceMode(record.mode) &&
    (record.updated_at === null || typeof record.updated_at === 'string') &&
    typeof record.persisted === 'boolean'
  );
};

const toRecord = (response: UiPreferencePayload): UserInterfacePreferenceRecord => ({
  sectionKey: response.section_key,
  mode: response.mode,
  updatedAt: response.updated_at,
  persisted: response.persisted,
});

const buildQueryUrl = (sectionKey: string): string => {
  const params = new URLSearchParams({ section_key: sectionKey, strict: 'false' });
  return `${UI_PREFERENCE_ENDPOINT}?${params.toString()}`;
};

const parseSectionKey = (sectionKey: string): string => {
  const normalized = sectionKey.trim();
  if (!SECTION_KEY_PATTERN.test(normalized)) {
    throw new Error('Invalid section key format');
  }

  if (normalized.length > SECTION_KEY_MAX_LENGTH) {
    throw new Error('Invalid section key length');
  }

  return normalized;
};

const parsePreferenceResponse = async (response: Response): Promise<UserInterfacePreferenceRecord> => {
  const payload = await response.json();

  if (!isPreferenceRecord(payload)) {
    throw new Error('Invalid preference payload');
  }

  return toRecord(payload);
};

const isRetryableFailure = (error: unknown): boolean => {
  if (error instanceof RequestFailedError) {
    return error.status >= 500;
  }

  return error instanceof TypeError;
};

const hydrateSection = async (state: SectionState): Promise<void> => {
  if (!browser || state.hydration !== null) {
    return;
  }

  const hydrate = async () => {
    const response = await fetch(buildQueryUrl(state.sectionKey), {
      credentials: 'include',
      cache: 'no-store',
    });

    if (response.status === 401) {
      authRequired.set(true);
      return;
    }

    if (!response.ok) {
      return;
    }

    const record = await parsePreferenceResponse(response);
    state.lastAckMode = record.mode;
    state.lastAckUpdatedAt = record.updatedAt;
    state.persisted.set(record.persisted);
    state.updatedAt.set(record.updatedAt);

    if (state.pendingMode !== null && state.pendingMode !== record.mode) {
      return;
    }

    state.modeStore.set(record.mode);
    state.pendingMode = null;
  };

  state.hydration = hydrate()
    .catch((error) => {
      console.warn('Failed to hydrate UI preference section', {
        sectionKey: state.sectionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      state.hydration = null;
    });

  await state.hydration;
};

const writeSectionPreference = async (
  state: SectionState,
  mode: UiPreferenceMode,
  expectedUpdatedAt: string | null
): Promise<UserInterfacePreferenceRecord> => {
  const response = await fetch(UI_PREFERENCE_ENDPOINT, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section_key: state.sectionKey,
      mode,
      expected_updated_at: expectedUpdatedAt,
    }),
  });

  if (response.status === 401) {
    authRequired.set(true);
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    throw new RequestFailedError(response.status, `Request failed with status ${response.status}`);
  }

  authRequired.set(false);
  return parsePreferenceResponse(response);
};

const persistSection = async (state: SectionState, requestRevision: number, mode: UiPreferenceMode): Promise<void> => {
  const expectedUpdatedAt = state.lastAckUpdatedAt;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const record = await writeSectionPreference(state, mode, expectedUpdatedAt);

      state.lastAckMode = record.mode;
      state.lastAckUpdatedAt = record.updatedAt;
      state.persisted.set(record.persisted);
      state.updatedAt.set(record.updatedAt);

      if (requestRevision === state.pendingRevision) {
        state.pendingMode = null;
        state.modeStore.set(record.mode);
      }

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof AuthRequiredError) {
        if (requestRevision === state.pendingRevision) {
          state.pendingMode = null;
        }

        throw error;
      }

      if (!isRetryableFailure(error) || attempt >= RETRY_DELAYS_MS.length) {
        break;
      }

      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  if (requestRevision === state.pendingRevision) {
    state.modeStore.set(state.lastAckMode);
    state.pendingMode = null;
  }

  throw lastError ?? new Error('Failed to persist preference');
};

const flushSection = (state: SectionState): void => {
  if (!browser) {
    return;
  }

  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  if (state.inflight) {
    schedulePersistence(state);
    return;
  }

  if (state.pendingMode === null || state.pendingMode === state.lastAckMode) {
    state.pendingMode = null;
    return;
  }

  const requestRevision = state.pendingRevision;
  const mode = state.pendingMode;

  state.inflight = true;
  state.isSyncing.set(true);

  void persistSection(state, requestRevision, mode)
    .catch((error) => {
      if (error instanceof AuthRequiredError) {
        return;
      }

      if (error instanceof Error) {
        // errors are surfaced through local rollback and auth-required signal
      }
    })
    .finally(() => {
      state.inflight = false;
      state.isSyncing.set(false);

      if (state.pendingMode === null || state.pendingMode === state.lastAckMode) {
        state.pendingMode = null;
        return;
      }

      schedulePersistence(state);
    });
};

const schedulePersistence = (state: SectionState): void => {
  if (!browser) {
    return;
  }

  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
  }

  state.flushTimer = setTimeout(() => {
    flushSection(state);
  }, DEBOUNCE_MS);
};

const createSectionStore = (
  sectionKey: string,
  defaultMode: UiPreferenceMode = 'basic'
): UserInterfaceSectionPreferenceStore => {
  const resolved = parseSectionKey(sectionKey);
  let state = sectionStates.get(resolved);

  if (!state) {
    state = {
      sectionKey: resolved,
      modeStore: writable<UiPreferenceMode>(defaultMode),
      persisted: writable(false),
      isSyncing: writable(false),
      updatedAt: writable(null),
      pendingMode: null,
      pendingRevision: 0,
      lastAckMode: defaultMode,
      lastAckUpdatedAt: null,
      flushTimer: null,
      inflight: false,
      hydration: null,
      refCount: 0,
    };
    sectionStates.set(resolved, state);

    void hydrateSection(state);
  }

  state.refCount += 1;

  const setMode = (mode: UiPreferenceMode): void => {
    if (get(state.modeStore) === mode) {
      return;
    }

    state.modeStore.set(mode);
    state.pendingMode = mode;
    state.pendingRevision += 1;
    schedulePersistence(state);
  };

  const updateMode = (updater: (value: UiPreferenceMode) => UiPreferenceMode): void => {
    setMode(updater(get(state.modeStore)));
  };

  const refresh = async (): Promise<void> => {
    if (!browser) {
      return;
    }

    await hydrateSection(state);
  };

  const writablePreference: Writable<UiPreferenceMode> = {
    subscribe: state.modeStore.subscribe,
    set: setMode,
    update: updateMode,
  };

  const cleanup = (): void => {
    if (state.refCount > 0) {
      state.refCount -= 1;
    }

    if (state.refCount !== 0) {
      return;
    }

    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
    }
    state.flushTimer = null;
    sectionStates.delete(resolved);
  };

  return {
    mode: writablePreference,
    persisted: {
      subscribe: state.persisted.subscribe,
    },
    isSyncing: {
      subscribe: state.isSyncing.subscribe,
    },
    updatedAt: {
      subscribe: state.updatedAt.subscribe,
    },
    refresh,
    cleanup,
  };
};

const createUserInterfacePreferencesStore = (): UserInterfacePreferenceStore => ({
  section: createSectionStore,
  authRequired: {
    subscribe: authRequired.subscribe,
  },
  clearAuthRequired: () => authRequired.set(false),
});

export const userInterfacePreferencesStore = createUserInterfacePreferencesStore();

export const getUserInterfacePreferenceSectionStore = (
  sectionKey: string,
  defaultMode: UiPreferenceMode = 'basic'
): UserInterfaceSectionPreferenceStore => {
  return userInterfacePreferencesStore.section(sectionKey, defaultMode);
};
