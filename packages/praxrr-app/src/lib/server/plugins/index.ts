/**
 * Server plugin subsystem — public surface (issue #35, Phase-1).
 *
 * The single `$server/plugins/index.ts` import surface `hooks.server.ts` (and future call-sites) use.
 * Re-exports the host orchestrator, the apiVersion-namespaced registry, the swappable executor seam +
 * its inert default, and the full error taxonomy (trashguide `index.ts` barrel pattern).
 */

export { pluginHost, PluginHost, type PluginHostDependencies, type PluginReloadSummary } from './host.ts';
export {
  isPluginsEnabled,
  loadPluginsFeatureFlag,
  persistPluginsEnabled,
  resetPluginsEnabledCacheForTests,
  setPluginsEnabledCacheForTests,
  withPluginsFeature,
} from './featureFlag.ts';
export {
  getPlugin,
  getPluginSettings,
  listPlugins,
  reloadPlugins,
  setPluginEnabled,
  setPluginSettings,
  toPluginErrorResponse,
  toPluginManifestResponse,
  toPluginResponse,
  type PluginDetailResponse,
  type PluginErrorCode,
  type PluginErrorResponse,
  type PluginListOutcome,
  type PluginListResponse,
  type PluginManifestResponse,
  type PluginMutationOutcome,
  type PluginMutationResponse,
  type PluginReadOutcome,
  type PluginReloadOutcome,
  type PluginReloadResponse,
  type PluginResponse,
  type PluginSettingsOutcome,
  type PluginSettingsResponse,
} from './responses.ts';
export { pluginRegistry, PluginRegistry, type RegisteredPlugin } from './registry.ts';
export {
  UnavailablePluginExecutor,
  type PluginExecutor,
  type PluginExecutionRequest,
  type PluginInvocationMeta,
} from './executor.ts';
export * from './errors.ts';
