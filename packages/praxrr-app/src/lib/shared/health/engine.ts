/**
 * Config Health engine (issue #22).
 *
 * The pure composition: for each scope (whole instance + every quality profile), run the enabled
 * criteria, roll their weighted sub-scores up to 0–100, stamp each criterion's exact contribution,
 * derive the band, and flatten/de-dupe/severity-sort the suggestions. No I/O, no `Date`, no
 * `Math.random`; profile order-invariant (profiles sorted by name) — identical input yields
 * deep-equal output. Read-only: emits no scoring input and touches no PCD writer.
 */

import type { NarrationLine, NarrationTone } from '$shared/narration/index.ts';
import { ALL_CRITERIA } from './criteria.ts';
import { bandFor, rollUp, type WeightedScore } from './policy.ts';
import {
  CONFIG_HEALTH_ENGINE_VERSION,
  type CriterionResult,
  type HealthInputs,
  type HealthReport,
  type HealthScope,
  type ProfileHealth,
  type ScoredUnit
} from './types.ts';

/** Severity ranking used to order suggestions (most severe first). */
const TONE_SEVERITY: Record<NarrationTone, number> = { neutral: 0, info: 1, warning: 2, danger: 3 };

/** Flatten every criterion's suggestions, drop duplicate headlines, sort most-severe-first then A→Z. */
function collectSuggestions(criteria: readonly CriterionResult[]): NarrationLine[] {
  const seen = new Set<string>();
  const flat: NarrationLine[] = [];
  for (const criterion of criteria) {
    for (const suggestion of criterion.suggestions) {
      if (seen.has(suggestion.headline)) continue;
      seen.add(suggestion.headline);
      flat.push(suggestion);
    }
  }
  return flat.sort((a, b) => {
    const severity = TONE_SEVERITY[b.tone] - TONE_SEVERITY[a.tone];
    return severity !== 0 ? severity : a.headline.localeCompare(b.headline);
  });
}

/** Score one scope: run enabled criteria, roll up, stamp contributions, band, and suggestions. */
function scoreScope(inputs: HealthInputs, scope: HealthScope): ScoredUnit {
  const configById = new Map(inputs.criteria.map((c) => [c.id, c]));

  const results: CriterionResult[] = [];
  for (const criterion of ALL_CRITERIA) {
    const config = configById.get(criterion.id);
    // A criterion absent from settings, or explicitly disabled, does not participate at all.
    if (!config || !config.enabled) continue;
    results.push(criterion.score(inputs, scope, config));
  }

  const weighted: WeightedScore[] = results
    .filter((r): r is CriterionResult & { score: number } => r.score !== null)
    .map((r) => ({ id: r.id, score: r.score, weight: r.weight }));

  const rollup = rollUp(weighted);
  const criteria = results.map((r) => ({ ...r, contribution: rollup.contributions.get(r.id) ?? 0 }));

  const anyScored = weighted.length > 0;
  const score = anyScored ? rollup.overall : 0;
  return { score, band: bandFor(score, anyScored), criteria, suggestions: collectSuggestions(criteria) };
}

/** Translate fully-materialized instance facts into a deterministic {@link HealthReport}. */
export function computeHealthReport(inputs: HealthInputs): HealthReport {
  const overall = scoreScope(inputs, { kind: 'instance' });

  const names = [...new Set(inputs.profiles.map((p) => p.name))].sort((a, b) => a.localeCompare(b));
  const profiles: ProfileHealth[] = names.map((name) => ({ name, ...scoreScope(inputs, { kind: 'profile', profileName: name }) }));

  return {
    engineVersion: CONFIG_HEALTH_ENGINE_VERSION,
    instanceId: inputs.instanceId,
    instanceName: inputs.instanceName,
    arrType: inputs.arrType,
    generatedAt: inputs.nowIso,
    overall,
    profiles
  };
}
