/**
 * Security Posture engine (issue #28).
 *
 * The pure composition: run every check over the fully-materialized deployment facts, roll the
 * weighted sub-scores up to 0–100, stamp each check's exact contribution and recoverable points,
 * derive the band and apply the critical band-cap, then build the per-instance transport table, the
 * always-on assurances, the unscored advisories, and the ranked "to reach Hardened" actions. No I/O,
 * no `Date`, no `Math.random`; instance-order-invariant — identical input yields deep-equal output.
 */

import type { NarrationTone } from '$shared/narration/index.ts';
import { ALL_CHECKS, buildTransportRows } from './checks.ts';
import { capBand, rollUp, shieldBandFor } from './policy.ts';
import {
  SECURITY_POSTURE_ENGINE_VERSION,
  type Advisory,
  type Assurance,
  type CheckResult,
  type PostureInputs,
  type ShieldReport,
  type TopAction,
} from './types.ts';

/** Severity ranking used to break recoverable-points ties when ordering the top actions. */
const TONE_SEVERITY: Record<NarrationTone, number> = { neutral: 0, info: 1, warning: 2, danger: 3 };

/** Always-on protections surfaced as verified affirmations; they contribute zero to the score. */
function buildAssurances(inputs: PostureInputs): Assurance[] {
  return [
    {
      id: 'log_redaction',
      label: 'Log redaction',
      verified: inputs.redactionVerified,
      note: inputs.redactionVerified
        ? 'Secrets are stripped from log metadata before every write (runtime-verified).'
        : 'Log redaction self-check failed — see the finding above.',
    },
    {
      id: 'arr_credentials_encrypted',
      label: 'Arr credentials encrypted at rest',
      verified: true,
      note: 'Arr API keys are stored AES-256-GCM encrypted, not in plaintext (issue #9).',
    },
  ];
}

/** Real posture notes whose exploitability Praxrr cannot observe, so they inform without a score. */
function buildAdvisories(inputs: PostureInputs): Advisory[] {
  const advisories: Advisory[] = [];
  if (!inputs.sessionCookieSecure) {
    advisories.push({
      id: 'session_cookie_secure',
      label: 'Session cookie is not marked Secure',
      detail: [
        'Praxrr sets its session cookie without the Secure flag, so if Praxrr is ever reached over plain http the session cookie can be captured on the wire.',
        'Serve Praxrr behind an HTTPS reverse proxy. This is informational, not scored — Praxrr cannot observe the scheme it is actually served over.',
      ],
      fix: { kind: 'docs', href: 'https://github.com/yandy-r/praxrr', label: 'Serve Praxrr behind HTTPS' },
    });
  }
  return advisories;
}

/** Rank the scored-below-100 checks by recoverable points (desc), then severity, then headline. */
function buildTopActions(checks: readonly CheckResult[]): TopAction[] {
  const actions: TopAction[] = [];
  for (const check of checks) {
    if (check.score === null || check.score >= 100) continue;
    const primary = check.recommendations[0];
    if (!primary) continue;
    actions.push({
      checkId: check.id,
      headline: primary.line.headline,
      tone: primary.line.tone,
      recoverablePoints: check.recoverablePoints,
      fix: primary.fix,
    });
  }
  return actions.sort((a, b) => {
    const byPoints = b.recoverablePoints - a.recoverablePoints;
    if (byPoints !== 0) return byPoints;
    const bySeverity = TONE_SEVERITY[b.tone] - TONE_SEVERITY[a.tone];
    if (bySeverity !== 0) return bySeverity;
    return a.headline.localeCompare(b.headline);
  });
}

/** Translate fully-materialized deployment facts into a deterministic {@link ShieldReport}. */
export function computeShieldReport(inputs: PostureInputs): ShieldReport {
  const rawChecks = ALL_CHECKS.map((check) => check.score(inputs));

  const weighted = rawChecks
    .filter((c): c is CheckResult & { score: number } => c.score !== null)
    .map((c) => ({ id: c.id, score: c.score, weight: c.weight }));

  const rollup = rollUp(weighted);
  const anyScored = weighted.length > 0;
  const score = anyScored ? rollup.overall : 0;
  const totalScoredWeight = weighted.reduce((sum, w) => sum + Math.max(0, w.weight), 0);

  const checks: CheckResult[] = rawChecks.map((c) => ({
    ...c,
    contribution: rollup.contributions.get(c.id) ?? 0,
    recoverablePoints:
      c.score !== null && c.score < 100 && totalScoredWeight > 0
        ? Math.round(((100 - c.score) * Math.max(0, c.weight)) / totalScoredWeight)
        : 0,
  }));

  const rolledBand = shieldBandFor(score, anyScored);
  const { band, cappedBy } = capBand(rolledBand, checks);

  return {
    engineVersion: SECURITY_POSTURE_ENGINE_VERSION,
    generatedAt: inputs.nowIso,
    score,
    band,
    bandCappedBy: cappedBy,
    checks,
    transport: buildTransportRows(inputs.instances),
    assurances: buildAssurances(inputs),
    advisories: buildAdvisories(inputs),
    topActions: buildTopActions(checks),
  };
}
