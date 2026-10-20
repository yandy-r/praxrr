/**
 * API token scopes and client-safe token types.
 * Shared by the auth middleware, MCP layer, and Settings → Security UI.
 */

export const API_TOKEN_SCOPES = ['read', 'mcp', 'sync:apply', 'admin'] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const API_TOKEN_SCOPE_INFO: Record<ApiTokenScope, { label: string; description: string }> = {
  read: {
    label: 'Read',
    description: 'Read-only access to /api/v1 (GET requests and dry-run previews).',
  },
  mcp: {
    label: 'MCP',
    description: 'Use the MCP server at /api/v1/mcp.',
  },
  'sync:apply': {
    label: 'Sync apply',
    description: 'Apply sync previews, goals, snapshot rollbacks, and trigger syncs.',
  },
  admin: {
    label: 'Admin',
    description: 'Full API access, including every other scope.',
  },
};

export const API_TOKEN_NAME_MAX_LENGTH = 64;

/** Expiry choices in days; `null` means the token never expires. */
export const API_TOKEN_EXPIRY_OPTIONS = [null, 30, 90, 365] as const;

export type ApiTokenExpiryOption = (typeof API_TOKEN_EXPIRY_OPTIONS)[number];

export function isApiTokenScope(value: unknown): value is ApiTokenScope {
  return typeof value === 'string' && (API_TOKEN_SCOPES as readonly string[]).includes(value);
}

/** `admin` implies every scope; otherwise exact membership. */
export function hasScope(granted: readonly ApiTokenScope[], required: ApiTokenScope): boolean {
  return granted.includes('admin') || granted.includes(required);
}

export type ApiTokenStatus = 'active' | 'expired' | 'revoked';

/** Client-safe view of a token; never contains the hash or secret. */
export interface ApiTokenSummary {
  id: number;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  isLegacy: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: ApiTokenStatus;
}
