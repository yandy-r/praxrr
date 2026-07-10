/**
 * Security Posture engine (issue #28).
 *
 * The pure composition: run every check over the fully-materialized deployment facts, roll the
 * weighted sub-scores up to 0–100, stamp each check's exact contribution and recoverable points,
 * derive the band and apply the critical band-cap, then build the per-instance transport table, the
 * always-on assurances, the unscored advisories, and the ranked "to reach Hardened" actions. No I/O,
 * no `Date`, no `Math.random`; instance-order-invariant — identical input yields deep-equal output.
 */

import { TONE_SEVERITY } from '$shared/narration/index.ts';
import { ALL_CHECKS, buildTransportRows } from './checks.ts';
import { capBand, rollUp, shieldBandFor } from './policy.ts';
import {
  SECURITY_POSTURE_ENGINE_VERSION,
  type Advisory,
  type Assurance,
  type CheckResult,
  type PostureInputs,
  type SessionPosture,
  type ShieldFix,
  type ShieldReport,
  type TopAction,
} from './types.ts';

/** Always-on protections surfaced as verified affirmations; they contribute zero to the score. */
function buildAssurances(inputs: PostureInputs): Assurance[] {
  const assurances: Assurance[] = [
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
    {
      id: 'session_secret',
      label: 'Session secret',
      verified: true,
      note: 'Session identifiers are opaque, server-side, randomly generated tokens; the cookie carries no signing secret, so there is no session secret to be missing, weak, or leaked.',
    },
    {
      id: 'session_cookie_protections',
      label: 'Session cookie protections',
      verified: true,
      note: 'The session cookie is HttpOnly (mitigates XSS token theft) and SameSite=Lax (mitigates cross-site request forgery).',
    },
  ];
  if (inputs.session.transport === 'direct-secure' && inputs.session.cookieSecure) {
    assurances.push({
      id: 'session_cookie_secure',
      label: 'Session cookie Secure',
      verified: true,
      note: 'For a request served over direct HTTPS, the session cookie is marked Secure.',
    });
  }
  return assurances;
}

/** Session-cookie env-var remediation, always naming the concrete PRAXRR_COOKIE_SECURE change to make. */
function cookieSecureEnvFix(label: string): ShieldFix {
  return { kind: 'env-var', name: 'PRAXRR_COOKIE_SECURE', label };
}

/**
 * At most one `session_cookie_transport` advisory, keyed on the request-derived {@link SessionPosture}.
 * Fixed-literal copy per (transport × cookieSecure); every emitted advisory carries a non-`none` fix.
 * `direct-secure` + Secure emits no advisory — that state is affirmed by the `session_cookie_secure`
 * assurance instead. No host, header value, or secret substring ever appears in the copy.
 */
function sessionCookieTransportAdvisory(session: SessionPosture): Advisory | null {
  const id = 'session_cookie_transport';
  const label = 'Session cookie transport posture';
  switch (session.transport) {
    case 'direct-secure':
      if (session.cookieSecure) return null;
      return {
        id,
        label,
        detail: [
          'PRAXRR_COOKIE_SECURE=off disables Secure even though this request arrived over direct HTTPS; the session cookie is sent without Secure.',
        ],
        fix: cookieSecureEnvFix('Set PRAXRR_COOKIE_SECURE=auto to mark the session cookie Secure over HTTPS'),
      };
    case 'proxy-terminated':
      if (session.cookieSecure) {
        return {
          id,
          label,
          detail: [
            'For a request arriving via a proxy reporting X-Forwarded-Proto: https, the session cookie is sent Secure. Praxrr cannot verify the proxy terminates TLS externally (see #228), so this is reported as trusted-termination, not confirmed-secure.',
          ],
          fix: cookieSecureEnvFix('Set PRAXRR_COOKIE_SECURE=on to pin Secure if this proxy is trusted'),
        };
      }
      return {
        id,
        label,
        detail: ['PRAXRR_COOKIE_SECURE=off while a proxy reports HTTPS; the session cookie is sent without Secure.'],
        fix: cookieSecureEnvFix('Set PRAXRR_COOKIE_SECURE=auto or on'),
      };
    case 'insecure':
      if (session.cookieSecure) {
        return {
          id,
          label,
          detail: [
            'PRAXRR_COOKIE_SECURE=on but this request arrived over plaintext HTTP — browsers drop the Secure cookie, so login fails here. Set PRAXRR_COOKIE_SECURE=auto, or serve Praxrr behind HTTPS.',
          ],
          fix: cookieSecureEnvFix('Set PRAXRR_COOKIE_SECURE=auto'),
        };
      }
      return {
        id,
        label,
        detail: [
          'For a request arriving over plaintext HTTP, the session cookie is not marked Secure and crosses this observed ingress hop unprotected. Praxrr grades only this ingress hop; it cannot observe any upstream edge.',
        ],
        fix: {
          kind: 'docs',
          href: 'https://github.com/yandy-r/praxrr',
          label: 'Serve Praxrr behind HTTPS (PRAXRR_COOKIE_SECURE=auto then marks it Secure automatically)',
        },
      };
    case 'unknown':
      if (session.cookieSecure) {
        return {
          id,
          label,
          detail: [
            'PRAXRR_COOKIE_SECURE=on; transport is not observable in this context. If any request path is plaintext HTTP, the Secure cookie is dropped there and login fails.',
          ],
          fix: cookieSecureEnvFix('Set PRAXRR_COOKIE_SECURE=auto'),
        };
      }
      return {
        id,
        label,
        detail: [
          'Request transport could not be observed in this context (e.g. the MCP resource/tool path, which carries no HTTP request). The session cookie is treated as not Secure and never assumed safe. If Praxrr is served over HTTPS, set PRAXRR_COOKIE_SECURE=on.',
        ],
        fix: cookieSecureEnvFix('Set PRAXRR_COOKIE_SECURE=on if Praxrr is served over HTTPS'),
      };
  }
}

/** Real posture notes whose exploitability Praxrr cannot observe, so they inform without a score. */
function buildAdvisories(inputs: PostureInputs): Advisory[] {
  const advisories: Advisory[] = [];
  const transportAdvisory = sessionCookieTransportAdvisory(inputs.session);
  if (transportAdvisory) advisories.push(transportAdvisory);
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
