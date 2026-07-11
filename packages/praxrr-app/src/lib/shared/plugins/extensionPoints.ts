/**
 * Plugin extension-point catalog (issue #35, Phase-1).
 *
 * Declares all 9 extension points in one array (mirroring `ALL_CHECKS`/`TOOLS`), each stamping
 * {@link PLUGIN_API_VERSION} + `interfaceVersion: '1'` and encoding the wired-vs-declared and
 * observe-vs-transform distinctions the host enforces. Only `config.profileCompiled.observe` and
 * `sync.previewComputed.observe` are wired in Phase-1. `requiredCapability` matches the pinned
 * decision-#4 map in `capabilities.ts` (a plain `CapabilityId` literal — no code import, no cycle).
 * PURE: no I/O, no `Deno.env`, client + server safe.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md (Pinned Capability <-> Extension-Point Mapping).
 */

import { PLUGIN_API_VERSION, type CapabilityId, type ExtensionPointId, type ExtensionPointKind } from './types.ts';

/** The interface version stamped onto every Phase-1 extension point (manifests do not pin per-point versions). */
const INTERFACE_VERSION = '1';

/** Static metadata for one extension point. */
export interface ExtensionPointDescriptor {
  readonly id: ExtensionPointId;
  readonly apiVersion: string;
  readonly interfaceVersion: string;
  readonly kind: ExtensionPointKind;
  /** `true` only for points the host dispatches in Phase-1; declared-but-unwired points throw if dispatched. */
  readonly wired: boolean;
  /** `true` for output-mutating/side-effecting points; no read capability may consume a mutating point. */
  readonly mutates: boolean;
  /** The capability that grants this point, or `null` when no Phase-1 capability can grant it. */
  readonly requiredCapability: CapabilityId | null;
}

/** Every extension-point id, in stable order. */
export const EXTENSION_POINT_IDS: readonly ExtensionPointId[] = [
  'config.profileCompiled.observe',
  'sync.previewComputed.observe',
  'config.validation.observe',
  'sync.beforeApply.observe',
  'sync.afterApply.observe',
  'parser.releaseTitle.transform',
  'customFormat.condition.evaluate',
  'notification.dispatch.observe',
  'importExport.adapter',
] as const;

/** The full extension-point catalog in stable order; each stamps `PLUGIN_API_VERSION` + `interfaceVersion`. */
export const EXTENSION_POINTS: readonly ExtensionPointDescriptor[] = [
  {
    id: 'config.profileCompiled.observe',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'observe',
    wired: true,
    mutates: false,
    requiredCapability: 'read:resolved-profile',
  },
  {
    id: 'sync.previewComputed.observe',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'observe',
    wired: true,
    mutates: false,
    requiredCapability: 'read:sync-preview',
  },
  {
    id: 'config.validation.observe',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'observe',
    wired: false,
    mutates: false,
    requiredCapability: 'read:config-validation',
  },
  {
    id: 'sync.beforeApply.observe',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'observe',
    wired: false,
    mutates: false,
    requiredCapability: 'read:sync-preview',
  },
  {
    id: 'sync.afterApply.observe',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'observe',
    wired: false,
    mutates: false,
    requiredCapability: 'read:sync-preview',
  },
  {
    id: 'parser.releaseTitle.transform',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'transform',
    wired: false,
    mutates: true,
    requiredCapability: null,
  },
  {
    id: 'customFormat.condition.evaluate',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'provider',
    wired: false,
    mutates: false,
    requiredCapability: 'read:custom-format',
  },
  {
    id: 'notification.dispatch.observe',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'provider',
    wired: false,
    mutates: false,
    requiredCapability: null,
  },
  {
    id: 'importExport.adapter',
    apiVersion: PLUGIN_API_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    kind: 'provider',
    wired: false,
    mutates: true,
    requiredCapability: null,
  },
];

/** All declared extension points, in stable order. */
export function listExtensionPoints(): readonly ExtensionPointDescriptor[] {
  return EXTENSION_POINTS;
}

/** Look up an extension-point descriptor by id; `undefined` for any id outside the catalog (fail-closed). */
export function getExtensionPoint(id: string): ExtensionPointDescriptor | undefined {
  return EXTENSION_POINTS.find((point) => point.id === id);
}

/** The wired observe points the host actually dispatches in Phase-1. */
export function wiredObservePoints(): readonly ExtensionPointDescriptor[] {
  return EXTENSION_POINTS.filter((point) => point.wired && point.kind === 'observe');
}
