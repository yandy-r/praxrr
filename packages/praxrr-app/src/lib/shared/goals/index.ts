/**
 * Public surface of the Quality Goals engine (issue #20). Consumers import contracts, the engine,
 * presets, and {@link GOALS_ENGINE_VERSION} from here. Pure — safe to import from client and server.
 */

export * from './types.ts';
export * from './presets.ts';
export {
  classifyCustomFormat,
  detectResolutionLevel,
  CATEGORY_RULES,
  FALLBACK_RULE_ID,
  EXCLUDED_RULE_ID,
} from './classifier.ts';
export type { ResolutionLevel, CfClassification } from './classifier.ts';
export {
  CATEGORY_POLICY,
  LIDARR_AUDIO_POLICY,
  UNWANTED_SCORE,
  CEILING_ABOVE_PENALTY,
  CEILING_MATCH_BONUS,
  CEILING_BELOW_BONUS,
  scoreCategory,
  ceilingGate,
  computeThresholds,
  signedWeight,
  strictness,
  ceilingLevel,
} from './policy.ts';
export { computeGoalPlan, diffGoalPlans } from './engine.ts';
