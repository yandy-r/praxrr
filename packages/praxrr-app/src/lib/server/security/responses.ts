/**
 * Security Posture wire mappers (issue #28).
 *
 * Translate the internal engine types (which use `readonly` arrays and carry engine-only fields like
 * `bandCapWhenAction`) into plain, mutable wire objects for the summary route. These interfaces are
 * the runtime source of truth that `docs/api/v1/schemas/security-posture.yaml` mirrors — keep them in
 * lockstep. The route types its payload against `SecurityPostureSummaryResponse` directly (rather than
 * a generated `components['schemas'][…]`) to avoid a noisy, non-CI-gated `v1.d.ts` regen.
 */

import type { NarrationTone } from '$shared/narration/index.ts';
import type {
  Advisory,
  Assurance,
  CheckResult,
  CheckStatus,
  DnsAddressClassCounts,
  DnsEvidenceSource,
  DnsOutcome,
  DnsTransportEvidence,
  SecurityCheckId,
  ShieldArrType,
  ShieldBand,
  ShieldFix,
  ShieldRecommendation,
  ShieldReport,
  TopAction,
  TransportRow,
  TransportTier,
} from '$shared/security/index.ts';

// --- wire shapes (mutable; mirror the OpenAPI schemas) ----------------------------------------

export type WireFix =
  | { kind: 'settings-link'; href: string; label: string }
  | { kind: 'instance-link'; instanceId: number; href: string; label: string }
  | { kind: 'env-var'; name: string; docHref?: string; label: string }
  | { kind: 'docs'; href: string; label: string }
  | { kind: 'none' };

export interface WireRecommendation {
  headline: string;
  detail: string[];
  tone: NarrationTone;
  templateVersion: string;
  fix: WireFix;
}

export interface WireCheck {
  id: SecurityCheckId;
  label: string;
  score: number | null;
  weight: number;
  contribution: number;
  recoverablePoints: number;
  status: CheckStatus;
  critical: boolean;
  detail: string[];
  recommendations: WireRecommendation[];
}

export interface WireDnsAddressClassCounts {
  loopback: number;
  private: number;
  linkLocal: number;
  public: number;
  special: number;
}

export interface WireDnsTransportEvidence {
  outcome: DnsOutcome;
  source: DnsEvidenceSource;
  ipv4: WireDnsAddressClassCounts;
  ipv6: WireDnsAddressClassCounts;
  retainedCount: number;
  observedAt: string | null;
  incomplete: boolean;
  truncated: boolean;
  addressClassesChanged: boolean;
}

export interface WireTransportRow {
  instanceId: number;
  instanceName: string;
  arrType: ShieldArrType;
  scheme: 'http' | 'https';
  host: string;
  tier: TransportTier;
  score: number | null;
  status: CheckStatus;
  dns: WireDnsTransportEvidence;
  fix: WireFix;
}

export interface WireAssurance {
  id: string;
  label: string;
  verified: boolean;
  note: string;
}

export interface WireAdvisory {
  id: string;
  label: string;
  detail: string[];
  fix: WireFix;
}

export interface WireTopAction {
  checkId: SecurityCheckId;
  headline: string;
  tone: NarrationTone;
  recoverablePoints: number;
  fix: WireFix;
}

export interface SecurityPostureSummaryResponse {
  engineVersion: string;
  generatedAt: string;
  score: number;
  band: ShieldBand;
  bandCappedBy: { checkId: SecurityCheckId; label: string } | null;
  checks: WireCheck[];
  transport: WireTransportRow[];
  assurances: WireAssurance[];
  advisories: WireAdvisory[];
  topActions: WireTopAction[];
}

// --- mappers ----------------------------------------------------------------------------------

function toWireFix(fix: ShieldFix): WireFix {
  switch (fix.kind) {
    case 'settings-link':
      return { kind: 'settings-link', href: fix.href, label: fix.label };
    case 'instance-link':
      return { kind: 'instance-link', instanceId: fix.instanceId, href: fix.href, label: fix.label };
    case 'env-var':
      return fix.docHref !== undefined
        ? { kind: 'env-var', name: fix.name, docHref: fix.docHref, label: fix.label }
        : { kind: 'env-var', name: fix.name, label: fix.label };
    case 'docs':
      return { kind: 'docs', href: fix.href, label: fix.label };
    case 'none':
      return { kind: 'none' };
  }
}

function toWireRecommendation(recommendation: ShieldRecommendation): WireRecommendation {
  return {
    headline: recommendation.line.headline,
    detail: [...recommendation.line.detail],
    tone: recommendation.line.tone,
    templateVersion: recommendation.line.templateVersion,
    fix: toWireFix(recommendation.fix),
  };
}

function toWireCheck(check: CheckResult): WireCheck {
  return {
    id: check.id,
    label: check.label,
    score: check.score,
    weight: check.weight,
    contribution: check.contribution,
    recoverablePoints: check.recoverablePoints,
    status: check.status,
    critical: check.critical,
    detail: [...check.detail],
    recommendations: check.recommendations.map(toWireRecommendation),
  };
}

function toWireDnsAddressClassCounts(counts: DnsAddressClassCounts): WireDnsAddressClassCounts {
  return {
    loopback: counts.loopback,
    private: counts.private,
    linkLocal: counts.linkLocal,
    public: counts.public,
    special: counts.special,
  };
}

function toWireDnsTransportEvidence(evidence: DnsTransportEvidence): WireDnsTransportEvidence {
  return {
    outcome: evidence.outcome,
    source: evidence.source,
    ipv4: toWireDnsAddressClassCounts(evidence.ipv4),
    ipv6: toWireDnsAddressClassCounts(evidence.ipv6),
    retainedCount: evidence.retainedCount,
    observedAt: evidence.observedAt,
    incomplete: evidence.incomplete,
    truncated: evidence.truncated,
    addressClassesChanged: evidence.addressClassesChanged,
  };
}

function toWireTransportRow(row: TransportRow): WireTransportRow {
  return {
    instanceId: row.instanceId,
    instanceName: row.instanceName,
    arrType: row.arrType,
    scheme: row.scheme,
    host: row.host,
    tier: row.tier,
    score: row.score,
    status: row.status,
    dns: toWireDnsTransportEvidence(row.dns),
    fix: toWireFix(row.fix),
  };
}

function toWireAssurance(assurance: Assurance): WireAssurance {
  return { id: assurance.id, label: assurance.label, verified: assurance.verified, note: assurance.note };
}

function toWireAdvisory(advisory: Advisory): WireAdvisory {
  return { id: advisory.id, label: advisory.label, detail: [...advisory.detail], fix: toWireFix(advisory.fix) };
}

function toWireTopAction(action: TopAction): WireTopAction {
  return {
    checkId: action.checkId,
    headline: action.headline,
    tone: action.tone,
    recoverablePoints: action.recoverablePoints,
    fix: toWireFix(action.fix),
  };
}

/** One shield report → the summary response (the single security-posture endpoint payload). */
export function toSummaryResponse(report: ShieldReport): SecurityPostureSummaryResponse {
  return {
    engineVersion: report.engineVersion,
    generatedAt: report.generatedAt,
    score: report.score,
    band: report.band,
    bandCappedBy: report.bandCappedBy
      ? { checkId: report.bandCappedBy.checkId, label: report.bandCappedBy.label }
      : null,
    checks: report.checks.map(toWireCheck),
    transport: report.transport.map(toWireTransportRow),
    assurances: report.assurances.map(toWireAssurance),
    advisories: report.advisories.map(toWireAdvisory),
    topActions: report.topActions.map(toWireTopAction),
  };
}
