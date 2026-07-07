import { browser } from '$app/environment';
import { alertStore } from '$alerts/store';
import { get, writable, type Writable } from 'svelte/store';
import { SECTION_KEY_MAX_LENGTH, SECTION_KEY_PATTERN, type SectionKey } from '$shared/disclosure/sectionKeys.ts';

export const DEBOUNCE_MS = 300;
export const RETRY_DELAYS_MS = [300, 600, 1200];

export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class RequestFailedError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'RequestFailedError';
  }
}

export interface BaseSectionSyncState<TValue> {
  sectionKey: SectionKey;
  valueStore: Writable<TValue>;
  persisted: Writable<boolean>;
  isSyncing: Writable<boolean>;
  updatedAt: Writable<string | null>;
  pendingValue: TValue | null;
  pendingRevision: number;
  lastAckValue: TValue;
  lastAckUpdatedAt: string | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  inflight: boolean;
  hydration: Promise<void> | null;
  refCount: number;
}

export interface DebouncedSectionSyncConfig<TValue, TRecord> {
  authRequiredMessage: string;
  hydrateFailureLog: string;
  persistFailureLog: string;
  persistAlert: (sectionKey: SectionKey) => string;
  buildQueryUrl: (sectionKey: SectionKey) => string;
  parseResponse: (response: Response) => Promise<TRecord>;
  extractSyncFields: (record: TRecord) => {
    value: TValue;
    updatedAt: string | null;
    persisted: boolean;
  };
  applyExtraRecordFields?: (state: BaseSectionSyncState<TValue>, record: TRecord) => void;
  writeRequest: (
    sectionKey: SectionKey,
    value: TValue,
    expectedUpdatedAt: string | null,
    extra?: Record<string, unknown>
  ) => Promise<Response>;
}

export interface DebouncedSectionSync<TValue, TRecord> {
  authRequired: Writable<boolean>;
  sectionStates: Map<SectionKey, BaseSectionSyncState<TValue>>;
  clearOnAuthChange: () => void;
  parseSectionKey: (sectionKey: string) => SectionKey;
  createSectionState: (sectionKey: SectionKey, defaultValue: TValue) => BaseSectionSyncState<TValue>;
  hydrate: (state: BaseSectionSyncState<TValue>) => Promise<void>;
  schedulePersistence: (state: BaseSectionSyncState<TValue>) => void;
  setPendingValue: (state: BaseSectionSyncState<TValue>, value: TValue) => void;
  writeImmediate: (
    state: BaseSectionSyncState<TValue>,
    value: TValue,
    extra?: Record<string, unknown>
  ) => Promise<TRecord>;
  applyRecord: (state: BaseSectionSyncState<TValue>, record: TRecord) => void;
  decrementRefAndCleanup: (state: BaseSectionSyncState<TValue>, sectionKey: SectionKey) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableFailure = (error: unknown): boolean => {
  if (error instanceof RequestFailedError) {
    return error.status >= 500;
  }

  return error instanceof TypeError;
};

export const createDebouncedSectionSync = <TValue, TRecord>(
  config: DebouncedSectionSyncConfig<TValue, TRecord>
): DebouncedSectionSync<TValue, TRecord> => {
  const authRequired = writable(false);
  const sectionStates = new Map<SectionKey, BaseSectionSyncState<TValue>>();

  const clearOnAuthChange = (): void => {
    for (const state of sectionStates.values()) {
      if (state.flushTimer !== null) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
    }
    sectionStates.clear();
    authRequired.set(false);
  };

  const parseSectionKey = (sectionKey: string): SectionKey => {
    const normalized = sectionKey.trim();
    if (!SECTION_KEY_PATTERN.test(normalized)) {
      throw new Error('Invalid section key format');
    }

    if (normalized.length > SECTION_KEY_MAX_LENGTH) {
      throw new Error('Invalid section key length');
    }

    return normalized as SectionKey;
  };

  const applyRecord = (state: BaseSectionSyncState<TValue>, record: TRecord): void => {
    const fields = config.extractSyncFields(record);
    state.lastAckValue = fields.value;
    state.lastAckUpdatedAt = fields.updatedAt;
    state.persisted.set(fields.persisted);
    state.updatedAt.set(fields.updatedAt);
    config.applyExtraRecordFields?.(state, record);
  };

  const writeWithAuth = async (
    sectionKey: SectionKey,
    value: TValue,
    expectedUpdatedAt: string | null,
    extra: Record<string, unknown> = {}
  ): Promise<TRecord> => {
    const response = await config.writeRequest(sectionKey, value, expectedUpdatedAt, extra);

    if (response.status === 401) {
      authRequired.set(true);
      clearOnAuthChange();
      throw new AuthRequiredError(config.authRequiredMessage);
    }

    if (!response.ok) {
      throw new RequestFailedError(response.status, `Request failed with status ${response.status}`);
    }

    authRequired.set(false);
    return config.parseResponse(response);
  };

  const persistSection = async (
    state: BaseSectionSyncState<TValue>,
    requestRevision: number,
    value: TValue
  ): Promise<void> => {
    const expectedUpdatedAt = state.lastAckUpdatedAt;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const record = await writeWithAuth(state.sectionKey, value, expectedUpdatedAt);
        applyRecord(state, record);

        if (requestRevision === state.pendingRevision) {
          state.pendingValue = null;
          state.valueStore.set(config.extractSyncFields(record).value);
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof AuthRequiredError) {
          if (requestRevision === state.pendingRevision) {
            state.pendingValue = null;
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
      state.valueStore.set(state.lastAckValue);
      state.pendingValue = null;
    }

    throw lastError ?? new Error(config.persistFailureLog);
  };

  const flushSection = (state: BaseSectionSyncState<TValue>): void => {
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

    if (state.pendingValue === null || state.pendingValue === state.lastAckValue) {
      state.pendingValue = null;
      return;
    }

    const requestRevision = state.pendingRevision;
    const value = state.pendingValue;

    state.inflight = true;
    state.isSyncing.set(true);

    void persistSection(state, requestRevision, value)
      .catch((error) => {
        if (error instanceof AuthRequiredError) {
          return;
        }

        if (error instanceof Error) {
          console.error(config.persistFailureLog, {
            sectionKey: state.sectionKey,
            error: error.message,
          });
          alertStore.add('warning', config.persistAlert(state.sectionKey));
        }
      })
      .finally(() => {
        state.inflight = false;
        state.isSyncing.set(false);

        if (state.pendingValue === null || state.pendingValue === state.lastAckValue) {
          state.pendingValue = null;
          return;
        }

        schedulePersistence(state);
      });
  };

  const schedulePersistence = (state: BaseSectionSyncState<TValue>): void => {
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

  const hydrate = async (state: BaseSectionSyncState<TValue>): Promise<void> => {
    if (!browser || state.hydration !== null) {
      return;
    }

    const hydrateRequest = async () => {
      const response = await fetch(config.buildQueryUrl(state.sectionKey), {
        credentials: 'include',
        cache: 'no-store',
      });

      if (response.status === 401) {
        authRequired.set(true);
        clearOnAuthChange();
        return;
      }

      if (!response.ok) {
        console.warn(config.hydrateFailureLog, {
          sectionKey: state.sectionKey,
          status: response.status,
          statusText: response.statusText,
        });
        return;
      }

      const record = await config.parseResponse(response);
      applyRecord(state, record);

      const fields = config.extractSyncFields(record);
      if (state.pendingValue !== null && state.pendingValue !== fields.value) {
        return;
      }

      state.valueStore.set(fields.value);
      state.pendingValue = null;
    };

    state.hydration = hydrateRequest()
      .catch((error) => {
        console.warn(config.hydrateFailureLog, {
          sectionKey: state.sectionKey,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        state.hydration = null;
      });

    await state.hydration;
  };

  const createSectionState = (sectionKey: SectionKey, defaultValue: TValue): BaseSectionSyncState<TValue> => ({
    sectionKey,
    valueStore: writable<TValue>(defaultValue),
    persisted: writable(false),
    isSyncing: writable(false),
    updatedAt: writable(null),
    pendingValue: null,
    pendingRevision: 0,
    lastAckValue: defaultValue,
    lastAckUpdatedAt: null,
    flushTimer: null,
    inflight: false,
    hydration: null,
    refCount: 0,
  });

  const setPendingValue = (state: BaseSectionSyncState<TValue>, value: TValue): void => {
    if (get(state.valueStore) === value) {
      return;
    }

    state.valueStore.set(value);
    state.pendingValue = value;
    state.pendingRevision += 1;
    schedulePersistence(state);
  };

  const writeImmediate = async (
    state: BaseSectionSyncState<TValue>,
    value: TValue,
    extra: Record<string, unknown> = {}
  ): Promise<TRecord> => {
    const record = await writeWithAuth(state.sectionKey, value, state.lastAckUpdatedAt, extra);
    applyRecord(state, record);
    state.valueStore.set(config.extractSyncFields(record).value);
    return record;
  };

  const decrementRefAndCleanup = (state: BaseSectionSyncState<TValue>, sectionKey: SectionKey): void => {
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
    sectionStates.delete(sectionKey);
  };

  return {
    authRequired,
    sectionStates,
    clearOnAuthChange,
    parseSectionKey,
    createSectionState,
    hydrate,
    schedulePersistence,
    setPendingValue,
    writeImmediate,
    applyRecord,
    decrementRefAndCleanup,
  };
};
