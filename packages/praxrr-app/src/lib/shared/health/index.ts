/**
 * Public surface of the Config Health engine (issue #22). Consumers import contracts, the engine,
 * criteria registry, policy helpers, and {@link CONFIG_HEALTH_ENGINE_VERSION} from here. Pure — safe
 * to import from client and server alike, mirroring the `$shared/goals` / `$shared/narration` barrels.
 */

export * from './types.ts';
export { DEFAULT_CRITERIA, CRITERION_CATALOG } from './catalog.ts';
export { ALL_CRITERIA } from './criteria.ts';
export { bandFor, clamp0100, rollUp, HEALTHY_THRESHOLD, ATTENTION_THRESHOLD, type WeightedScore, type RollupResult } from './policy.ts';
export { computeHealthReport } from './engine.ts';
