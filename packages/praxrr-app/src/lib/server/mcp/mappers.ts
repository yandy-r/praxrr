/**
 * Whitelist mappers for the two entity types that carry credentials.
 *
 * These are the FIRST line of secret defense (the {@link redactSecrets} scrubber is the second):
 * they copy only known-safe fields off `ArrInstance`/`DatabaseInstance`, never the raw `api_key` /
 * `personal_access_token`. See design §8 (issue #23).
 */

import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';

export interface McpInstance {
  id: number;
  name: string;
  type: string;
  url: string;
  external_url: string | null;
  /** Non-reversible fingerprint of the API key — safe to expose; the raw key is never surfaced. */
  api_key_fingerprint: string | null;
  tags: string | null;
  enabled: boolean;
  source: 'ui' | 'env' | null;
  detected_version: string | null;
  detected_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Project an Arr instance to its credential-free wire shape (fingerprint only, never `api_key`). */
export function toMcpInstance(instance: ArrInstance): McpInstance {
  return {
    id: instance.id,
    name: instance.name,
    type: instance.type,
    url: instance.url,
    external_url: instance.external_url,
    api_key_fingerprint: instance.api_key_fingerprint,
    tags: instance.tags,
    enabled: instance.enabled === 1,
    source: instance.source ?? null,
    detected_version: instance.detected_version ?? null,
    detected_at: instance.detected_at ?? null,
    created_at: instance.created_at,
    updated_at: instance.updated_at,
  };
}

export interface McpDatabase {
  id: number;
  uuid: string;
  name: string;
  repository_url: string;
  local_path: string;
  sync_strategy: number;
  auto_pull: boolean;
  enabled: boolean;
  /** Whether a git PAT is configured — the token value itself is never surfaced. */
  has_personal_access_token: boolean;
  is_private: boolean;
  local_ops_enabled: boolean;
  git_user_name: string | null;
  git_user_email: string | null;
  conflict_strategy: 'override' | 'align' | 'ask';
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Project a PCD database instance to its credential-free wire shape. The raw
 * `personal_access_token` is dropped UNCONDITIONALLY (legacy DBs can return a real git PAT even
 * where modern DBs project `''`).
 */
export function toMcpDatabase(db: DatabaseInstance): McpDatabase {
  return {
    id: db.id,
    uuid: db.uuid,
    name: db.name,
    repository_url: db.repository_url,
    local_path: db.local_path,
    sync_strategy: db.sync_strategy,
    auto_pull: db.auto_pull === 1,
    enabled: db.enabled === 1,
    has_personal_access_token: Boolean(db.has_personal_access_token),
    is_private: db.is_private === 1,
    local_ops_enabled: db.local_ops_enabled === 1,
    git_user_name: db.git_user_name,
    git_user_email: db.git_user_email,
    conflict_strategy: db.conflict_strategy,
    last_synced_at: db.last_synced_at,
    created_at: db.created_at,
    updated_at: db.updated_at,
  };
}
