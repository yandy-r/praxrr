import { error, fail } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { upgradeConfigsQueries } from '$db/queries/upgradeConfigs.ts';
import { upgradeRunsQueries } from '$db/queries/upgradeRuns.ts';
import { jobQueueQueries } from '$db/queries/jobQueue.ts';
import { logger } from '$logger/logger.ts';
import type { FilterConfig, FilterMode } from '$shared/upgrades/filters.ts';
import { clearDryRunExclusions } from '$lib/server/upgrades/processor.ts';
import { logDryRunCacheCleared } from '$lib/server/upgrades/logger.ts';
import { scheduleUpgradeForInstance } from '$lib/server/jobs/init.ts';
import { upsertScheduledJob } from '$lib/server/jobs/queueService.ts';
import { calculateCooldownUntil } from '$lib/server/jobs/scheduleUtils.ts';
import { buildJobDisplayName } from '$lib/server/jobs/display.ts';
import { isArrAppType, supportsArrWorkflow, ARR_APPS } from '$shared/arr/capabilities.ts';
import { loadSectionModes } from '$lib/server/disclosure/loadSectionModes.ts';
import { ARR_UPGRADES_FILTER } from '$shared/disclosure/sectionKeys.ts';

function getUpgradeUnsupportedError(instanceType: string): string | null {
  if (!isArrAppType(instanceType)) {
    return `Upgrades are not supported for unknown instance type: ${instanceType}`;
  }

  if (!supportsArrWorkflow(instanceType, 'upgrades')) {
    const label = ARR_APPS[instanceType].label;
    return `Upgrades are not supported for ${label} instances`;
  }

  return null;
}

function cancelQueuedUpgrades(instanceId: number): void {
  jobQueueQueries.cancelByDedupeKey(`arr.upgrade:${instanceId}`);
  jobQueueQueries.cancelByDedupeKey(`arr.upgrade.manual:${instanceId}`);
}

function getUpgradeUnsupportedErrorAndCancel(instanceId: number, instanceType: string): string | null {
  const unsupportedError = getUpgradeUnsupportedError(instanceType);
  if (!unsupportedError) {
    return null;
  }

  cancelQueuedUpgrades(instanceId);
  return unsupportedError;
}

export const load: ServerLoad = ({ params, locals }) => {
  const id = parseInt(params.id || '', 10);

  if (isNaN(id)) {
    error(404, `Invalid instance ID: ${params.id}`);
  }

  const instance = arrInstancesQueries.getById(id);

  if (!instance) {
    error(404, `Instance not found: ${id}`);
  }

  const config = upgradeConfigsQueries.getByArrInstanceId(id);

  // Load upgrade runs from database
  const upgradeRuns = upgradeRunsQueries.getByInstanceId(id);

  const arrUpgradesSectionModes = loadSectionModes(locals.user?.id, [ARR_UPGRADES_FILTER]);

  return {
    instance,
    config: config ?? null,
    upgradeRuns,
    arrUpgradesSectionModes,
  };
};

export const actions: Actions = {
  save: async ({ params, request }) => {
    const id = parseInt(params.id || '', 10);

    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const unsupportedError = getUpgradeUnsupportedErrorAndCancel(id, instance.type);
    if (unsupportedError) {
      return fail(400, { error: unsupportedError });
    }

    const formData = await request.formData();

    try {
      const enabled = formData.get('enabled') === 'true';
      const dryRun = formData.get('dryRun') === 'true';
      const schedule = parseInt(formData.get('schedule') as string, 10) || 360;
      const filterMode = (formData.get('filterMode') as FilterMode) || 'round_robin';
      const filtersJson = formData.get('filters') as string;
      const filters: FilterConfig[] = filtersJson ? JSON.parse(filtersJson) : [];

      const configData = {
        enabled,
        dryRun,
        schedule,
        filterMode,
        filters,
      };

      upgradeConfigsQueries.upsert(id, configData);

      await logger.info(`Upgrade config saved for instance "${instance.name}"`, {
        source: 'upgrades',
        meta: { instanceId: id, instanceName: instance.name },
      });

      await logger.debug('Upgrade config details', {
        source: 'upgrades',
        meta: {
          instanceId: id,
          enabled,
          dryRun,
          schedule,
          filterMode,
          filterCount: filters.length,
          filters: filters.map((f: FilterConfig) => ({
            id: f.id,
            name: f.name,
            enabled: f.enabled,
            selector: f.selector,
            count: f.count,
            cutoff: f.cutoff,
          })),
        },
      });

      // Full filter rules for debugging
      await logger.debug('Filter rules', {
        source: 'upgrades',
        meta: {
          filters: filters.map((f: FilterConfig) => ({
            name: f.name,
            rules: f.group,
          })),
        },
      });

      scheduleUpgradeForInstance(id);

      return { success: true };
    } catch (err) {
      await logger.error('Failed to save upgrade config', {
        source: 'upgrades',
        meta: { instanceId: id, error: err },
      });
      return fail(500, { error: 'Failed to save configuration' });
    }
  },

  run: async ({ params }) => {
    const id = parseInt(params.id || '', 10);

    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (!instance) {
      return fail(404, { error: 'Instance not found' });
    }

    const unsupportedError = getUpgradeUnsupportedErrorAndCancel(id, instance.type);
    if (unsupportedError) {
      return fail(400, { error: unsupportedError });
    }

    const config = upgradeConfigsQueries.getByArrInstanceId(id);
    if (!config) {
      return fail(404, { error: 'No upgrade configuration found. Save a configuration first.' });
    }

    if (config.filters.length === 0) {
      return fail(400, { error: 'No filters configured. Add at least one filter.' });
    }

    const enabledFilters = config.filters.filter((f: FilterConfig) => f.enabled);
    if (enabledFilters.length === 0) {
      return fail(400, { error: 'No enabled filters. Enable at least one filter.' });
    }

    // Check for dev mode - in dev mode, allow manual runs even without dry run
    const isDev = import.meta.env.VITE_CHANNEL === 'dev';

    // Only allow manual runs in dry run mode (or dev mode)
    if (!config.dryRun && !isDev) {
      return fail(400, {
        error: 'Manual runs only allowed in Dry Run mode. Enable Dry Run first.',
      });
    }

    try {
      const cooldownUntil = calculateCooldownUntil(config.lastRunAt ?? null, config.schedule);
      if (cooldownUntil && Date.now() < new Date(cooldownUntil).getTime()) {
        return fail(400, {
          error: `Upgrade cooldown active until ${cooldownUntil}`,
        });
      }

      const queued = upsertScheduledJob({
        jobType: 'arr.upgrade',
        runAt: new Date().toISOString(),
        payload: { instanceId: id },
        source: 'manual',
        dedupeKey: `arr.upgrade.manual:${id}`,
      });

      await logger.info(`Manual upgrade run queued for "${instance.name}"`, {
        source: 'upgrades',
        meta: {
          jobId: queued.id,
          instanceId: id,
          instanceName: instance.name,
          displayName: buildJobDisplayName('arr.upgrade', { instanceId: id }),
          dryRun: config.dryRun,
          isDev,
        },
      });

      return { success: true, queued: true };
    } catch (err) {
      await logger.error('Manual upgrade run failed', {
        source: 'upgrades',
        meta: { instanceId: id, error: err },
      });

      return fail(500, { error: 'Upgrade run failed. Check logs for details.' });
    }
  },

  clearCache: async ({ params }) => {
    const id = parseInt(params.id || '', 10);

    if (isNaN(id)) {
      return fail(400, { error: 'Invalid instance ID' });
    }

    const instance = arrInstancesQueries.getById(id);
    if (instance) {
      const unsupportedError = getUpgradeUnsupportedErrorAndCancel(id, instance.type);
      if (unsupportedError) {
        return fail(400, { error: unsupportedError });
      }
    }

    const instanceName = instance?.name ?? `Instance ${id}`;

    const clearedIds = clearDryRunExclusions(id);
    await logDryRunCacheCleared(id, instanceName, clearedIds);

    return { success: true, cacheCleared: true };
  },
};
