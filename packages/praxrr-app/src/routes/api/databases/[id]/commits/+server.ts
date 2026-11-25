import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import {
  getCommits,
  getStatus,
  isGitFetchError,
  isNotGitRepositoryError,
  toGitFetchFailure,
  type GitFetchFailure,
} from '$utils/git/index.ts';
import type { GitStatus } from '$utils/git/types.ts';
import { logger } from '$logger/logger.ts';
import { getDecryptedDatabasePersonalAccessToken } from '$server/utils/encryption/database-credentials.ts';

/**
 * GET /api/databases/{id}/commits
 *
 * Return recent commits for the selected database repository.
 * Uses remote commits when local branch is behind and no local unpushed changes exist.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const id = parseInt(params.id || '', 10);
  const database = databaseInstancesQueries.getById(id);

  if (!database) {
    error(404, 'Database not found');
  }

  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  let branch = '';
  let commits: Awaited<ReturnType<typeof getCommits>> = [];
  let gitUnavailable = false;
  let fetchError: GitFetchFailure | null = null;

  try {
    const personalAccessToken = await getDecryptedDatabasePersonalAccessToken(id).catch(() => undefined);
    let status: GitStatus;
    try {
      status = await getStatus(database.local_path, { fetch: true, personalAccessToken });
    } catch (fetchFailure) {
      if (!isGitFetchError(fetchFailure)) {
        throw fetchFailure;
      }
      // Report the failed fetch instead of silently listing stale commits as current.
      fetchError = toGitFetchFailure(fetchFailure);
      await logger.warn('Database remote fetch failed while loading commits', {
        source: 'DatabaseCommits',
        meta: { databaseId: id, kind: fetchFailure.kind, detail: fetchFailure.detail },
      });
      status = await getStatus(database.local_path);
    }
    branch = status.branch;
    const remoteRef = branch ? `origin/${branch}` : null;
    const shouldUseRemote = status.behind > 0 && status.ahead === 0 && remoteRef;
    try {
      commits = await getCommits(database.local_path, limit, shouldUseRemote ? remoteRef : 'HEAD');
    } catch {
      commits = await getCommits(database.local_path, limit);
    }
  } catch (gitError) {
    if (!isNotGitRepositoryError(gitError)) {
      throw gitError;
    }
    gitUnavailable = true;
    fetchError = null;
  }

  return json({
    commits,
    branch,
    repositoryUrl: database.repository_url,
    gitUnavailable,
    fetchError,
  });
};
