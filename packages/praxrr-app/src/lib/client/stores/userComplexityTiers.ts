import { browser } from '$app/environment';
import { alertStore } from '$alerts/store';
import { get, writable, type Readable, type Writable } from 'svelte/store';
import {
  COMPLEXITY_TIERS,
  SECTION_KEY_MAX_LENGTH,
  SECTION_KEY_PATTERN,
  type ComplexityTier,
  type SectionKey,
} from '$shared/complexity/tiers.ts';

const COMPLEXITY_TIER_ENDPOINT = '/api/v1/complexity-tiers';
const DEBOUNCE_MS = 300;
const RETRY_DELAYS_MS = [300, 600, 1200];

export interface UserComplexityTierRecord {
  sectionKey: string;
  tier: ComplexityTier;
  interactionCount: number;
  advancedToggleCount: number;
  lastSuggestedTier: ComplexityTier | null;
  suggestionDismissedAt: string | null;
  updatedAt: string | null;
  persisted: boolean;
}

export interface UserComplexityTiersStore {
  section: (sectionKey: SectionKey, defaultTier?: ComplexityTier) => UserComplexityTierSectionStore;
  authRequired: Readable<boolean>;
  clearAuthRequired: () => void;
  clearOnAuthChange: () => void;
}

export interface UserComplexityTierSectionStore {
  readonly tier: Writable<ComplexityTier>;
  readonly interactionCount: Readable<number>;
  readonly advancedToggleCount: Readable<number>;
  readonly lastSuggestedTier: Readable<ComplexityTier | null>;
  readonly suggestionDismissedAt: Readable<string | null>;
  readonly persisted: Readable<boolean>;
  readonly isSyncing: Readable<boolean>;
  readonly updatedAt: Readable<string | null>;
  readonly refresh: () => Promise<void>;
  readonly recordActivity: (activity: { interaction?: number; advancedToggle?: number }) => Promise<void>;
  readonly dismissSuggestion: (suggestedTier: ComplexityTier) => Promise<void>;
  readonly cleanup: () => void;
}

type ComplexityTierPayload = {
  section_key: string;
  tier: ComplexityTier;
  interaction_count: number;
  advanced_toggle_count: number;
  last_suggested_tier: ComplexityTier | null;
  suggestion_dismissed_at: string | null;
  updated_at: string | null;
  persisted: boolean;
};

class AuthRequiredError extends Error {
  constructor(message = 'Authentication required to sync complexity tiers') {
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
  sectionKey: SectionKey;
  tierStore: Writable<ComplexityTier>;
  interactionCount: Writable<number>;
  advancedToggleCount: Writable<number>;
  lastSuggestedTier: Writable<ComplexityTier | null>;
  suggestionDismissedAt: Writable<string | null>;
  persisted: Writable<boolean>;
  isSyncing: Writable<boolean>;
  updatedAt: Writable<string | null>;
  pendingTier: ComplexityTier | null;
  pendingRevision: number;
  lastAckTier: ComplexityTier;
  lastAckUpdatedAt: string | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  inflight: boolean;
  hydration: Promise<void> | null;
  refCount: number;
}

const authRequired = writable(false);
const sectionStates = new Map<SectionKey, SectionState>();

function clearSectionCacheOnAuthChange(): void {
  for (const state of sectionStates.values()) {
    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
  }
  sectionStates.clear();
  authRequired.set(false);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isComplexityTier = (value: unknown): value is ComplexityTier => {
  return COMPLEXITY_TIERS.includes(value as ComplexityTier);
};

const isComplexityTierRecord = (value: unknown): value is ComplexityTierPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.section_key === 'string' &&
    isComplexityTier(record.tier) &&
    typeof record.interaction_count === 'number' &&
    typeof record.advanced_toggle_count === 'number' &&
    (record.last_suggested_tier === null || isComplexityTier(record.last_suggested_tier)) &&
    (record.suggestion_dismissed_at === null || typeof record.suggestion_dismissed_at === 'string') &&
    (record.updated_at === null || typeof record.updated_at === 'string') &&
    typeof record.persisted === 'boolean'
  );
};

const toRecord = (response: ComplexityTierPayload): UserComplexityTierRecord => ({
  sectionKey: response.section_key,
  tier: response.tier,
  interactionCount: response.interaction_count,
  advancedToggleCount: response.advanced_toggle_count,
  lastSuggestedTier: response.last_suggested_tier,
  suggestionDismissedAt: response.suggestion_dismissed_at,
  updatedAt: response.updated_at,
  persisted: response.persisted,
});

const buildQueryUrl = (sectionKey: SectionKey): string => {
  const params = new URLSearchParams({ section_key: sectionKey, strict: 'false' });
  return `${COMPLEXITY_TIER_ENDPOINT}?${params.toString()}`;
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

const parseTierResponse = async (response: Response): Promise<UserComplexityTierRecord> => {
  const payload = await response.json();

  if (!isComplexityTierRecord(payload)) {
    throw new Error('Invalid complexity tier payload');
  }

  return toRecord(payload);
};

const isRetryableFailure = (error: unknown): boolean => {
  if (error instanceof RequestFailedError) {
    return error.status >= 500;
  }

  return error instanceof TypeError;
};

const applyRecord = (state: SectionState, record: UserComplexityTierRecord): void => {
  state.lastAckTier = record.tier;
  state.lastAckUpdatedAt = record.updatedAt;
  state.interactionCount.set(record.interactionCount);
  state.advancedToggleCount.set(record.advancedToggleCount);
  state.lastSuggestedTier.set(record.lastSuggestedTier);
  state.suggestionDismissedAt.set(record.suggestionDismissedAt);
  state.persisted.set(record.persisted);
  state.updatedAt.set(record.updatedAt);
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
      clearSectionCacheOnAuthChange();
      return;
    }

    if (!response.ok) {
      console.warn('Failed to hydrate complexity tier section', {
        sectionKey: state.sectionKey,
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }

    const record = await parseTierResponse(response);
    applyRecord(state, record);

    if (state.pendingTier !== null && state.pendingTier !== record.tier) {
      return;
    }

    state.tierStore.set(record.tier);
    state.pendingTier = null;
  };

  state.hydration = hydrate()
    .catch((error) => {
      console.warn('Failed to hydrate complexity tier section', {
        sectionKey: state.sectionKey,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      state.hydration = null;
    });

  await state.hydration;
};

const writeSectionTier = async (
  state: SectionState,
  tier: ComplexityTier,
  expectedUpdatedAt: string | null,
  extra: Record<string, unknown> = {}
): Promise<UserComplexityTierRecord> => {
  const response = await fetch(COMPLEXITY_TIER_ENDPOINT, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section_key: state.sectionKey,
      tier,
      expected_updated_at: expectedUpdatedAt,
      ...extra,
    }),
  });

  if (response.status === 401) {
    authRequired.set(true);
    clearSectionCacheOnAuthChange();
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    throw new RequestFailedError(response.status, `Request failed with status ${response.status}`);
  }

  authRequired.set(false);
  return parseTierResponse(response);
};

const persistSection = async (state: SectionState, requestRevision: number, tier: ComplexityTier): Promise<void> => {
  const expectedUpdatedAt = state.lastAckUpdatedAt;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const record = await writeSectionTier(state, tier, expectedUpdatedAt);

      applyRecord(state, record);

      if (requestRevision === state.pendingRevision) {
        state.pendingTier = null;
        state.tierStore.set(record.tier);
      }

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof AuthRequiredError) {
        if (requestRevision === state.pendingRevision) {
          state.pendingTier = null;
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
    state.tierStore.set(state.lastAckTier);
    state.pendingTier = null;
  }

  throw lastError ?? new Error('Failed to persist complexity tier');
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

  if (state.pendingTier === null || state.pendingTier === state.lastAckTier) {
    state.pendingTier = null;
    return;
  }

  const requestRevision = state.pendingRevision;
  const tier = state.pendingTier;

  state.inflight = true;
  state.isSyncing.set(true);

  void persistSection(state, requestRevision, tier)
    .catch((error) => {
      if (error instanceof AuthRequiredError) {
        return;
      }

      if (error instanceof Error) {
        console.error('Failed to persist complexity tier section', {
          sectionKey: state.sectionKey,
          error: error.message,
        });
        alertStore.add(
          'warning',
          `Unable to sync complexity tier for section "${state.sectionKey}". Changes may revert if offline.`
        );
      }
    })
    .finally(() => {
      state.inflight = false;
      state.isSyncing.set(false);

      if (state.pendingTier === null || state.pendingTier === state.lastAckTier) {
        state.pendingTier = null;
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
  defaultTier: ComplexityTier = 'beginner'
): UserComplexityTierSectionStore => {
  const resolved = parseSectionKey(sectionKey);
  let state = sectionStates.get(resolved);

  if (!state) {
    state = {
      sectionKey: resolved,
      tierStore: writable<ComplexityTier>(defaultTier),
      interactionCount: writable(0),
      advancedToggleCount: writable(0),
      lastSuggestedTier: writable(null),
      suggestionDismissedAt: writable(null),
      persisted: writable(false),
      isSyncing: writable(false),
      updatedAt: writable(null),
      pendingTier: null,
      pendingRevision: 0,
      lastAckTier: defaultTier,
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

  const setTier = (tier: ComplexityTier): void => {
    if (get(state.tierStore) === tier) {
      return;
    }

    state.tierStore.set(tier);
    state.pendingTier = tier;
    state.pendingRevision += 1;
    schedulePersistence(state);
  };

  const updateTier = (updater: (value: ComplexityTier) => ComplexityTier): void => {
    setTier(updater(get(state.tierStore)));
  };

  const refresh = async (): Promise<void> => {
    if (!browser) {
      return;
    }

    await hydrateSection(state);
  };

  const recordActivity = async ({
    interaction = 0,
    advancedToggle = 0,
  }: {
    interaction?: number;
    advancedToggle?: number;
  }): Promise<void> => {
    if (!browser) {
      return;
    }

    const record = await writeSectionTier(state, get(state.tierStore), state.lastAckUpdatedAt, {
      interaction_delta: interaction,
      advanced_toggle_delta: advancedToggle,
    });
    applyRecord(state, record);
    state.tierStore.set(record.tier);
  };

  const dismissSuggestion = async (suggestedTier: ComplexityTier): Promise<void> => {
    if (!browser) {
      return;
    }

    const record = await writeSectionTier(state, get(state.tierStore), state.lastAckUpdatedAt, {
      last_suggested_tier: suggestedTier,
      suggestion_dismissed_at: new Date().toISOString(),
    });
    applyRecord(state, record);
    state.tierStore.set(record.tier);
  };

  const writableTier: Writable<ComplexityTier> = {
    subscribe: state.tierStore.subscribe,
    set: setTier,
    update: updateTier,
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
    tier: writableTier,
    interactionCount: {
      subscribe: state.interactionCount.subscribe,
    },
    advancedToggleCount: {
      subscribe: state.advancedToggleCount.subscribe,
    },
    lastSuggestedTier: {
      subscribe: state.lastSuggestedTier.subscribe,
    },
    suggestionDismissedAt: {
      subscribe: state.suggestionDismissedAt.subscribe,
    },
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
    recordActivity,
    dismissSuggestion,
    cleanup,
  };
};

const createUserComplexityTiersStore = (): UserComplexityTiersStore => ({
  section: createSectionStore,
  authRequired: {
    subscribe: authRequired.subscribe,
  },
  clearAuthRequired: () => authRequired.set(false),
  clearOnAuthChange: clearSectionCacheOnAuthChange,
});

export const userComplexityTiersStore = createUserComplexityTiersStore();

export const getUserComplexityTierSectionStore = (
  sectionKey: SectionKey,
  defaultTier: ComplexityTier = 'beginner'
): UserComplexityTierSectionStore => {
  return userComplexityTiersStore.section(sectionKey, defaultTier);
};
