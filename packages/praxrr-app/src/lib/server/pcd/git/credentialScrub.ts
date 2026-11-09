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
import { config } from '$config';

async function isGitClone(path: string): Promise<boolean> {
  const stat = await Deno.stat(`${path}/.git`).catch(() => null);
  return stat !== null;
}

export interface GitCredentialScrubResult {
  /** Clones whose remote URL was rewritten. */
  scrubbed: number;
  /** Clones that could not be checked or rewritten (may still hold a token). */
  failed: string[];
}

async function listChildDirectories(dir: string): Promise<string[]> {
  const paths: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) paths.push(`${dir}/${entry.name}`);
    }
  } catch {
    // Directory does not exist.
  }
  return paths;
}

/**
 * Scrub embedded credentials from every PCD clone (registered or orphaned under the databases
 * directory), each PCD dependency clone, and every TRaSH source clone.
 * Never throws; per-clone failures are reported in `failed`.
 */
export async function scrubStoredGitCredentials(): Promise<GitCredentialScrubResult> {
  const pcdPaths = new Set<string>(await listChildDirectories(config.paths.databases));
  const candidates = new Set<string>();
  const failed: string[] = [];
  try {
    for (const instance of databaseInstancesQueries.getAll()) {
      if (instance.local_path) pcdPaths.add(instance.local_path);
    }
    for (const source of trashGuideSourcesQueries.getAll()) {
      if (source.local_path) candidates.add(source.local_path);
    }
  } catch (error) {
    await logger.warn('Failed to list registered git clones for credential scrub', {
      source: 'GitCredentialScrub',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
  }
  for (const pcdPath of pcdPaths) {
    candidates.add(pcdPath);
    for (const depPath of await listChildDirectories(`${pcdPath}/deps`)) candidates.add(depPath);
  }

  let scrubbed = 0;
  for (const path of candidates) {
    // Only repositories with their own .git: git would otherwise walk up to a parent repository.
    if (!(await isGitClone(path))) continue;
    try {
      if (await scrubRemoteCredentials(path)) scrubbed += 1;
    } catch (error) {
      failed.push(path);
      await logger.error('Failed to scrub credentials from git remote URL', {
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
  return { scrubbed, failed };
}
