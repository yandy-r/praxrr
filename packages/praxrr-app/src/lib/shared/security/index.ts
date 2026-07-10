/**
 * Public surface of the Security Posture engine (issue #28). Consumers import contracts, the engine,
 * the check registry, catalog, policy helpers, and {@link SECURITY_POSTURE_ENGINE_VERSION} from here.
 * Pure — safe to import from client and server alike, mirroring the `$shared/health` barrel.
 */

export * from './types.ts';
export { CHECK_CATALOG } from './catalog.ts';
export { ALL_CHECKS, classifyHost, buildTransportRows } from './checks.ts';
export { shieldBandFor, capBand, clamp0100, rollUp, HARDENED_THRESHOLD, GUARDED_THRESHOLD } from './policy.ts';
export { computeShieldReport } from './engine.ts';
export {
  parseTrustedProxy,
  isTrustedProxyPeer,
  type CidrRange,
  type TrustedProxyConfig,
  type TrustedProxyMode,
} from './trustedProxy.ts';
