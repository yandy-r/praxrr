/**
 * Ecosystem Security Posture / "Shield Check" — pure engine contracts (issue #28).
 *
 * Pure, versioned contracts for the shield-scoring engine. Types, enumerations, and the single
 * version constant only — no logic, no I/O, no runtime/DB imports (the sole exception is a type-only
 * import of {@link NarrationLine}, the shape recommendations render as). Safe to import from client
 * and server alike, mirroring the `$shared/health` precedent.
 *
 * The engine turns fully-materialized facts about ONE Praxrr deployment (auth mode, per-instance
 * connection transport, credential-at-rest posture) into a deterministic 0–100 {@link ShieldReport}.
 * It is read-only, audits only state Praxrr already knows, performs zero network I/O, and NEVER emits
 * a secret value — only presence booleans and host strings.
 */

import type { NarrationLine } from '$shared/narration/index.ts';

/**
 * Stamped onto every {@link ShieldReport}. Bump whenever the check set, the band thresholds, the
 * per-check score formula, OR the unscored advisory/assurance report surface changes, so a client
 * can tell a report was produced by a different engine generation. Declared here ONCE.
 */
export const SECURITY_POSTURE_ENGINE_VERSION = '4';

/**
 * Closed, versioned set of shield checks. Adding/removing/renaming a member is a breaking change —
 * bump {@link SECURITY_POSTURE_ENGINE_VERSION}. `log_redaction` is a runtime assurance: it scores
 * `null` (excluded) while redaction works and only becomes a weighted failure if the sanitizer
 * regresses, so a healthy deployment is never nagged about an always-on protection.
 */
export type SecurityCheckId =
  'control_plane_auth' | 'arr_transport' | 'app_key_at_rest' | 'credential_rotation' | 'log_redaction' | 'proxy_trust';

/** Every check id, in stable display order. */
export const CHECK_IDS: readonly SecurityCheckId[] = [
  'control_plane_auth',
  'arr_transport',
  'app_key_at_rest',
  'credential_rotation',
  'log_redaction',
  'proxy_trust',
] as const;

/** A check sub-score in `[0, 100]`, or `null` when it cannot be evaluated (skipped, NOT scored 0). */
export type SubScore = number | null;

/** Shield band derived from the 0–100 rollup. `unknown` means every check was skipped (all null). */
export type ShieldBand = 'hardened' | 'guarded' | 'exposed' | 'unknown';

/** Arr apps whose connection transport the engine grades (display only — transport is arr-agnostic). */
export type ShieldArrType = 'radarr' | 'sonarr' | 'lidarr';

/**
 * Presentation status for a check, derived from its score/severity by the scorer:
 * `pass` (100) · `advisory` (informational) · `attention` (warning) · `action` (danger) ·
 * `assured` (an always-on protection verified working) · `na` (not evaluable, score null).
 */
export type CheckStatus = 'pass' | 'advisory' | 'attention' | 'action' | 'assured' | 'na';

/** How a single Arr connection's transport is classified from its URL host (no probing). */
export type TransportTier = 'encrypted' | 'loopback' | 'docker-alias' | 'private' | 'unknown' | 'public' | 'mixed';

/** Closed address classes emitted by the pure IP classifier; unfamiliar/special space is never public by default. */
export type IpAddressClass = 'loopback' | 'private' | 'link-local' | 'public' | 'special';

/** Result of bounded DNS evidence gathering for one stored Arr hostname. */
export type DnsOutcome = 'not-applicable' | 'resolved' | 'partial' | 'timeout' | 'failed' | 'empty' | 'budget-exceeded';

/** Provenance of one DNS observation. `cache` preserves the original observation time. */
export type DnsEvidenceSource = 'none' | 'fresh' | 'cache';

/** Bounded aggregate address-class counts for one DNS record family; raw addresses never cross this contract. */
export interface DnsAddressClassCounts {
  readonly loopback: number;
  readonly private: number;
  readonly linkLocal: number;
  readonly public: number;
  readonly special: number;
}

/** Closed, redacted DNS transport evidence materialized by the server for deterministic shared grading. */
export interface DnsTransportEvidence {
  readonly outcome: DnsOutcome;
  readonly source: DnsEvidenceSource;
  readonly ipv4: DnsAddressClassCounts;
  readonly ipv6: DnsAddressClassCounts;
  readonly retainedCount: number;
  /** Original observation time; a cache hit must not refresh it. */
  readonly observedAt: string | null;
  readonly incomplete: boolean;
  readonly truncated: boolean;
  /** True only when successful observations cross the public/non-public class boundary. */
  readonly addressClassesChanged: boolean;
}

/**
 * A concrete, machine-renderable remediation target attached to a recommendation. Every warning/danger
 * recommendation MUST carry a fix that is not `none` (pinned by a test) — Shield Check never nags
 * without telling the operator exactly what to change.
 */
export type ShieldFix =
  | { readonly kind: 'settings-link'; readonly href: string; readonly label: string }
  | { readonly kind: 'instance-link'; readonly instanceId: number; readonly href: string; readonly label: string }
  | { readonly kind: 'env-var'; readonly name: string; readonly docHref?: string; readonly label: string }
  | { readonly kind: 'docs'; readonly href: string; readonly label: string }
  | { readonly kind: 'none' };

/** A remediation line (headline + detail + tone) paired with the exact fix it points to. */
export interface ShieldRecommendation {
  readonly line: NarrationLine;
  readonly fix: ShieldFix;
}

/** Static catalog metadata for one check, served alongside the report so the client hardcodes nothing. */
export interface CheckMeta {
  readonly id: SecurityCheckId;
  readonly label: string;
  readonly description: string;
}

/** What a check emits: a sub-score, its rollup bookkeeping, a display status, facts, and recommendations. */
export interface CheckResult {
  readonly id: SecurityCheckId;
  readonly label: string;
  /** `null` => "not evaluated / not applicable" (skipped, excluded from the rollup — never treated as 0). */
  readonly score: SubScore;
  /** The relative weight this check carries in the rollup (0 when it scored null / is inert). */
  readonly weight: number;
  /** Integer points this check contributed to the 0–100 total. Contributions sum EXACTLY to the total. */
  readonly contribution: number;
  /** Points the operator could recover by fixing this check: `round((100 − score) × normalizedWeight)`. */
  readonly recoverablePoints: number;
  readonly status: CheckStatus;
  /** A finding severe enough to cap the overall band regardless of the numeric average. */
  readonly critical: boolean;
  /** When this check's status is `action`, the WORST band the overall report may show. */
  readonly bandCapWhenAction: ShieldBand | null;
  /** Machine-facing bullet facts for the detail surface (never a secret value). */
  readonly detail: readonly string[];
  /** Actionable, non-shaming remediation lines, each with a concrete fix. */
  readonly recommendations: readonly ShieldRecommendation[];
}

/** One Arr connection's transport posture, classified from its stored URL (never `external_url`). */
export interface TransportRow {
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: ShieldArrType;
  readonly scheme: 'http' | 'https';
  /** Host only — the API key is never carried in the report. */
  readonly host: string;
  readonly tier: TransportTier;
  readonly score: SubScore;
  readonly status: CheckStatus;
  /** Closed DNS evidence for this row; non-candidates carry the inert not-applicable value. */
  readonly dns: DnsTransportEvidence;
  readonly fix: ShieldFix;
}

/** An always-on protection surfaced as a verified affirmation (contributes zero to the score). */
export interface Assurance {
  readonly id: string;
  readonly label: string;
  readonly verified: boolean;
  readonly note: string;
}

/** A real-but-unscored posture note whose exploitability Praxrr cannot observe (e.g. cookie Secure flag). */
export interface Advisory {
  readonly id: string;
  readonly label: string;
  readonly detail: readonly string[];
  readonly fix: ShieldFix;
}

/** A ranked "to reach Hardened" step, derived from a scored check below 100. */
export interface TopAction {
  readonly checkId: SecurityCheckId;
  readonly headline: string;
  readonly tone: NarrationLine['tone'];
  readonly recoverablePoints: number;
  readonly fix: ShieldFix;
}

/** One enabled Arr instance's connection facts (materialized by the gatherer; the engine does no I/O). */
export interface InstanceFact {
  readonly id: number;
  readonly name: string;
  readonly arrType: ShieldArrType;
  readonly url: string;
  /** Optional materialized resolver evidence. The pure engine never performs DNS I/O. */
  readonly dns?: DnsTransportEvidence;
}

/** Credential key-ring facts used to detect instances still encrypted under a retired key. */
export interface RotationFacts {
  readonly activeVersion: string;
  readonly configuredVersions: readonly string[];
  readonly instanceKeyVersions: readonly { readonly instanceId: number; readonly keyVersion: string | null }[];
}

/** How the request that triggered this report reached Praxrr (never probed; observed only). */
export type SessionTransport = 'direct-secure' | 'proxy-terminated' | 'insecure' | 'unknown';

/** PRAXRR_COOKIE_SECURE intent: mark the session cookie Secure automatically / always / never. */
export type CookieSecureMode = 'auto' | 'on' | 'off';

/** Request-derived session posture. Unscored — drives advisories/assurances only. */
export interface SessionPosture {
  readonly transport: SessionTransport;
  /** Whether THIS request's session cookie would carry Secure (resolved from mode + transport). */
  readonly cookieSecure: boolean;
  /** Configured intent, so an advisory can name the concrete env-var change. */
  readonly cookieSecureMode: CookieSecureMode;
}

/**
 * Minimal request slice the session-transport observers read. A full SvelteKit `RequestEvent`
 * satisfies it structurally; a bare `{}` (the MCP/no-request path) yields `unknown` transport.
 * Declared once so the gatherer, service, cookie helper, and transport module share one shape.
 */
export type SessionRequestContext = { request?: Request; url?: URL };

/** Fully-materialized engine input. Nothing is read lazily — the engine performs no I/O. */
export interface PostureInputs {
  readonly authMode: 'on' | 'local' | 'off' | 'oidc';
  readonly bindHost: string;
  readonly port: number;
  /** All three OIDC settings present. */
  readonly oidcConfigured: boolean;
  /** Some but not all OIDC settings present (a misconfiguration that weakens `oidc`). */
  readonly oidcPartiallyConfigured: boolean;
  readonly appApiKeyPresent: boolean;
  /** Length ≥ 32; the key value itself is NEVER carried into the engine. */
  readonly appApiKeyStrong: boolean;
  readonly instances: readonly InstanceFact[];
  readonly rotation: RotationFacts;
  /** Runtime self-verify: `sanitizeLogMeta` stripped a planted secret at gather time. */
  readonly redactionVerified: boolean;
  /** Request-derived session posture (unscored; drives the session advisory/assurance surface). */
  readonly session: SessionPosture;
  /** `TRUSTED_PROXY` was set to a non-empty value (`cfg.mode !== 'unset'`). */
  readonly trustedProxyConfigured: boolean;
  /** Number of valid CIDR ranges parsed from `TRUSTED_PROXY` (`cfg.ranges.length`). */
  readonly trustedProxyValidRangeCount: number;
  /** Raw `TRUSTED_PROXY` tokens that were ignored as malformed (safe to echo — not secrets). */
  readonly trustedProxyInvalidEntries: readonly string[];
  /** `TRUSTED_PROXY` trusts every peer (wildcard, `/0`, or a supernet ≤ /7). */
  readonly trustedProxyOverlyBroad: boolean;
  /** ISO-8601 UTC timestamp passed IN — the engine never calls `Date.now()`/`new Date()`. */
  readonly nowIso: string;
}

/** The pure contract every check implements. Deterministic, no I/O, no `Date`/`Math.random`. */
export interface SecurityCheck {
  readonly id: SecurityCheckId;
  readonly label: string;
  readonly weight: number;
  score(inputs: PostureInputs): CheckResult;
}

/** The engine's deterministic output for one deployment. Identical input yields deep-equal output. */
export interface ShieldReport {
  readonly engineVersion: string;
  /** === `inputs.nowIso`. */
  readonly generatedAt: string;
  readonly score: number;
  readonly band: ShieldBand;
  /** Set when a critical `action` finding lowered the band below the numeric average would allow. */
  readonly bandCappedBy: { readonly checkId: SecurityCheckId; readonly label: string } | null;
  readonly checks: readonly CheckResult[];
  readonly transport: readonly TransportRow[];
  readonly assurances: readonly Assurance[];
  readonly advisories: readonly Advisory[];
  /** Recommendations ranked by recoverable points (desc), then severity. */
  readonly topActions: readonly TopAction[];
}
