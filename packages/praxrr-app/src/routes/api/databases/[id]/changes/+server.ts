import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { getBranches, getIncomingChanges, getRepoInfo, getStatus } from '$utils/git/index.ts';
import type { GitStatus, IncomingChanges } from '$utils/git/types.ts';
import { listDraftEntityChanges } from '$pcd/ops/draftChanges.ts';
import { getDecryptedDatabasePersonalAccessToken } from '$server/utils/encryption/database-credentials.ts';

function isNotGitRepositoryError(input: unknown): boolean {
  const message = input instanceof Error ? input.message : String(input);
  return message.toLowerCase().includes('not a git repository');
}

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

  try {
    [status, incomingChanges, branches] = await Promise.all([
      getStatus(database.local_path),
      getIncomingChanges(database.local_path),
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
  });
};
