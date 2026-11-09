import { logger } from '$logger/logger.ts';
import type { DashboardSource } from '$shared/dashboard/types.ts';

const SOURCE = 'HomeDashboard';

/**
 * Resolve `fn()` or reject once `ms` elapses, so a slow source (retrying parser probe, posture DNS
 * evidence) can never hold `/` hostage. The underlying work is not cancelled; its result is ignored.
 */
export function withDeadline<T>(ms: number, fn: () => Promise<T>): () => Promise<T> {
  return () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    });
    return Promise.race([fn(), deadline]).finally(() => clearTimeout(timer));
  };
}

export interface Degradable<T> {
  value: T;
  /** True when the source threw and `value` is the fallback. */
  failed: boolean;
}

/**
 * Run one dashboard data source in isolation: any throw (sync or async) is logged at warn level
 * and replaced by `fallback`, so a single failing source can never break `/`. The result reports
 * whether the fallback was used so callers can surface it as `degraded`.
 */
export async function degrade<T>(
  source: DashboardSource,
  fallback: T,
  fn: () => T | Promise<T>
): Promise<Degradable<T>> {
  try {
    return { value: await fn(), failed: false };
  } catch (error) {
    try {
      await logger.warn(`Home dashboard source "${source}" failed; degrading`, {
        source: SOURCE,
        meta: { dashboardSource: source, error: error instanceof Error ? error.message : String(error) },
      });
    } catch {
      // Logging must never turn a degraded source back into a failure.
    }
    return { value: fallback, failed: true };
  }
}
