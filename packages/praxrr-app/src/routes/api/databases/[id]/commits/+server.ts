import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { getCommits, getStatus, isNotGitRepositoryError } from '$utils/git/index.ts';

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

  try {
    const status = await getStatus(database.local_path, { fetch: true });
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
  }

  return json({
    commits,
    branch,
    repositoryUrl: database.repository_url,
    gitUnavailable,
  });
};
