/**
 * Public surface of the plugin-system contract (issue #35, Phase-1).
 *
 * One import surface for the pure, versioned plugin contract: types, the capability catalog +
 * least-privilege policy, the extension-point catalog, and the fail-fast manifest validator. PURE —
 * safe to import from client and server alike, mirroring the `$shared/security` barrel.
 */

export * from './types.ts';
export {
  CAPABILITY_IDS,
  CAPABILITY_CATALOG,
  getCapability,
  checkCapabilityGrant,
  type CapabilityDescriptor,
} from './capabilities.ts';
export {
  EXTENSION_POINT_IDS,
  EXTENSION_POINTS,
  listExtensionPoints,
  getExtensionPoint,
  wiredObservePoints,
  type ExtensionPointDescriptor,
} from './extensionPoints.ts';
export { validatePluginManifest } from './validator.ts';
