/**
 * MCP handshake: protocol-version negotiation, capability advertisement, and the initialize result.
 */

import { appInfoQueries } from '$db/queries/appInfo.ts';
import {
  LATEST_PROTOCOL_VERSION,
  SERVER_NAME,
  SUPPORTED_PROTOCOL_VERSIONS,
  type InitializeResult,
  type ServerCapabilities,
} from './types.ts';

const SUPPORTED: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;

const INSTRUCTIONS =
  'Read-only Praxrr configuration and observability surface. Use the tools and resources to inspect ' +
  'Arr instances, drift status, config health, security posture, PCD databases and resolved entities, ' +
  'and sync history, and use preview_sync for a write-free dry run. No write or apply operations are exposed.';

/**
 * Echo the client's requested protocol version when supported; otherwise (absent, unsupported, or a
 * newer value) advertise the latest version and let the client decide whether to proceed.
 */
export function negotiateProtocolVersion(clientVersion: unknown): string {
  return typeof clientVersion === 'string' && SUPPORTED.includes(clientVersion)
    ? clientVersion
    : LATEST_PROTOCOL_VERSION;
}

/** Minimal, honest capabilities — no sub-features (no subscribe/listChanged/logging/completions). */
export function buildServerCapabilities(): ServerCapabilities {
  return { tools: {}, resources: {}, prompts: {} };
}

export function buildInitializeResult(clientVersion: unknown): InitializeResult {
  return {
    protocolVersion: negotiateProtocolVersion(clientVersion),
    capabilities: buildServerCapabilities(),
    serverInfo: { name: SERVER_NAME, version: appInfoQueries.getVersion() },
    instructions: INSTRUCTIONS,
  };
}
