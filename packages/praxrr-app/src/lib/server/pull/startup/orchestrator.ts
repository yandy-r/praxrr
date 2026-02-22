import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import { logger } from '$logger/logger.ts';
import type { BaseArrClient } from '$arr/base.ts';
import {
  resolveStartupArrType,
  loadStartupInstanceAndClient,
  toStartupPullInstanceResult,
  type StartupAdapterResultEnvelope,
} from './handlers/shared.ts';
import { radarrStartupAdapter } from './handlers/radarr.ts';
import { sonarrStartupAdapter } from './handlers/sonarr.ts';
import { lidarrStartupAdapter } from './handlers/lidarr.ts';
import { applyStartupSelections } from './applySelections.ts';
import { buildRunSummary } from './results.ts';
import { markInstanceStartupPullActive, markInstanceStartupPullComplete } from '$sync/processor.ts';
import type {
  StartupPullArrType,
  StartupPullInstanceInput,
  StartupPullInstanceResult,
  StartupPullMatchResult,
  StartupPullRunSummary,
} from './types.ts';

const DEFAULT_CONCURRENCY = 2;

export interface StartupPullOrchestratorOptions {
  maxConcurrency?: number;
  timeoutMs?: number;
}

interface AdapterRunResult {
  readonly envelope: StartupAdapterResultEnvelope;
  readonly matches: readonly StartupPullMatchResult[];
}

type StartupProcessPipeline = (
  instance: ArrInstance,
  input: StartupPullInstanceInput,
  timeoutMs?: number
) => Promise<StartupPullInstanceResult>;

function runAdapterForType(
  arrType: StartupPullArrType,
  input: StartupPullInstanceInput,
  client: BaseArrClient
): Promise<AdapterRunResult> {
  switch (arrType) {
    case 'radarr':
      return radarrStartupAdapter.run(input, client);
    case 'sonarr':
      return sonarrStartupAdapter.run(input, client);
    case 'lidarr':
      return lidarrStartupAdapter.run(input, client);
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Startup pull timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export async function processBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

function makeFailedInstanceResult(input: StartupPullInstanceInput): StartupPullInstanceResult {
  return {
    instanceId: input.instanceId,
    instanceName: input.instanceName,
    arrType: input.arrType,
    status: 'failure',
    imported: 0,
    skippedDefault: 0,
    skippedNoMatch: 0,
    conflicted: 0,
    failed: 1,
  };
}

async function runInstancePipeline(
  instance: ArrInstance,
  input: StartupPullInstanceInput
): Promise<StartupPullInstanceResult> {
  const { client } = await loadStartupInstanceAndClient(instance);

  const adapterResult = await runAdapterForType(input.arrType, input, client);

  if (adapterResult.matches.length > 0) {
    await applyStartupSelections(input.instanceId, input.arrType, adapterResult.matches);
  }

  return toStartupPullInstanceResult(input, adapterResult.envelope);
}

export async function processInstance(
  instance: ArrInstance,
  input: StartupPullInstanceInput,
  timeoutMs?: number,
  processPipeline: StartupProcessPipeline = runInstancePipeline
): Promise<StartupPullInstanceResult> {
  markInstanceStartupPullActive(input.instanceId);

  try {
    const task = processPipeline(instance, input, timeoutMs);
    return timeoutMs != null ? await withTimeout(task, timeoutMs) : await task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`Startup pull failed for "${input.instanceName}"`, {
      source: 'StartupPull',
      meta: {
        instanceId: input.instanceId,
        arrType: input.arrType,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return makeFailedInstanceResult(input);
  } finally {
    markInstanceStartupPullComplete(input.instanceId);
  }
}

export async function runStartupPull(options?: StartupPullOrchestratorOptions): Promise<StartupPullRunSummary> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const enabledInstances = arrInstancesQueries.getEnabled();
  const arrInstances = enabledInstances.filter((i) => isArrAppType(i.type));

  if (arrInstances.length === 0) {
    await logger.info('No enabled Arr instances for startup pull', { source: 'StartupPull' });
    return buildRunSummary(runId, [], startedAt, new Date().toISOString());
  }

  const databases = databaseInstancesQueries.getAll().filter((d) => d.enabled);
  const databaseIds = databases.map((d) => d.id);

  if (databaseIds.length === 0) {
    await logger.info('No enabled databases for startup pull', { source: 'StartupPull' });
    return buildRunSummary(runId, [], startedAt, new Date().toISOString());
  }

  const inputs = arrInstances.map((instance) => ({
    instance,
    input: {
      instanceId: instance.id,
      instanceName: instance.name,
      arrType: resolveStartupArrType(instance.type),
      url: instance.url,
      databaseIds,
    } satisfies StartupPullInstanceInput,
  }));

  const concurrency = options?.maxConcurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options?.timeoutMs ?? undefined;

  await logger.info(`Starting startup pull for ${inputs.length} instance(s)`, {
    source: 'StartupPull',
    meta: {
      runId,
      instances: inputs.map((i) => ({
        id: i.input.instanceId,
        name: i.input.instanceName,
        type: i.input.arrType,
      })),
      databases: databaseIds,
      concurrency,
    },
  });

  const results = await processBatches(
    inputs,
    ({ instance, input }) => processInstance(instance, input, timeoutMs),
    concurrency
  );

  const finishedAt = new Date().toISOString();
  const summary = buildRunSummary(runId, results, startedAt, finishedAt);

  await logger.info('Startup pull completed', {
    source: 'StartupPull',
    meta: {
      runId: summary.runId,
      status: summary.status,
      imported: summary.imported,
      skippedDefault: summary.skippedDefault,
      skippedNoMatch: summary.skippedNoMatch,
      conflicted: summary.conflicted,
      failed: summary.failed,
      instanceCount: summary.instances.length,
    },
  });

  return summary;
}
