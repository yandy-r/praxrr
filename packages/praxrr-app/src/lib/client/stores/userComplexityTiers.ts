import { browser } from '$app/environment';
import { get, writable, type Readable, type Writable } from 'svelte/store';
import { COMPLEXITY_TIERS, type ComplexityTier, type SectionKey } from '$shared/complexity/tiers.ts';
import { createDebouncedSectionSync, type BaseSectionSyncState } from './sectionDebouncedSync.ts';

const COMPLEXITY_TIER_ENDPOINT = '/api/v1/complexity-tiers';

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

interface ComplexityTierSectionState extends BaseSectionSyncState<ComplexityTier> {
  interactionCount: Writable<number>;
  advancedToggleCount: Writable<number>;
  lastSuggestedTier: Writable<ComplexityTier | null>;
  suggestionDismissedAt: Writable<string | null>;
}

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

const parseTierResponse = async (response: Response): Promise<UserComplexityTierRecord> => {
  const payload = await response.json();

  if (!isComplexityTierRecord(payload)) {
    throw new Error('Invalid complexity tier payload');
  }

  return toRecord(payload);
};

const sectionSync = createDebouncedSectionSync<ComplexityTier, UserComplexityTierRecord>({
  authRequiredMessage: 'Authentication required to sync complexity tiers',
  hydrateFailureLog: 'Failed to hydrate complexity tier section',
  persistFailureLog: 'Failed to persist complexity tier section',
  persistAlert: (sectionKey) =>
    `Unable to sync complexity tier for section "${sectionKey}". Changes may revert if offline.`,
  buildQueryUrl,
  parseResponse: parseTierResponse,
  extractSyncFields: (record) => ({
    value: record.tier,
    updatedAt: record.updatedAt,
    persisted: record.persisted,
  }),
  applyExtraRecordFields: (state, record) => {
    const tierState = state as ComplexityTierSectionState;
    tierState.interactionCount.set(record.interactionCount);
    tierState.advancedToggleCount.set(record.advancedToggleCount);
    tierState.lastSuggestedTier.set(record.lastSuggestedTier);
    tierState.suggestionDismissedAt.set(record.suggestionDismissedAt);
  },
  writeRequest: (sectionKey, tier, expectedUpdatedAt, extra = {}) =>
    fetch(COMPLEXITY_TIER_ENDPOINT, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section_key: sectionKey,
        tier,
        expected_updated_at: expectedUpdatedAt,
        ...extra,
      }),
    }),
});

const createComplexityTierSectionState = (
  sectionKey: SectionKey,
  defaultTier: ComplexityTier
): ComplexityTierSectionState => ({
  ...sectionSync.createSectionState(sectionKey, defaultTier),
  interactionCount: writable(0),
  advancedToggleCount: writable(0),
  lastSuggestedTier: writable(null),
  suggestionDismissedAt: writable(null),
});

const createSectionStore = (
  sectionKey: string,
  defaultTier: ComplexityTier = 'beginner'
): UserComplexityTierSectionStore => {
  const resolved = sectionSync.parseSectionKey(sectionKey);
  let state = sectionSync.sectionStates.get(resolved) as ComplexityTierSectionState | undefined;

  if (!state) {
    state = createComplexityTierSectionState(resolved, defaultTier);
    sectionSync.sectionStates.set(resolved, state);
    void sectionSync.hydrate(state);
  }

  state.refCount += 1;

  const setTier = (tier: ComplexityTier): void => {
    sectionSync.setPendingValue(state, tier);
  };

  const updateTier = (updater: (value: ComplexityTier) => ComplexityTier): void => {
    setTier(updater(get(state.valueStore)));
  };

  const refresh = async (): Promise<void> => {
    if (!browser) {
      return;
    }

    await sectionSync.hydrate(state);
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

    await sectionSync.writeImmediate(state, get(state.valueStore), {
      interaction_delta: interaction,
      advanced_toggle_delta: advancedToggle,
    });
  };

  const dismissSuggestion = async (suggestedTier: ComplexityTier): Promise<void> => {
    if (!browser) {
      return;
    }

    await sectionSync.writeImmediate(state, get(state.valueStore), {
      last_suggested_tier: suggestedTier,
      suggestion_dismissed_at: new Date().toISOString(),
    });
  };

  const writableTier: Writable<ComplexityTier> = {
    subscribe: state.valueStore.subscribe,
    set: setTier,
    update: updateTier,
  };

  const cleanup = (): void => {
    sectionSync.decrementRefAndCleanup(state, resolved);
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
    subscribe: sectionSync.authRequired.subscribe,
  },
  clearAuthRequired: () => sectionSync.authRequired.set(false),
  clearOnAuthChange: sectionSync.clearOnAuthChange,
});

export const userComplexityTiersStore = createUserComplexityTiersStore();

export const getUserComplexityTierSectionStore = (
  sectionKey: SectionKey,
  defaultTier: ComplexityTier = 'beginner'
): UserComplexityTierSectionStore => {
  return userComplexityTiersStore.section(sectionKey, defaultTier);
};
