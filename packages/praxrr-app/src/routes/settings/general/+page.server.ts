import type { Actions, RequestEvent } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { logSettingsQueries } from '$db/queries/logSettings.ts';
import { backupSettingsQueries } from '$db/queries/backupSettings.ts';
import { aiSettingsQueries } from '$db/queries/aiSettings.ts';
import { tmdbSettingsQueries } from '$db/queries/tmdbSettings.ts';
import { generalSettingsQueries } from '$db/queries/generalSettings.ts';
import { logSettings } from '$logger/settings.ts';
import { logger } from '$logger/logger.ts';
import { scheduleBackupJobs, scheduleLogCleanup } from '$lib/server/jobs/init.ts';
import { maskApiKey } from '$shared/utils/masking.ts';

export const load = () => {
  const logSetting = logSettingsQueries.get();
  const backupSetting = backupSettingsQueries.get();
  const aiSetting = aiSettingsQueries.get();
  const tmdbSetting = tmdbSettingsQueries.get();
  const generalSetting = generalSettingsQueries.get();

  if (!logSetting) {
    throw new Error('Log settings not found in database');
  }

  if (!backupSetting) {
    throw new Error('Backup settings not found in database');
  }

  if (!aiSetting) {
    throw new Error('AI settings not found in database');
  }

  if (!tmdbSetting) {
    throw new Error('TMDB settings not found in database');
  }

  if (!generalSetting) {
    throw new Error('General settings not found in database');
  }

  return {
    logSettings: {
      retention_days: logSetting.retention_days,
      min_level: logSetting.min_level,
      enabled: logSetting.enabled === 1,
      file_logging: logSetting.file_logging === 1,
      console_logging: logSetting.console_logging === 1,
    },
    backupSettings: {
      schedule: backupSetting.schedule,
      retention_days: backupSetting.retention_days,
      enabled: backupSetting.enabled === 1,
      include_database: backupSetting.include_database === 1,
      compression_enabled: backupSetting.compression_enabled === 1,
    },
    aiSettings: {
      enabled: aiSetting.enabled === 1,
      api_url: aiSetting.api_url,
      api_key_masked: maskApiKey(aiSetting.api_key),
      has_api_key: aiSetting.api_key.length > 0,
      model: aiSetting.model,
    },
    tmdbSettings: {
      api_key_masked: maskApiKey(tmdbSetting.api_key),
      has_api_key: tmdbSetting.api_key.length > 0,
    },
    generalSettings: {
      apply_default_delay_profiles: generalSetting.apply_default_delay_profiles === 1,
    },
  };
};

export const actions: Actions = {
  updateLogs: async ({ request }: RequestEvent) => {
    const formData = await request.formData();

    // Parse form data
    const retentionDays = parseInt(formData.get('retention_days') as string);
    const minLevel = formData.get('min_level') as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    const enabled = formData.get('enabled') === 'on';
    const fileLogging = formData.get('file_logging') === 'on';
    const consoleLogging = formData.get('console_logging') === 'on';

    // Validate
    if (isNaN(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      return fail(400, { error: 'Retention days must be between 1 and 365' });
    }

    if (!minLevel || !['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(minLevel)) {
      return fail(400, { error: 'Invalid minimum log level' });
    }

    // Update settings
    const updated = logSettingsQueries.update({
      retentionDays,
      minLevel,
      enabled,
      fileLogging,
      consoleLogging,
    });

    if (!updated) {
      await logger.error('Failed to update log settings', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to update settings' });
    }

    // Reload settings into cache
    logSettings.reload();
    scheduleLogCleanup();

    await logger.info('Log settings updated', {
      source: 'settings/general',
      meta: {
        retentionDays,
        minLevel,
        enabled,
        fileLogging,
        consoleLogging,
      },
    });

    return { success: true };
  },

  resetLogs: async () => {
    const reset = logSettingsQueries.reset();

    if (!reset) {
      await logger.error('Failed to reset log settings', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to reset settings' });
    }

    // Reload settings into cache
    logSettings.reload();
    scheduleLogCleanup();

    await logger.info('Log settings reset to defaults', {
      source: 'settings/general',
    });

    return { success: true, reset: true };
  },

  updateBackups: async ({ request }: RequestEvent) => {
    const formData = await request.formData();

    // Parse form data
    const schedule = formData.get('schedule') as string;
    const retentionDays = parseInt(formData.get('retention_days') as string);
    const enabled = formData.get('enabled') === 'on';
    const compressionEnabled = formData.get('compression_enabled') === 'on';

    // Validate
    if (!schedule) {
      return fail(400, { error: 'Schedule is required' });
    }

    if (isNaN(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      return fail(400, { error: 'Retention days must be between 1 and 365' });
    }

    // Update settings
    const updated = backupSettingsQueries.update({
      schedule,
      retentionDays,
      enabled,
      compressionEnabled,
    });

    if (!updated) {
      await logger.error('Failed to update backup settings', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to update settings' });
    }

    await logger.info('Backup settings updated', {
      source: 'settings/general',
      meta: {
        schedule,
        retentionDays,
        enabled,
        compressionEnabled,
      },
    });

    scheduleBackupJobs();

    return { success: true };
  },

  updateAI: async ({ request }: RequestEvent) => {
    const formData = await request.formData();

    // Parse form data. The UI always submits api_url/model (hidden inputs while AI is disabled);
    // absent fields (non-UI clients) mean "keep the stored value", never "reset to defaults".
    const enabled = formData.get('enabled') === 'on';
    const apiUrl = formData.has('api_url') ? String(formData.get('api_url')) : undefined;
    const model = formData.has('model') ? String(formData.get('model')) : undefined;
    // The key input always starts empty; an empty submission keeps the stored key.
    // Clearing the stored key is an explicit action (clearAIKey).
    const apiKeyInput = String(formData.get('api_key') ?? '').trim();
    const apiKey = apiKeyInput.length > 0 ? apiKeyInput : undefined;

    // Validate against the effective (submitted or stored) values
    if (enabled) {
      const stored = aiSettingsQueries.get();
      if (!(apiUrl ?? stored?.api_url)) {
        return fail(400, { error: 'API URL is required when AI is enabled' });
      }
      if (!(model ?? stored?.model)) {
        return fail(400, { error: 'Model is required when AI is enabled' });
      }
    }

    // Update settings
    const updated = aiSettingsQueries.update({ enabled, apiUrl, apiKey, model });

    if (!updated) {
      await logger.error('Failed to update AI settings', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to update settings' });
    }

    await logger.info('AI settings updated', {
      source: 'settings/general',
      meta: {
        enabled,
        apiUrl,
        model,
        // Never log the key itself
        apiKeyUpdated: apiKey !== undefined,
      },
    });

    return { success: true };
  },

  clearAIKey: async () => {
    if (!aiSettingsQueries.update({ apiKey: '' })) {
      await logger.error('Failed to clear AI API key', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to clear AI API key' });
    }

    await logger.info('AI API key cleared', {
      source: 'settings/general',
    });

    return { success: true, cleared: true };
  },

  revealTMDB: async () => {
    try {
      const tmdbSetting = tmdbSettingsQueries.get();

      if (!tmdbSetting || tmdbSetting.api_key.length === 0) {
        return fail(404, { error: 'TMDB API key is not configured' });
      }

      return { revealedTmdbKey: tmdbSetting.api_key };
    } catch {
      await logger.error('Failed to reveal TMDB API key', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Unable to retrieve TMDB API key' });
    }
  },

  revealAI: async () => {
    try {
      const aiSetting = aiSettingsQueries.get();

      if (!aiSetting || aiSetting.api_key.length === 0) {
        return fail(404, { error: 'AI API key is not configured' });
      }

      return { revealedAiKey: aiSetting.api_key };
    } catch {
      await logger.error('Failed to reveal AI API key', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Unable to retrieve AI API key' });
    }
  },

  updateTMDB: async ({ request }: RequestEvent) => {
    const formData = await request.formData();

    // The token input always starts empty; an empty submission keeps the stored token and
    // succeeds without writing. Clearing the stored token is an explicit action (clearTMDBKey).
    const apiKey = String(formData.get('api_key') ?? '').trim();
    if (apiKey.length === 0) {
      return { success: true };
    }

    // Update settings
    const updated = tmdbSettingsQueries.update({
      apiKey,
    });

    if (!updated) {
      await logger.error('Failed to update TMDB settings', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to update settings' });
    }

    await logger.info('TMDB settings updated', {
      source: 'settings/general',
    });

    return { success: true };
  },

  clearTMDBKey: async () => {
    if (!tmdbSettingsQueries.update({ apiKey: '' })) {
      await logger.error('Failed to clear TMDB API key', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to clear TMDB API key' });
    }

    await logger.info('TMDB API key cleared', {
      source: 'settings/general',
    });

    return { success: true, cleared: true };
  },

  updateArrDefaults: async ({ request }: RequestEvent) => {
    const formData = await request.formData();

    // Parse form data
    const applyDefaultDelayProfiles = formData.get('apply_default_delay_profiles') === 'on';

    // Update settings
    const updated = generalSettingsQueries.update({
      applyDefaultDelayProfiles,
    });

    if (!updated) {
      await logger.error('Failed to update arr default settings', {
        source: 'settings/general',
      });
      return fail(500, { error: 'Failed to update settings' });
    }

    await logger.info('Arr default settings updated', {
      source: 'settings/general',
      meta: { applyDefaultDelayProfiles },
    });

    return { success: true };
  },
};
