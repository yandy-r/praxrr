import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { FilterConfig } from '$shared/upgrades/filters.ts';
import { processUpgradeConfig } from '$lib/server/upgrades/processor.ts';
import { calculateCooldownUntil, calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';
import { isArrAppType, supportsArrWorkflow, ARR_APPS } from '$shared/arr/capabilities.ts';

const upgradeRunHandler: JobHandler = async (job) => {
  const instanceId = Number(job.payload.instanceId);
  if (!Number.isFinite(instanceId)) {
    return { status: 'failure', error: 'Invalid instance ID' };
  }

  const config = upgradeConfigsQueries.getByArrInstanceId(instanceId);
  if (!config || !config.enabled) {
    return { status: 'cancelled', output: 'Upgrade config disabled' };
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return { status: 'failure', error: 'Arr instance not found' };
  }

  if (!isArrAppType(instance.type)) {
    return { status: 'skipped', output: `Upgrades are not supported for unknown instance type: ${instance.type}` };
  }

  if (!supportsArrWorkflow(instance.type, 'upgrades')) {
    const label = ARR_APPS[instance.type].label;
    return { status: 'skipped', output: `Upgrades are not supported for ${label} instances` };
  }

  // Manual runs are only allowed in dry run (unless dev)
  const isDev = Deno.env.get('VITE_CHANNEL') === 'dev';
  if (job.source === 'manual' && !config.dryRun && !isDev) {
    return {
      status: 'failure',
      error: 'Manual runs only allowed in Dry Run mode. Enable Dry Run first.',
    };
  }

  const cooldownUntil = calculateCooldownUntil(config.lastRunAt ?? null, config.schedule);
  if (cooldownUntil) {
    const cooldownMs = new Date(cooldownUntil).getTime();
    if (Date.now() < cooldownMs) {
      if (job.source === 'manual') {
        return {
          status: 'failure',
          error: `Upgrade cooldown active until ${cooldownUntil}`,
        };
      }

      return {
        status: 'skipped',
        output: 'Upgrade cooldown active',
        rescheduleAt: cooldownUntil,
      };
    }
  }

  const enabledFilters = config.filters.filter((f: FilterConfig) => f.enabled);
  if (enabledFilters.length === 0) {
    const baseRunAt = config.lastRunAt ?? new Date().toISOString();
    const nextRun = calculateNextRunFromMinutes(baseRunAt, config.schedule);
    return {
      status: 'skipped',
      output: 'No enabled upgrade filters',
      rescheduleAt: job.source === 'schedule' ? nextRun : undefined,
    };
  }

  try {
    const log = await processUpgradeConfig(config, instance, job.source === 'manual');

    // Update filter index for round-robin mode after successful processing
    if (log.status !== 'failed' && config.filterMode === 'round_robin') {
      upgradeConfigsQueries.incrementFilterIndex(config.arrInstanceId);
    }

    // Update last run timestamp
    upgradeConfigsQueries.updateLastRun(config.arrInstanceId);

    const nextRunAt = calculateNextRunFromMinutes(new Date().toISOString(), config.schedule);

    const output = `Processed ${log.selection.actualCount} item(s) using "${log.config.selectedFilter}"`;
    if (log.status === 'failed') {
      return {
        status: 'failure',
        error: log.results.errors.join('; '),
        rescheduleAt: job.source === 'schedule' ? nextRunAt : undefined,
      };
    }

    if (log.selection.actualCount === 0) {
      return {
        status: 'skipped',
        output,
        rescheduleAt: job.source === 'schedule' ? nextRunAt : undefined,
      };
    }

    return {
      status: 'success',
      output,
      rescheduleAt: job.source === 'schedule' ? nextRunAt : undefined,
    };
  } catch (error) {
    await logger.error('Upgrade job failed', {
      source: 'UpgradeJob',
      meta: { jobId: job.id, instanceId, instanceName: instance.name, error },
    });
    return {
      status: 'failure',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

jobQueueRegistry.register('arr.upgrade', upgradeRunHandler);
