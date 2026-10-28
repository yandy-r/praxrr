import type { EntityType } from '$shared/pcd/portable.ts';

import type { components } from '$api/v1.d.ts';
import {
  BUNDLE_MAX_JSON_BYTES,
  validateBundle,
  type PcdBundle,
  type BundleCollisionPolicy,
} from '$shared/pcd/bundle.ts';

export type { PcdBundle };
export type CollisionPolicy = BundleCollisionPolicy;
export type BundleReport = components['schemas']['PcdBundleImportReport'];
export interface BundleImportResponse {
  status: number;
  report: BundleReport;
  body: Record<string, unknown>;
}
export type BundleImportOptions = Omit<components['schemas']['PcdBundleImportRequest'], 'bundle'> & {
  bundle: PcdBundle;
};
export interface BundleTarget {
  id: number;
  name: string;
  has_personal_access_token?: boolean;
  local_ops_enabled?: number | boolean;
  enabled?: number | boolean;
}
export const MAX_BUNDLE_BYTES = BUNDLE_MAX_JSON_BYTES;
// Compact bundle plus the request envelope must remain under the server limit.
export const MAX_IMPORT_BUNDLE_BYTES = BUNDLE_MAX_JSON_BYTES - 64 * 1024;

export function parseBundle(text: string): PcdBundle {
  if (new TextEncoder().encode(text).byteLength > MAX_BUNDLE_BYTES) {
    throw new Error('Bundle must be no larger than 5 MiB');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON. Paste or upload a JSON bundle.');
  }
  const result = validateBundle(value);
  if ('error' in result) throw new Error(result.error);
  return result.bundle;
}

export async function exportBundle(databaseId: number, entityType: EntityType, name: string): Promise<PcdBundle> {
  const params = new URLSearchParams({
    databaseId: String(databaseId),
    entityType,
    name,
    includeDependencies: 'true',
    format: 'bundle',
  });
  const response = await fetch(`/api/v1/pcd/export?${params}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Bundle export failed');
  return parseBundle(JSON.stringify(body.bundle));
}

export async function downloadBundle(databaseId: number, entityType: EntityType, name: string): Promise<void> {
  const bundle = await exportBundle(databaseId, entityType, name);
  const compact = JSON.stringify(bundle);
  if (new TextEncoder().encode(compact).byteLength > MAX_IMPORT_BUNDLE_BYTES) {
    throw new Error('Bundle is too large to import (5 MiB request limit)');
  }
  const url = URL.createObjectURL(new Blob([compact], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  const safeName = Array.from(name, (char) =>
    char.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(char) ? '_' : char
  ).join('');
  anchor.download = `${entityType}-${safeName}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function importBundle(options: BundleImportOptions): Promise<BundleImportResponse> {
  const response = await fetch('/api/v1/pcd/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const body = await response.json();
  const report = body.report ?? body;
  if (
    typeof report.dryRun === 'boolean' &&
    typeof report.applied === 'boolean' &&
    Array.isArray(report.outcomes) &&
    Array.isArray(report.missingReferences) &&
    Array.isArray(report.errors)
  ) {
    return {
      status: response.status,
      report: { ...report, rolledBack: report.rolledBack ?? body.rolledBack } as BundleReport,
      body,
    };
  }
  throw new Error(body.error || 'Bundle import failed');
}

export async function listBundleTargets(): Promise<BundleTarget[]> {
  const response = await fetch('/api/databases');
  const body = await response.json();
  if (!response.ok || !Array.isArray(body)) throw new Error(body.error || 'Could not load databases');
  return body.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('id' in entry) ||
      !Number.isSafeInteger(entry.id) ||
      !('name' in entry) ||
      typeof entry.name !== 'string'
    ) {
      throw new Error('Invalid database list response');
    }
    return {
      id: entry.id as number,
      name: entry.name,
      has_personal_access_token:
        'has_personal_access_token' in entry &&
        (entry.has_personal_access_token === true || entry.has_personal_access_token === 1),
      local_ops_enabled: 'local_ops_enabled' in entry && !!entry.local_ops_enabled,
      enabled: 'enabled' in entry ? !!entry.enabled : true,
    };
  });
}

export function reportCanApply(report: BundleReport | null): boolean {
  return !!report && report.dryRun && !report.errors.length && !report.missingReferences.length;
}
