/**
 * Config Health criteria (issue #22).
 *
 * One pure scorer per criterion, all implementing {@link Criterion}. The engine iterates
 * {@link ALL_CRITERIA}; adding a criterion is one entry here and never touches `engine.ts`. Each
 * scorer maps a raw signal to a 0–100 sub-score OR `null` ("cannot evaluate" — skipped, never 0),
 * plus machine-facing detail and non-judgmental {@link NarrationLine} suggestions (tone ≤ warning).
 *
 * Instance scope aggregates the profile-based criteria as the mean of their per-profile sub-scores
 * (nulls excluded). Drift is an instance-wide signal: it scores only at instance scope and returns
 * `null` at profile scope so it is never double-counted into a profile's health.
 */

import { NARRATION_TEMPLATE_VERSION, type NarrationLine, type NarrationTone } from '$shared/narration/index.ts';
import { clamp0100 } from './policy.ts';
import type { Criterion, CriterionConfig, CriterionResult, HealthInputs, HealthScope, ProfileFacts, SubScore } from './types.ts';

// --- tunable penalties (integer points) -------------------------------------------------------

const NO_CUTOFF_PENALTY = 10;
const NO_ENABLED_QUALITIES_PENALTY = 25;
const DRIFT_PER_ENTITY_PENALTY = 8;
const INCOHERENT_MIN_PENALTY = 40;
const BAD_INCREMENT_PENALTY = 20;
const NO_SCORING_SIGNAL_PENALTY = 20;
const INCOMPATIBLE_PROFILE_SCORE = 40;
const UNSUPPORTED_VERSION_PENALTY = 30;

// --- helpers ----------------------------------------------------------------------------------

function line(headline: string, detail: readonly string[], tone: NarrationTone): NarrationLine {
  return { headline, detail, tone, templateVersion: NARRATION_TEMPLATE_VERSION };
}

/** Profiles participating in a scope: all of them (instance), or the one named (profile). */
function profilesInScope(inputs: HealthInputs, scope: HealthScope): readonly ProfileFacts[] {
  if (scope.kind === 'instance') return inputs.profiles;
  const match = inputs.profiles.find((p) => p.name === scope.profileName);
  return match ? [match] : [];
}

/** Mean of the non-null sub-scores, or `null` when none could be evaluated. */
function meanScored(values: readonly SubScore[]): SubScore {
  const scored = values.filter((v): v is number => v !== null);
  if (scored.length === 0) return null;
  return clamp0100(scored.reduce((sum, v) => sum + v, 0) / scored.length);
}

function result(
  id: Criterion['id'],
  label: string,
  score: SubScore,
  config: CriterionConfig,
  detail: readonly string[],
  suggestions: readonly NarrationLine[]
): CriterionResult {
  // `contribution` is a placeholder here; the engine overwrites it from the weighted rollup.
  return { id, label, score, weight: config.weight, contribution: 0, detail, suggestions };
}

// --- completeness -----------------------------------------------------------------------------

/** Per-profile: how much of the recommended custom-format set is assigned, penalized for structural gaps. */
function scoreCompletenessProfile(p: ProfileFacts): SubScore {
  if (p.recommendedCfCount <= 0) return null;
  let score = (100 * p.assignedCfCount) / p.recommendedCfCount;
  if (!p.hasCutoff) score -= NO_CUTOFF_PENALTY;
  if (p.enabledQualityCount === 0) score -= NO_ENABLED_QUALITIES_PENALTY;
  return clamp0100(score);
}

const completeness: Criterion = {
  id: 'completeness',
  label: 'Completeness',
  score(inputs, scope, config) {
    const profiles = profilesInScope(inputs, scope);
    const score = meanScored(profiles.map(scoreCompletenessProfile));

    const evaluable = profiles.filter((p) => p.recommendedCfCount > 0);
    const totalAssigned = evaluable.reduce((sum, p) => sum + p.assignedCfCount, 0);
    const totalRecommended = evaluable.reduce((sum, p) => sum + p.recommendedCfCount, 0);
    const unassigned = Math.max(0, totalRecommended - totalAssigned);
    const noCutoff = evaluable.filter((p) => !p.hasCutoff).length;
    const noQualities = evaluable.filter((p) => p.enabledQualityCount === 0).length;

    const detail: string[] = [];
    const suggestions: NarrationLine[] = [];
    if (evaluable.length > 0) {
      detail.push(`${totalAssigned} of ${totalRecommended} custom formats assigned across ${evaluable.length} profile(s)`);
    }
    if (unassigned > 0) {
      suggestions.push(
        line(`${unassigned} custom format assignment(s) could be added`, ['Assigning scores to more custom formats sharpens release selection.'], 'info')
      );
    }
    if (noCutoff > 0) {
      suggestions.push(line(`${noCutoff} profile(s) have no upgrade cutoff`, ['Setting an upgrade-until target lets Praxrr stop upgrading once quality is good enough.'], 'info'));
    }
    if (noQualities > 0) {
      suggestions.push(line(`${noQualities} profile(s) enable no qualities`, ['A profile with no enabled qualities cannot select any release.'], 'warning'));
    }
    return result('completeness', 'Completeness', score, config, detail, suggestions);
  }
};

// --- drift ------------------------------------------------------------------------------------

const drift: Criterion = {
  id: 'drift',
  label: 'Drift',
  score(inputs, scope, config) {
    // Drift is an instance-wide signal; never fold it into a single profile's health.
    if (scope.kind === 'profile') {
      return result('drift', 'Drift', null, config, [], []);
    }
    const d = inputs.drift;

    if (d.status === 'in-sync') {
      return result('drift', 'Drift', 100, config, ['Live configuration matches the desired state'], []);
    }

    if (d.status === 'drifted') {
      // Preserved-but-stale counts (no fresh content diff) must not be scored as real drift.
      if (d.contentCheckedAt === null) {
        return result('drift', 'Drift', null, config, ['Drift status is stale — last check did not refresh the diff'], [
          line('Drift measurement is stale', ['The most recent drift check could not refresh the live diff.'], 'info')
        ]);
      }
      const magnitude = d.drifted + d.missing;
      const score = clamp0100(100 - DRIFT_PER_ENTITY_PENALTY * magnitude);
      return result('drift', 'Drift', score, config, [`${d.drifted} changed, ${d.missing} missing on Arr (${d.unmanaged} unmanaged)`], [
        line(`${magnitude} managed entit${magnitude === 1 ? 'y has' : 'ies have'} drifted from the desired configuration`, ['Run a sync to bring the instance back in line, or review the drift dashboard for details.'], 'warning')
      ]);
    }

    // never-checked / unreachable / unauthorized / error: an environment state, not a config defect.
    const reasonNote = d.status === 'never-checked' ? 'Drift has not been measured yet' : `Instance is ${d.status}${d.reason ? ` (${d.reason})` : ''}`;
    return result('drift', 'Drift', null, config, [reasonNote], [
      line(d.status === 'never-checked' ? 'Drift not yet measured' : 'Drift could not be measured', [reasonNote, 'Health is scored from the remaining criteria until drift can be checked.'], 'info')
    ]);
  }
};

// --- coherence --------------------------------------------------------------------------------

interface CoherenceEval {
  readonly score: SubScore;
  readonly incoherentMin: boolean;
  readonly badIncrement: boolean;
  readonly noSignal: boolean;
}

function evalCoherenceProfile(p: ProfileFacts): CoherenceEval {
  if (p.thresholds === null) return { score: null, incoherentMin: false, badIncrement: false, noSignal: false };
  const t = p.thresholds;
  let score = 100;
  const incoherentMin = t.upgradeUntilScore !== null && t.minimumScore > t.upgradeUntilScore;
  const badIncrement = t.upgradeUntilScore !== null && (t.upgradeScoreIncrement === null || t.upgradeScoreIncrement <= 0);
  const noSignal = p.cfScores.length > 0 && p.cfScores.every((cf) => cf.score === null || cf.score === 0);
  if (incoherentMin) score -= INCOHERENT_MIN_PENALTY;
  if (badIncrement) score -= BAD_INCREMENT_PENALTY;
  if (noSignal) score -= NO_SCORING_SIGNAL_PENALTY;
  return { score: clamp0100(score), incoherentMin, badIncrement, noSignal };
}

const coherence: Criterion = {
  id: 'coherence',
  label: 'Coherence',
  score(inputs, scope, config) {
    const profiles = profilesInScope(inputs, scope);
    const evals = profiles.map(evalCoherenceProfile);
    const score = meanScored(evals.map((e) => e.score));

    const incoherentMin = evals.filter((e) => e.incoherentMin).length;
    const badIncrement = evals.filter((e) => e.badIncrement).length;
    const noSignal = evals.filter((e) => e.noSignal).length;

    const detail: string[] = [];
    const suggestions: NarrationLine[] = [];
    if (incoherentMin > 0) {
      detail.push(`${incoherentMin} profile(s) have a minimum score above their upgrade target`);
      suggestions.push(line(`${incoherentMin} profile(s) reject everything they would upgrade to`, ['The minimum score sits above the upgrade-until score, so no release can satisfy both.'], 'warning'));
    }
    if (badIncrement > 0) {
      suggestions.push(line(`${badIncrement} profile(s) have upgrades enabled without a positive increment`, ['Set a positive upgrade score increment so upgrades can make progress.'], 'info'));
    }
    if (noSignal > 0) {
      suggestions.push(line(`${noSignal} profile(s) have no effective custom-format scores`, ['Without any non-zero custom-format score, releases are ranked by quality alone.'], 'info'));
    }
    return result('coherence', 'Coherence', score, config, detail, suggestions);
  }
};

// --- compatibility ----------------------------------------------------------------------------

function scoreCompatibilityProfile(p: ProfileFacts, versionSupported: boolean | null): SubScore {
  let score = p.compatible ? 100 : INCOMPATIBLE_PROFILE_SCORE;
  if (versionSupported === false) score -= UNSUPPORTED_VERSION_PENALTY;
  return clamp0100(score);
}

const compatibility: Criterion = {
  id: 'compatibility',
  label: 'Compatibility',
  score(inputs, scope, config) {
    const profiles = profilesInScope(inputs, scope);
    const detail: string[] = [];
    const suggestions: NarrationLine[] = [];

    let score: SubScore;
    if (profiles.length === 0) {
      // No profiles: fall back to the version tier alone, or skip when even that is unknown.
      if (inputs.versionSupported === null) {
        score = null;
      } else {
        score = inputs.versionSupported ? 100 : clamp0100(100 - UNSUPPORTED_VERSION_PENALTY);
      }
    } else {
      score = meanScored(profiles.map((p) => scoreCompatibilityProfile(p, inputs.versionSupported)));
    }

    const incompatible = profiles.filter((p) => !p.compatible);
    if (incompatible.length > 0) {
      detail.push(`${incompatible.length} profile(s) reference qualities not mapped for ${inputs.arrType}`);
      suggestions.push(
        line(`${incompatible.length} profile(s) may not be compatible with ${inputs.arrType}`, incompatible.slice(0, 5).map((p) => `Profile "${p.name}" enables qualities without a ${inputs.arrType} mapping.`), 'warning')
      );
    }
    if (inputs.versionSupported === false) {
      suggestions.push(line(`Detected ${inputs.arrType} version is outside the supported range`, [inputs.detectedVersion ? `Running version ${inputs.detectedVersion}.` : 'Upgrade the instance to a supported version for full compatibility.'], 'warning'));
    }
    return result('compatibility', 'Compatibility', score, config, detail, suggestions);
  }
};

// --- trash_alignment (Phase-1 stub) -----------------------------------------------------------

/**
 * Registered so the criteria set is complete and stable, but disabled by default and always
 * returns `null` (excluded from the rollup) until a curated TRaSH recommended set feeds it.
 */
const trashAlignment: Criterion = {
  id: 'trash_alignment',
  label: 'TRaSH Alignment',
  score(_inputs, _scope, config) {
    return result('trash_alignment', 'TRaSH Alignment', null, config, [], []);
  }
};

/** The criteria registry, in stable order. Adding a criterion is one entry here. */
export const ALL_CRITERIA: readonly Criterion[] = [completeness, drift, coherence, compatibility, trashAlignment];
