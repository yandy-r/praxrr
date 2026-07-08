/**
 * Server glue between the pure compatibility resolver and the app database.
 *
 * `detectAndRecordArrVersion` piggybacks on an already-established client (a sync
 * run or a connection test) to observe and persist the raw application version —
 * it never opens a new connection of its own and is always best-effort. Reading
 * back is pure: `resolveInstanceCompatibility` derives the tier and feature
 * availability from the persisted raw facts with no network I/O.
 */
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { resolveArrCompatibility, type ArrCompatibilityResult } from '$shared/arr/compatibility.ts';
import { logger } from '$logger/logger.ts';
import { getArrInstanceClient } from './arrInstanceClients.ts';
import type { ArrType } from './types.ts';
import type { BaseArrClient } from './base.ts';

/** Bounded client options for opportunistic detection probes. */
const DETECTION_CLIENT_OPTIONS = { timeout: 5000, retries: 1 } as const;

/**
 * Observe the application version via an existing client and persist it.
 *
 * Best-effort and non-fatal: on a failed status probe (or any error) it returns
 * `null` and does NOT overwrite the last-known version, so warnings stay
 * meaningful during a transient outage. On success it persists the raw version +
 * timestamp and returns the freshly resolved compatibility.
 */
export async function detectAndRecordArrVersion(
  instanceId: number,
  arrType: string,
  client: BaseArrClient
): Promise<ArrCompatibilityResult | null> {
  try {
    const status = await client.getSystemStatus();
    if (!status.ok) {
      return null;
    }

    arrInstancesQueries.setDetectedVersion(instanceId, {
      version: status.version,
      detectedAt: new Date().toISOString(),
    });

    return resolveArrCompatibility(arrType, status.version);
  } catch (error) {
    await logger.warn('Best-effort Arr version detection failed', {
      source: 'instanceCompatibility',
      meta: { instanceId, arrType, error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

/**
 * Build a short-lived client and detect the version for a freshly created
 * instance. Fully self-contained and non-blocking-safe: it swallows every error
 * (including connection failures) so it can be fire-and-forget from a create
 * action without changing that action's result or latency contract.
 */
export async function detectArrVersionBestEffort(instanceId: number, arrType: string, url: string): Promise<void> {
  try {
    const client = await getArrInstanceClient(arrType as ArrType, instanceId, url, DETECTION_CLIENT_OPTIONS);
    try {
      await detectAndRecordArrVersion(instanceId, arrType, client);
    } finally {
      client.close();
    }
  } catch (error) {
    await logger.warn('Best-effort post-create Arr version detection failed', {
      source: 'instanceCompatibility',
      meta: { instanceId, arrType, error: error instanceof Error ? error.message : String(error) },
    });
  }
}

/**
 * Resolve compatibility from an instance's persisted raw version. Pure — no
 * network I/O. A NULL `detected_version` resolves to the optimistic `unknown`
 * tier.
 */
export function resolveInstanceCompatibility(instance: ArrInstance): ArrCompatibilityResult {
  return resolveArrCompatibility(instance.type, instance.detected_version);
}

/**
 * Resolve compatibility for an instance by id, or `null` when it does not exist.
 */
export function resolveInstanceCompatibilityById(instanceId: number): ArrCompatibilityResult | null {
  const instance = arrInstancesQueries.getById(instanceId);
  return instance ? resolveInstanceCompatibility(instance) : null;
}
