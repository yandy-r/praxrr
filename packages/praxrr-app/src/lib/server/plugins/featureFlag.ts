/**
 * Runtime source of truth for the plugin-ecosystem master switch.
 *
 * Persistence lives on `general_settings.plugins_enabled` (default off). A process cache
 * makes hot enable/disable observable without restart. Call {@link loadPluginsFeatureFlag}
 * after migrations on startup before host initialize / observe wire sites.
 *
 * Nav visibility must never depend on this flag — enablement only gates host/API/runtime.
 */

import { generalSettingsQueries } from '$db/queries/generalSettings.ts';

let cached: boolean | null = null;

/** Read the process cache, loading once from DB when unset. */
export function isPluginsEnabled(): boolean {
  if (cached !== null) {
    return cached;
  }
  try {
    return loadPluginsFeatureFlag();
  } catch {
    // Before migrations/initialize (or in isolated unit tests), treat as off.
    cached = false;
    return false;
  }
}

/** Load (or reload) the flag from `general_settings` into the process cache. */
export function loadPluginsFeatureFlag(): boolean {
  cached = generalSettingsQueries.isPluginsEnabled();
  return cached;
}

/**
 * Persist enablement and update the process cache.
 * Callers that activate/deactivate the host should do so after this returns.
 */
export function persistPluginsEnabled(enabled: boolean): boolean {
  const updated = generalSettingsQueries.update({ pluginsEnabled: enabled });
  cached = enabled;
  return updated;
}

/** Test helper: force the in-memory cache without touching the database. */
export function setPluginsEnabledCacheForTests(enabled: boolean): void {
  cached = enabled;
}

/** Test helper: clear the cache so the next read reloads from DB (or defaults). */
export function resetPluginsEnabledCacheForTests(): void {
  cached = null;
}

/**
 * Run `fn` with the in-memory feature cache forced to `enabled`, restoring afterward.
 * Prefer this over mutating deprecated env-backed config fields.
 */
export async function withPluginsFeature<T>(enabled: boolean, fn: () => Promise<T> | T): Promise<T> {
  const previous = cached;
  cached = enabled;
  try {
    return await fn();
  } finally {
    cached = previous;
  }
}
