/**
 * Server plugin subsystem — public surface (issue #35, Phase-1).
 *
 * The single `$server/plugins/index.ts` import surface `hooks.server.ts` (and future call-sites) use.
 * Re-exports the host orchestrator, the apiVersion-namespaced registry, the swappable executor seam +
 * its inert default, and the full error taxonomy (trashguide `index.ts` barrel pattern).
 */

export { pluginHost, PluginHost } from './host.ts';
export { pluginRegistry, PluginRegistry, type RegisteredPlugin } from './registry.ts';
export {
  UnavailablePluginExecutor,
  type PluginExecutor,
  type PluginExecutionRequest,
  type PluginInvocationMeta,
} from './executor.ts';
export * from './errors.ts';
