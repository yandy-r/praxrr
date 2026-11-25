import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import {
  getBranches,
  getIncomingChanges,
  getRepoInfo,
  getStatus,
  isGitFetchError,
  isNotGitRepositoryError,
  readIncomingChanges,
  toGitFetchFailure,
  type GitFetchFailure,
} from '$utils/git/index.ts';
import type { GitStatus, IncomingChanges } from '$utils/git/types.ts';
import { logger } from '$logger/logger.ts';
import { listDraftEntityChanges } from '$pcd/ops/draftChanges.ts';
import { getDecryptedDatabasePersonalAccessToken } from '$server/utils/encryption/database-credentials.ts';

function emptyGitStatus(): GitStatus {
  return {
    branch: '',
    isDirty: false,
    ahead: 0,
    behind: 0,
    untracked: [],
    modified: [],
    staged: [],
  };
}

function emptyIncomingChanges(): IncomingChanges {
  return {
    hasUpdates: false,
    commitsBehind: 0,
    commits: [],
  };
}

/**
 * GET /api/databases/{id}/changes
 *
 * Gather local git status, incoming changes, branch list, and repo metadata for a database.
 * Includes draft entity changes when PAT-based developer access is present.
 */
export const GET: RequestHandler = async ({ params }) => {
  const id = parseInt(params.id || '', 10);
  const database = databaseInstancesQueries.getById(id);

  if (!database) {
    error(404, 'Database not found');
  }

  // Fetch data for everyone
  let personalAccessToken: string | undefined;
  try {
    personalAccessToken = await getDecryptedDatabasePersonalAccessToken(id);
  } catch {
    personalAccessToken = undefined;
  }
  let status: GitStatus;
  let incomingChanges: IncomingChanges;
  let branches: string[];
  let gitUnavailable = false;
  let fetchError: GitFetchFailure | null = null;

  // A failed remote fetch (e.g. revoked token) is reported to the page instead of being shown as
  // "up to date"; incoming changes then fall back to the last fetched remote-tracking ref.
  const loadIncomingChanges = async (): Promise<IncomingChanges> => {
    try {
      return await getIncomingChanges(database.local_path, { personalAccessToken });
    } catch (fetchFailure) {
      if (!isGitFetchError(fetchFailure)) {
        throw fetchFailure;
      }
      fetchError = toGitFetchFailure(fetchFailure);
      await logger.warn('Database remote fetch failed while loading changes', {
        source: 'DatabaseChanges',
        meta: { databaseId: id, kind: fetchFailure.kind, detail: fetchFailure.detail },
      });
      return await readIncomingChanges(database.local_path);
    }
  };

  try {
    [status, incomingChanges, branches] = await Promise.all([
      getStatus(database.local_path),
      loadIncomingChanges(),
      getBranches(database.local_path),
    ]);
  } catch (gitError) {
    if (!isNotGitRepositoryError(gitError)) {
      throw gitError;
    }
    status = emptyGitStatus();
    incomingChanges = emptyIncomingChanges();
    branches = [];
    gitUnavailable = true;
    fetchError = null;
  }

  const repoInfo = await getRepoInfo(database.repository_url, personalAccessToken);

  // Only fetch draft changes for developers
  let draftChanges = null;
  if (database.has_personal_access_token || database.personal_access_token) {
    draftChanges = listDraftEntityChanges(id);

    // Append working-tree file changes (modified + untracked, excluding deps/ and ops/)
    const FILE_CHANGE_EXCLUDED_PREFIXES = ['deps/', 'ops/'];
    for (const filepath of status.modified) {
      if (FILE_CHANGE_EXCLUDED_PREFIXES.some((prefix) => filepath.startsWith(prefix))) continue;
      draftChanges.push({
        key: `file:${filepath}`,
        entity: 'file',
        name: filepath,
        operation: 'update',
        summary: 'Modified on disk',
        changedFields: [],
        updatedAt: new Date().toISOString(),
        ops: [],
        sections: [],
      });
    }
    for (const filepath of status.untracked) {
      if (FILE_CHANGE_EXCLUDED_PREFIXES.some((prefix) => filepath.startsWith(prefix))) continue;
      draftChanges.push({
        key: `file:${filepath}`,
        entity: 'file',
        name: filepath,
        operation: 'create',
        summary: 'New file',
        changedFields: [],
        updatedAt: new Date().toISOString(),
        ops: [],
        sections: [],
      });
    }
  }

  return json({
    status,
    incomingChanges,
    branches,
    repoInfo,
    draftChanges,
    gitUnavailable,
    fetchError,
  });
};
