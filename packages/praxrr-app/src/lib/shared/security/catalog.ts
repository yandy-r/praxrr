/**
 * Security Posture static catalog (issue #28).
 *
 * The human-facing check catalog (id/label/description). Pure static metadata served alongside the
 * report so the client hardcodes nothing. There is no settings endpoint — checks and weights are
 * fixed in code (a user must not be able to down-weight "auth is off" to fake a green score).
 */

import type { CheckMeta } from './types.ts';

/** Human-facing catalog, one entry per registered check, in stable display order. */
export const CHECK_CATALOG: readonly CheckMeta[] = [
  {
    id: 'control_plane_auth',
    label: 'Control-plane authentication',
    description: "Whether Praxrr's own UI and API require authentication (the AUTH mode) and how the server is bound.",
  },
  {
    id: 'arr_transport',
    label: 'Arr connection transport',
    description:
      'Whether each Arr instance is reached over TLS (https) or plaintext http, and how exposed the target host is.',
  },
  {
    id: 'app_key_at_rest',
    label: 'Praxrr API key at rest',
    description:
      'Whether the plaintext-stored Praxrr API key is a live authentication vector in the current AUTH mode.',
  },
  {
    id: 'credential_rotation',
    label: 'Arr credential key freshness',
    description:
      'Whether any Arr credential is still encrypted under a retired master-key version after a key rotation.',
  },
  {
    id: 'log_redaction',
    label: 'Log redaction',
    description: 'A runtime self-check that secrets are stripped from logs before they are written (issue #8).',
  },
  {
    id: 'proxy_trust',
    label: 'Trusted proxy allowlist',
    description:
      'Whether forwarded client IPs (X-Forwarded-For) are trusted only from an explicit TRUSTED_PROXY allowlist, so a spoofed header from an untrusted peer cannot drive an AUTH=local bypass.',
  },
] as const;
