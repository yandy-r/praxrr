import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { pcdManager } from '$pcd/index.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { setupStateQueries } from '$db/queries/setupState.ts';
import { logger } from '$logger/logger.ts';
import { schedulePcdSyncForDatabase } from '$lib/server/jobs/init.ts';
import { validateHttpsGitRepositoryUrl, type GitRepositoryUrlError } from '$utils/validation/url.ts';
import { resolveDefaultDatabaseConfig } from '$server/setup/defaultDatabase.ts';

type LinkMode = 'default' | 'custom';

const GIT_URL_ERROR_MESSAGES: Record<GitRepositoryUrlError, string> = {
  invalid_url: 'Only https git URLs are supported in setup',
  local_path: 'Only https git URLs are supported in setup',
  not_https: 'Only https git URLs are supported in setup',
  has_credentials: 'Credentials in the repository URL are not supported. Use the personal access token field instead.',
};

function getFirstNonEmptyFormValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)?.toString().trim();
  return value ? value : undefined;
}

export const load: PageServerLoad = () => {
  const linkedDatabases = databaseInstancesQueries.getAll();

  return {
    linkedDatabases,
    alreadyLinked: linkedDatabases.length > 0,
    defaultDatabase: resolveDefaultDatabaseConfig(),
  };
};

export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    const mode: LinkMode = formData.get('mode')?.toString() === 'custom' ? 'custom' : 'default';

    let name: string | undefined;
    let repositoryUrl: string | undefined;
    let branch: string | undefined;
    let personalAccessToken: string | undefined;

    if (mode === 'default') {
      const hint = resolveDefaultDatabaseConfig();
      if (!hint.configured || !hint.url) {
        return fail(400, {
          error: 'No default database is configured for this deployment. Use a custom repository instead.',
          values: { mode },
        });
      }

      name = hint.name;
      repositoryUrl = hint.url;
      branch = hint.branch;
    } else {
      name = getFirstNonEmptyFormValue(formData, 'name');
      repositoryUrl = getFirstNonEmptyFormValue(formData, 'repository_url');
      branch = getFirstNonEmptyFormValue(formData, 'branch');
      personalAccessToken = getFirstNonEmptyFormValue(formData, 'personal_access_token');

      if (!name || !repositoryUrl) {
        return fail(400, {
          error: 'Name and repository URL are required',
          values: { mode, name, repository_url: repositoryUrl },
        });
      }
    }

    const urlValidation = validateHttpsGitRepositoryUrl(repositoryUrl);
    if (!urlValidation.isValid) {
      await logger.warn('Rejected setup database link with unsupported repository URL', {
        source: 'setup/link-database',
        meta: { mode, reason: urlValidation.error },
      });

      return fail(400, {
        error: GIT_URL_ERROR_MESSAGES[urlValidation.error ?? 'invalid_url'],
        values: { mode, name, repository_url: mode === 'custom' ? repositoryUrl : '' },
      });
    }

    if (databaseInstancesQueries.nameExists(name)) {
      return fail(400, {
        error: 'A database with this name already exists',
        values: { mode, name, repository_url: mode === 'custom' ? repositoryUrl : '' },
      });
    }

    try {
      // Setup wizard collects no git author identity; force local-ops-only when a
      // token is supplied so linking never demands identity fields it doesn't ask
      // for. Push-back can be configured later from the database's own settings.
      const instance = await pcdManager.link({
        name,
        repositoryUrl,
        branch,
        syncStrategy: 60,
        autoPull: true,
        personalAccessToken,
        localOpsEnabled: !!personalAccessToken,
        conflictStrategy: 'override',
      });

      await logger.info(`Linked database during setup: ${name}`, {
        source: 'setup/link-database',
        meta: { id: instance.id, name, mode },
      });

      schedulePcdSyncForDatabase(instance.id);

      setupStateQueries.setWizardStep('select-profiles');
      redirect(303, '/setup/select-profiles');
    } catch (error) {
      // Re-throw redirect errors (they're not actual errors)
      if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
        throw error;
      }

      await logger.error('Failed to link database during setup', {
        source: 'setup/link-database',
        meta: {
          error: error instanceof Error ? error.message : String(error),
          name,
          mode,
          hasPersonalAccessToken: !!personalAccessToken,
        },
      });

      return fail(500, {
        error: 'Failed to link the database. Check the repository URL and credentials, then try again.',
        values: { mode, name, repository_url: mode === 'custom' ? repositoryUrl : '' },
      });
    }
  },
} satisfies Actions;
