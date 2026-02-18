import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { ARR_TARGET_ORDER } from '$shared/arr/capabilities.ts';
import { isArrType, type ArrType } from '$shared/pcd/types.ts';
import type { Writable } from 'svelte/store';

const NAV_SCOPE_STORAGE_KEY = 'navScope';
const DEFAULT_SCOPE: ArrType = 'all';

function areScopeArraysEqual(left: readonly ArrType[], right: readonly ArrType[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function normalizeAvailableScopes(scopes: readonly ArrType[] | undefined): ArrType[] {
  const normalized = scopes?.filter((scope): scope is ArrType => isArrType(scope)) ?? [];
  const result: ArrType[] = [];

  for (const scope of normalized) {
    if (!result.includes(scope)) {
      result.push(scope);
    }
  }

  if (result.length === 0) {
    return [...ARR_TARGET_ORDER];
  }

  return result;
}

function resolveStoredScope(scope: string | null, availableScopes: readonly ArrType[]): ArrType {
  if (scope !== null && isArrType(scope) && availableScopes.includes(scope)) {
    return scope;
  }

  return DEFAULT_SCOPE;
}

interface NavScopeStore {
  subscribe: Writable<ArrType>[`subscribe`];
  setScope: (scope: ArrType) => ArrType;
  syncAvailableScopes: (scopes: ArrType[]) => ArrType;
}

function createNavScopeStore(): NavScopeStore {
  let availableScopes: ArrType[] = [...ARR_TARGET_ORDER];
  let persistedScope: string | null = null;

  if (browser) {
    persistedScope = localStorage.getItem(NAV_SCOPE_STORAGE_KEY);
  }

  const scope = resolveStoredScope(persistedScope, availableScopes);
  let currentScope = scope;

  const { subscribe, set } = writable<ArrType>(scope);

  const persistScope = (nextScope: ArrType) => {
    if (browser) {
      localStorage.setItem(NAV_SCOPE_STORAGE_KEY, nextScope);
    }
  };

  const applyScope = (nextScope: ArrType): ArrType => {
    if (nextScope === currentScope) {
      return currentScope;
    }

    currentScope = nextScope;
    set(nextScope);
    persistScope(nextScope);
    return currentScope;
  };

  if (browser) {
    if (persistedScope !== scope) {
      persistScope(scope);
    }
  }

  const syncAvailableScopes = (scopes: ArrType[]): ArrType => {
    const nextScopes = normalizeAvailableScopes(scopes);

    if (!areScopeArraysEqual(nextScopes, availableScopes)) {
      availableScopes = nextScopes;
    }

    const resolvedScope = resolveStoredScope(currentScope, availableScopes);
    return applyScope(resolvedScope);
  };

  const setScope = (nextScope: ArrType): ArrType => {
    const resolvedScope = resolveStoredScope(nextScope, availableScopes);
    return applyScope(resolvedScope);
  };

  return {
    subscribe,
    setScope,
    syncAvailableScopes,
  };
}

export const navScope = createNavScopeStore();
