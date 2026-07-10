import { jobQueueRegistry } from '../queueRegistry.ts';
import type { JobHandler } from '../queueTypes.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { FilterConfig } from '$shared/upgrades/filters.ts';
import { processUpgradeConfig } from '$lib/server/upgrades/processor.ts';
import { calculateCooldownUntil, calculateNextRunFromMinutes } from '../scheduleUtils.ts';
import { logger } from '$logger/logger.ts';
import { classifyJobFailure } from '../evidence.ts';
import { isArrAppType, supportsArrWorkflow, ARR_APPS } from '$shared/arr/capabilities.ts';

const upgradeRunHandler: JobHandler = async (job) => {
  const instanceId = Number(job.payload.instanceId);
  if (!Number.isFinite(instanceId)) {
    return { status: 'failure', failureCode: 'invalidPayload' };
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return { status: 'failure', failureCode: 'targetNotFound' };
  }

  if (!isArrAppType(instance.type)) {
    await logger.debug('Upgrade job skipped: unknown instance type', {
      source: 'UpgradeJob',
      meta: { jobId: job.id, instanceId, instanceType: instance.type },
    });
    return { status: 'skipped', decision: 'Upgrades not supported for this instance type' };
  }

  const upgradesSupported = supportsArrWorkflow(instance.type, 'upgrades');
  // Keep unsupported Lidarr messaging explicit even when a stale/disabled config exists.
  if (!upgradesSupported && instance.type === 'lidarr') {
    const label = ARR_APPS[instance.type].label;
    return { status: 'skipped', decision: `Upgrades are not supported for ${label} instances` };
  }

  const config = upgradeConfigsQueries.getByArrInstanceId(instanceId);
  if (!config || !config.enabled) {
    return { status: 'cancelled', decision: 'Upgrade config disabled' };
  }

  if (!upgradesSupported) {
    const label = ARR_APPS[instance.type].label;
    return { status: 'skipped', decision: `Upgrades are not supported for ${label} instances` };
  }

  // Manual runs are only allowed in dry run (unless dev)
  const isDev = Deno.env.get('VITE_CHANNEL') === 'dev';
  if (job.source === 'manual' && !config.dryRun && !isDev) {
    return {
      status: 'failure',
      failureCode: 'precondition',
      decision: 'Manual runs are only allowed in Dry Run mode',
      recovery: 'Enable Dry Run in the upgrade settings, then run again.',
    };
  }

  const cooldownUntil = calculateCooldownUntil(config.lastRunAt ?? null, config.schedule);
  if (cooldownUntil) {
    const cooldownMs = new Date(cooldownUntil).getTime();
    if (Date.now() < cooldownMs) {
      if (job.source === 'manual') {
        return {
          status: 'failure',
          failureCode: 'precondition',
          decision: 'Upgrade cooldown active',
          recovery: 'Wait for the cooldown window to elapse, then run the upgrade again.',
        };
      }

      return {
        status: 'skipped',
        decision: 'Upgrade cooldown active',
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
      decision: 'No enabled upgrade filters',
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
      await logger.error('Upgrade job reported processing errors', {
        source: 'UpgradeJob',
        meta: { jobId: job.id, instanceId, instanceName: instance.name, errors: log.results.errors },
      });
      return {
        status: 'failure',
        failureCode: 'upstream',
        output,
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
    return { status: 'failure', failureCode: classifyJobFailure(error) };
  }
};

jobQueueRegistry.register('arr.upgrade', upgradeRunHandler);
