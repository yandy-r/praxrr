/**
 * Remove git credentials that older versions embedded in clone remote URLs (YAN-460).
 *
 * Before per-command credentials, private PCD repositories and their dependencies were cloned
 * with `https://<token>@github.com/...`, which git persisted as `remote.origin.url`. Scrubbing
 * every known clone at startup and before each backup keeps the token out of `.git/config` and
 * out of backup archives.
 */

import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { scrubRemoteCredentials } from '$utils/git/index.ts';
import { logger } from '$logger/logger.ts';

async function listDependencyClones(pcdPath: string): Promise<string[]> {
  const paths: string[] = [];
  try {
    for await (const entry of Deno.readDir(`${pcdPath}/deps`)) {
      if (entry.isDirectory) paths.push(`${pcdPath}/deps/${entry.name}`);
    }
  } catch {
    // No deps directory.
  }
  return paths;
}

async function isGitClone(path: string): Promise<boolean> {
  const stat = await Deno.stat(`${path}/.git`).catch(() => null);
  return stat !== null;
}

/**
 * Scrub embedded credentials from every PCD, PCD dependency, and TRaSH source clone.
 * Never throws; returns the number of clones whose remote URL was rewritten.
 */
export async function scrubStoredGitCredentials(): Promise<number> {
  const candidates: string[] = [];
  try {
    for (const instance of databaseInstancesQueries.getAll()) {
      if (!instance.local_path) continue;
      candidates.push(instance.local_path, ...(await listDependencyClones(instance.local_path)));
    }
    for (const source of trashGuideSourcesQueries.getAll()) {
      if (source.local_path) candidates.push(source.local_path);
    }
  } catch (error) {
    await logger.warn('Failed to list git clones for credential scrub', {
      source: 'GitCredentialScrub',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return 0;
  }

  let scrubbed = 0;
  for (const path of candidates) {
    // Only repositories with their own .git: git would otherwise walk up to a parent repository.
    if (!(await isGitClone(path))) continue;
    try {
      if (await scrubRemoteCredentials(path)) scrubbed += 1;
    } catch (error) {
      await logger.warn('Failed to scrub credentials from git remote URL', {
        source: 'GitCredentialScrub',
        meta: { path, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  if (scrubbed > 0) {
    await logger.info('Removed embedded credentials from git remote URLs', {
      source: 'GitCredentialScrub',
      meta: { scrubbed },
    });
  }
  return scrubbed;
}
