/**
 * Deterministic fingerprint of a Quality Goal's ABSOLUTE terminal intent (issue #236).
 *
 * Hashes the fully-resolved end state the plan intends — sorted custom-format scores, thresholds, and
 * the ordered quality ladder — NOT the delta-encoded op `desiredState` (which is `{from,to}` and drifts
 * once applied). Recorded on each apply/reconcile journal row for audit + correlation only; the
 * authoritative "already applied" signal is builder-emptiness (the guarded builders emit zero ops when
 * live already matches), so a fingerprint bug can never cause a wrong apply. Exact PCD config names are
 * preserved verbatim (never trimmed/normalized).
 */

import { sha256Hex } from '$pcd/snapshots/fingerprint.ts';
import type { GoalPlan } from '$shared/goals/index.ts';

/** Compute the SHA-256 hex fingerprint of a plan's absolute terminal intent. */
export async function computeIntentFingerprint(plan: GoalPlan): Promise<string> {
  const customFormatScores = [...plan.scoringInput.customFormatScores]
    .sort((a, b) => a.customFormatName.localeCompare(b.customFormatName) || a.arrType.localeCompare(b.arrType))
    .map((score) => ({ customFormatName: score.customFormatName, arrType: score.arrType, score: score.score }));

  const ladderItems = [...plan.qualityLadder.items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      name: item.name,
      type: item.type,
      enabled: item.enabled,
      upgradeUntil: item.upgradeUntil,
      position: item.position,
      resolution: item.resolution,
      mapped: item.mapped
    }));

  const canonical = JSON.stringify({
    engineVersion: plan.engineVersion,
    arrType: plan.arrType,
    thresholds: {
      minimumScore: plan.thresholds.minimumScore,
      upgradeUntilScore: plan.thresholds.upgradeUntilScore,
      upgradeScoreIncrement: plan.thresholds.upgradeScoreIncrement
    },
    customFormatScores,
    ceiling: plan.qualityLadder.ceiling,
    cutoff: plan.qualityLadder.cutoff,
    ladderItems
  });

  return sha256Hex(canonical);
}
