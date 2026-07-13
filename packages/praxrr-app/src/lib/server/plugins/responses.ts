/**
 * Plugin management response and service boundary.
 *
 * This module is the only public projection of durable plugin rows. Every mapper copies an explicit
 * allow-list derived from the generated OpenAPI types; internal manifest JSON and source directories
 * cannot cross the HTTP or MCP boundary by structural spread.
 */

import type { components } from '$api/v1.d.ts';
import { pluginRegistryQueries, type PluginRegistryRecord } from '$db/queries/pluginRegistry.ts';
import type { PluginManifest } from '$shared/plugins/index.ts';
import { isPluginsEnabled, persistPluginsEnabled } from './featureFlag.ts';
import { pluginHost } from './host.ts';

export type PluginManifestResponse = components['schemas']['PluginManifestMetadata'];
export type PluginResponse = components['schemas']['PluginRecord'];
export type PluginListResponse = components['schemas']['PluginListResponse'];
export type PluginDetailResponse = components['schemas']['PluginDetailResponse'];
export type PluginMutationResponse = components['schemas']['PluginMutationResponse'];
export type PluginReloadResponse = components['schemas']['PluginReloadResponse'];
export type PluginErrorCode = components['schemas']['PluginErrorCode'];
export type PluginErrorResponse = components['schemas']['PluginErrorResponse'];
export type PluginSettingsResponse = components['schemas']['PluginSettingsResponse'];

export type PluginListOutcome =
  | { readonly kind: 'success'; readonly response: PluginListResponse }
  | { readonly kind: 'error'; readonly error: unknown };

export type PluginReadOutcome =
  | { readonly kind: 'success'; readonly response: PluginDetailResponse }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'error'; readonly error: unknown };

export type PluginMutationOutcome =
  | { readonly kind: 'success'; readonly response: PluginMutationResponse }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'error'; readonly error: unknown };

export type PluginReloadOutcome =
  | { readonly kind: 'success'; readonly response: PluginReloadResponse }
  | { readonly kind: 'error'; readonly error: unknown };

export type PluginSettingsOutcome =
  | { readonly kind: 'success'; readonly response: PluginSettingsResponse }
  | { readonly kind: 'error'; readonly error: unknown };

const ERROR_MESSAGES = {
  invalid_identity: 'Plugin apiVersion and id must be non-empty strings',
  plugins_disabled: 'Plugin management is disabled. Enable the plugin ecosystem in Settings → Plugins.',
  plugin_not_found: 'Plugin not found in the requested API-version namespace',
  internal_error: 'Plugin management operation failed',
} as const satisfies Record<PluginErrorCode, string>;

/** Build a stable, redacted error body without exposing raw database or filesystem diagnostics. */
export function toPluginErrorResponse(code: PluginErrorCode): PluginErrorResponse {
  return { code, error: ERROR_MESSAGES[code] };
}

/** Project only validated, portable manifest fields. */
export function toPluginManifestResponse(manifest: PluginManifest): PluginManifestResponse {
  return {
    apiVersion: manifest.apiVersion,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    runtime: manifest.runtime,
    entry: manifest.entry,
    extensionPoints: [...manifest.extensionPoints],
    capabilities: [...manifest.capabilities],
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    ...(manifest.author !== undefined ? { author: manifest.author } : {}),
    ...(manifest.engines !== undefined
      ? {
          engines: {
            ...(manifest.engines.praxrr !== undefined ? { praxrr: manifest.engines.praxrr } : {}),
          },
        }
      : {}),
  };
}

/** Project one validated durable row to the generated public plugin shape. */
export function toPluginResponse(record: PluginRegistryRecord): PluginResponse {
  return {
    manifest: toPluginManifestResponse(record.manifest),
    enabled: record.enabled,
    discovered: record.discovered,
    state: record.state,
    registeredAt: record.registeredAt,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Read the global plugin-ecosystem enablement flag. */
export function getPluginSettings(): PluginSettingsOutcome {
  try {
    return { kind: 'success', response: { pluginsEnabled: isPluginsEnabled() } };
  } catch (error) {
    return { kind: 'error', error };
  }
}

/**
 * Persist global enablement, then activate or deactivate the host without requiring a restart.
 * Enablement is written before host work so reload/initialize observes the new flag.
 */
export async function setPluginSettings(pluginsEnabled: boolean): Promise<PluginSettingsOutcome> {
  try {
    persistPluginsEnabled(pluginsEnabled);
    if (pluginsEnabled) {
      await pluginHost.initialize();
    } else {
      pluginHost.reset();
    }
    return { kind: 'success', response: { pluginsEnabled } };
  } catch (error) {
    return { kind: 'error', error };
  }
}

/** List durable plugin state, returning the contract-defined empty view while the feature is off. */
export function listPlugins(): PluginListOutcome {
  if (!isPluginsEnabled()) {
    return { kind: 'success', response: { pluginsEnabled: false, items: [] } };
  }

  try {
    return {
      kind: 'success',
      response: {
        pluginsEnabled: true,
        items: pluginRegistryQueries.list().map(toPluginResponse),
      },
    };
  } catch (error) {
    return { kind: 'error', error };
  }
}

/** Read one plugin without inferring an API-version namespace. */
export function getPlugin(apiVersion: string, id: string): PluginReadOutcome {
  if (!isPluginsEnabled()) {
    return { kind: 'disabled' };
  }

  try {
    const record = pluginRegistryQueries.get(apiVersion, id);
    if (!record) {
      return { kind: 'not_found' };
    }
    return {
      kind: 'success',
      response: { pluginsEnabled: true, plugin: toPluginResponse(record) },
    };
  } catch (error) {
    return { kind: 'error', error };
  }
}

/** Persist enablement intent without treating enabled as runtime activation or execution. */
export async function setPluginEnabled(
  apiVersion: string,
  id: string,
  enabled: boolean
): Promise<PluginMutationOutcome> {
  if (!isPluginsEnabled()) {
    return { kind: 'disabled' };
  }

  try {
    const record = await pluginHost.setPluginEnabled(apiVersion, id, enabled);
    if (!record) {
      return { kind: 'not_found' };
    }
    return {
      kind: 'success',
      response: { pluginsEnabled: true, plugin: toPluginResponse(record) },
    };
  } catch (error) {
    return { kind: 'error', error };
  }
}

/** Run the host's serialized reload and preserve its generated contract shape. */
export async function reloadPlugins(): Promise<PluginReloadOutcome> {
  try {
    return { kind: 'success', response: await pluginHost.reload() };
  } catch (error) {
    return { kind: 'error', error };
  }
}
