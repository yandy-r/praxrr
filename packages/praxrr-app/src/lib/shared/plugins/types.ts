/**
 * Plugin System — pure, versioned contract source of truth (issue #35, Phase-1).
 *
 * The single home of {@link PLUGIN_API_VERSION} and every closed union the plugin subsystem speaks:
 * extension-point ids, capability ids, runtime, and lifecycle states, plus the structured-clone-safe
 * {@link PluginJsonValue} and the readonly manifest / validation-result shapes. Type-only, zero I/O,
 * zero `Deno.env` — safe to import from client and server alike, mirroring `$shared/security/types.ts`.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

/**
 * The one plugin-contract API version this build speaks. Declared ONCE here. It is the registry
 * namespace key (a parser cache-safety analog) so a toggle/rollback cannot resurrect a plugin
 * validated under an incompatible contract. Adding a grantable capability bumps this constant.
 */
export const PLUGIN_API_VERSION = '1';

/** Every plugin-contract API version this build accepts. Phase-1 is strict single-version support. */
export const SUPPORTED_PLUGIN_API_VERSIONS = ['1'] as const;

/**
 * Closed union of the 9 declared extension points, in stable order. Only the two observe points
 * `config.profileCompiled.observe` and `sync.previewComputed.observe` are wired at the host seam in
 * Phase-1; the rest are declared-but-unwired.
 */
export type ExtensionPointId =
  | 'config.profileCompiled.observe'
  | 'sync.previewComputed.observe'
  | 'config.validation.observe'
  | 'sync.beforeApply.observe'
  | 'sync.afterApply.observe'
  | 'parser.releaseTitle.transform'
  | 'customFormat.condition.evaluate'
  | 'notification.dispatch.observe'
  | 'importExport.adapter';

/** How an extension point interacts with the pipeline: read-only, output-mutating, or side-effecting. */
export type ExtensionPointKind = 'observe' | 'transform' | 'provider';

/**
 * Closed union of grantable capabilities. Deny-by-construction: there is deliberately NO id for
 * credentials, auth/session, secrets, network, filesystem, database, environment, or any
 * write/mutate action — those grants are structurally unrepresentable. All Phase-1 capabilities are
 * observe-only and credential-free.
 */
export type CapabilityId =
  'read:resolved-profile' | 'read:sync-preview' | 'read:custom-format' | 'read:config-validation';

/** Plugin runtime. Closed union (reserved for a future native/QuickJS runtime); Phase-1 accepts only `wasm`. */
export type PluginRuntime = 'wasm';

/**
 * Plugin lifecycle states. Phase-1 reaches only `discovered` -> `validated` -> `registered` / `rejected`;
 * `activated` / `failed` / `unloaded` are declared for the future runtime phase.
 */
export type PluginLifecycleState =
  'discovered' | 'validated' | 'registered' | 'rejected' | 'activated' | 'failed' | 'unloaded';

/** Recursive, structured-clone-safe JSON value — the only shape allowed across the plugin seam. */
export type PluginJsonValue =
  null | boolean | number | string | readonly PluginJsonValue[] | { readonly [key: string]: PluginJsonValue };

/** Advisory host-version constraints. Phase-1 records but does not enforce these. */
export interface PluginEngines {
  readonly praxrr?: string;
}

/** A validated plugin manifest (`praxrr.plugin.json`). All fields readonly; `name` is persisted untrimmed. */
export interface PluginManifest {
  readonly apiVersion: string;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly runtime: PluginRuntime;
  readonly entry: string;
  readonly extensionPoints: readonly ExtensionPointId[];
  readonly capabilities: readonly CapabilityId[];
  readonly description?: string;
  readonly author?: string;
  readonly engines?: PluginEngines;
}

/** One field-level manifest validation error. The validator accumulates all of these in a single pass. */
export interface PluginManifestIssue {
  /** The offending field path, e.g. `apiVersion` or `extensionPoints[0]` (`''` for the whole document). */
  readonly field: string;
  /** A stable machine code, e.g. `missing`, `empty`, `unknown_capability`, `least_privilege`. */
  readonly code: string;
  /** A human-readable explanation. */
  readonly message: string;
}

/** The pure validator's result: a narrowed manifest on success, or all accumulated issues on failure. */
export type ManifestValidationResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly errors: readonly PluginManifestIssue[] };
