/**
 * Canary selection
 * Pure, deterministic resolution of the canary instance and its same-`arr_type`
 * remaining cohort. A rollout is scoped to exactly one `arr_type`; there is no
 * sibling fallback anywhere in this module. No side effects (reads only) so the
 * precedence chain and least-critical heuristic are unit-testable against a
 * seeded in-memory DB.
 */

import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { getConfiguredSections } from '$sync/registry.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { CanaryArrType, CanaryResolution, CanarySettings, CanaryStartInput, CanaryTarget } from './types.ts';

/** Fail-closed outcome of `resolveCanary` when no canary is resolvable. */
export interface CanaryResolutionError {
  error: string;
  /** True when an explicit `canaryInstanceId` referenced a non-existent instance (→ 404). */
  notFound?: boolean;
}

/** Either a fully-applied resolution or a fail-closed error. */
export type CanaryResolutionResult = CanaryResolution | CanaryResolutionError;

/** Discriminates the `resolveCanary` result without leaking `'error' in x` checks. */
export function isCanaryResolutionError(result: CanaryResolutionResult): result is CanaryResolutionError {
  return 'error' in result;
}

/**
 * Narrow a loosely-typed `arr_instances.type` column to a canary-capable arr type.
 * Thin wrapper over the shared sync-preview gate: returns the arr type, or `null`
 * for placeholder/unsupported values (`all`/`chaptarr`).
 */
export function resolveSyncArrType(type: string): CanaryArrType | null {
  return isSyncPreviewArrType(type) ? type : null;
}

/** Map an eligible instance to a rollout target (denormalized name for audit survival). */
function toTarget(instance: ArrInstance): CanaryTarget {
  return { instanceId: instance.id, instanceName: instance.name };
}

/**
 * Remaining rollout targets: enabled instances of the canary's own `arr_type`,
 * excluding the canary itself. Filtered by explicit `arr_type` — a Radarr canary
 * never pulls a Sonarr instance into the cohort.
 */
export function computeRemaining(canary: ArrInstance, eligible: readonly ArrInstance[]): CanaryTarget[] {
  const cohortType = resolveSyncArrType(canary.type);
  if (cohortType === null) {
    return [];
  }

  return eligible
    .filter((instance) => instance.id !== canary.id && resolveSyncArrType(instance.type) === cohortType)
    .map(toTarget);
}

/**
 * Least-critical instance within a same-`arr_type` cohort: fewest configured
 * sections (counts configured, not enabled-only), tie-break lowest instance id.
 * Deterministic regardless of the cohort's incoming order.
 */
function selectLeastCritical(cohort: readonly ArrInstance[]): ArrInstance | undefined {
  let chosen: ArrInstance | undefined;
  let chosenSectionCount = Number.POSITIVE_INFINITY;

  for (const instance of cohort) {
    const sectionCount = getConfiguredSections(instance.id).length;
    if (sectionCount < chosenSectionCount || (sectionCount === chosenSectionCount && instance.id < chosen!.id)) {
      chosen = instance;
      chosenSectionCount = sectionCount;
    }
  }

  return chosen;
}

/**
 * Resolve the canary from an explicit id, validating existence, enablement, and
 * cohort membership. An explicit choice that does not match the rollout's
 * `arr_type` is a fail-fast error (no sibling fallback) — not a silent fall-through.
 */
function resolveExplicitCanary(arrType: CanaryArrType, canaryInstanceId: number): ArrInstance | CanaryResolutionError {
  const instance = arrInstancesQueries.getById(canaryInstanceId);
  if (!instance) {
    return { error: `Canary instance ${canaryInstanceId} not found`, notFound: true };
  }
  if (instance.enabled !== 1) {
    return { error: `Canary instance ${canaryInstanceId} is disabled` };
  }
  if (resolveSyncArrType(instance.type) !== arrType) {
    return { error: `Canary instance ${canaryInstanceId} is a ${instance.type} instance, not ${arrType}` };
  }
  return instance;
}

/**
 * Resolve the canary instance and its same-`arr_type` remaining cohort with
 * precedence: explicit `canaryInstanceId` > `default_canary_instance_id` >
 * (`auto_select` ? least-critical : none) > fail-closed. Batch size / partial
 * policy defaults are applied from `settings`. Pure — reads only.
 */
export function resolveCanary(input: CanaryStartInput, settings: CanarySettings): CanaryResolutionResult {
  const arrType = input.arrType;
  const cohort = arrInstancesQueries.getEnabled().filter((instance) => resolveSyncArrType(instance.type) === arrType);
  const cohortById = new Map(cohort.map((instance) => [instance.id, instance] as const));

  let canary: ArrInstance | undefined;

  if (input.canaryInstanceId !== undefined) {
    const explicit = resolveExplicitCanary(arrType, input.canaryInstanceId);
    if ('error' in explicit) {
      return explicit;
    }
    canary = explicit;
  } else if (settings.defaultCanaryInstanceId !== null) {
    // Default applies only within this cohort; a default set for another arr_type
    // silently falls through to auto-select (it is not an explicit choice here).
    canary = cohortById.get(settings.defaultCanaryInstanceId);
  }

  if (!canary && settings.autoSelect) {
    canary = selectLeastCritical(cohort);
  }

  if (!canary) {
    return { error: `No canary instance resolvable for ${arrType}` };
  }

  return {
    arrType,
    canary: toTarget(canary),
    remaining: computeRemaining(canary, cohort),
    sections: input.sections ?? null,
    maxBatchSize: input.maxBatchSize ?? settings.defaultMaxBatchSize,
    partialPolicy: input.partialPolicy ?? settings.defaultPartialPolicy,
    trigger: input.trigger ?? 'manual',
  };
}
