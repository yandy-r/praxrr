/**
 * PCD Dependency Resolution
 * Handles cloning and managing PCD dependencies using git refs (tags or branches)
 */

import { checkout, clone, fetch, fetchTags, getBranch } from '$utils/git/index.ts';
import { execGit, execGitSafe } from '$utils/git/exec.ts';
import { loadManifest, resolveSchemaDependencyUrl } from '../manifest/manifest.ts';
import { logger } from '$logger/logger.ts';

const SCHEMA_REF_OVERRIDE_ENV = 'PRAXRR_SCHEMA_REF';

/**
 * Extract repository name from GitHub URL
 * https://github.com/yandy-r/praxrr-schema -> schema
 */
function getRepoName(repoUrl: string): string {
  const trimmed = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  try {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  } catch {
    const parts = trimmed.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  }
}

/**
 * Get dependency path
 */
function getDependencyPath(pcdPath: string, repoName: string): string {
  return `${pcdPath}/deps/${repoName}`;
}

/**
 * Check if a directory exists
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Clone and checkout a dependency at a specific tag
 * Keeps .git, ops, and pcd.json - removes everything else
 */
async function cloneDependency(
  pcdPath: string,
  repoUrl: string,
  version: string,
  personalAccessToken?: string
): Promise<void> {
  const repoName = getRepoName(repoUrl);
  const depPath = getDependencyPath(pcdPath, repoName);

  // Clone the dependency repository
  await clone(repoUrl, depPath, undefined, personalAccessToken);

  // Checkout the specific version tag
  await checkout(depPath, version);

  // Clean up dependency - keep only .git, ops folder and pcd.json
  const keepItems = new Set(['.git', 'ops', 'pcd.json']);

  for await (const entry of Deno.readDir(depPath)) {
    if (!keepItems.has(entry.name)) {
      const itemPath = `${depPath}/${entry.name}`;
      await Deno.remove(itemPath, { recursive: true });
    }
  }
}

/**
 * Get the installed ref of a dependency.
 * Prefers current branch name, falls back to dependency manifest version.
 */
async function getInstalledVersion(pcdPath: string, repoName: string): Promise<string | null> {
  const depPath = `${pcdPath}/deps/${repoName}`;
  try {
    const currentBranch = await getBranch(depPath);
    if (currentBranch && currentBranch !== 'HEAD') {
      return currentBranch;
    }
  } catch {
    // Dependency repository may not exist yet; fall back to manifest check.
  }

  const depManifestPath = `${depPath}/pcd.json`;
  try {
    const content = await Deno.readTextFile(depManifestPath);
    const manifest = JSON.parse(content);
    return manifest.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Update a dependency to a new ref using fetch + checkout
 */
async function updateDependency(depPath: string, version: string): Promise<void> {
  await fetch(depPath);
  await fetchTags(depPath);

  const remoteBranchRef = `origin/${version}`;
  const hasRemoteBranch = (await execGitSafe(['rev-parse', '--verify', '--quiet', remoteBranchRef], depPath)) !== null;

  if (!hasRemoteBranch) {
    await checkout(depPath, version);
    return;
  }

  const checkedOutBranch = await execGitSafe(['checkout', version], depPath);
  if (checkedOutBranch === null) {
    await execGit(['checkout', '-B', version, remoteBranchRef], depPath);
  }
  await execGit(['reset', '--hard', remoteBranchRef], depPath);
}

function getRequiredDependencyRef(
  repoUrl: string,
  manifestRef: string,
  schemaDependencyUrl: string
): string {
  if (repoUrl !== schemaDependencyUrl) {
    return manifestRef;
  }

  const overrideRef = Deno.env.get(SCHEMA_REF_OVERRIDE_ENV)?.trim();
  if (!overrideRef) {
    return manifestRef;
  }

  return overrideRef;
}

/**
 * Process all dependencies for a PCD (initial clone)
 * Called when linking a new database
 */
export async function processDependencies(pcdPath: string, personalAccessToken?: string): Promise<void> {
  const manifest = await loadManifest(pcdPath);
  const schemaDependencyUrl = resolveSchemaDependencyUrl(manifest.dependencies);

  if (!manifest.dependencies || Object.keys(manifest.dependencies).length === 0) {
    return;
  }

  // Create deps directory
  const depsDir = `${pcdPath}/deps`;
  await Deno.mkdir(depsDir, { recursive: true });

  for (const [repoUrl, version] of Object.entries(manifest.dependencies)) {
    const requiredRef = getRequiredDependencyRef(repoUrl, version, schemaDependencyUrl);
    const repoName = getRepoName(repoUrl);
    const depPath = getDependencyPath(pcdPath, repoName);

    // Clone and checkout the dependency
    await cloneDependency(pcdPath, repoUrl, requiredRef, personalAccessToken);

    // Validate the dependency's manifest
    await loadManifest(depPath);

    await logger.debug(`Installed dependency ${repoName}@${requiredRef}`, {
      source: 'PCDDependencies',
      meta: { pcdPath, repoName, manifestRef: version, resolvedRef: requiredRef },
    });
  }
}

/**
 * Sync dependencies - update any that have changed versions
 * Uses fetch + checkout instead of re-cloning
 */
export async function syncDependencies(pcdPath: string, personalAccessToken?: string): Promise<void> {
  const manifest = await loadManifest(pcdPath);
  const schemaDependencyUrl = resolveSchemaDependencyUrl(manifest.dependencies);

  if (!manifest.dependencies || Object.keys(manifest.dependencies).length === 0) {
    return;
  }

  const depsDir = `${pcdPath}/deps`;
  await Deno.mkdir(depsDir, { recursive: true });

  for (const [repoUrl, manifestRef] of Object.entries(manifest.dependencies)) {
    const requiredRef = getRequiredDependencyRef(repoUrl, manifestRef, schemaDependencyUrl);
    const repoName = getRepoName(repoUrl);
    const depPath = getDependencyPath(pcdPath, repoName);
    const installedVersion = await getInstalledVersion(pcdPath, repoName);

    // Already at correct version
    if (installedVersion === requiredRef) {
      continue;
    }

    // Check if dependency exists with .git folder
    const hasGitFolder = await dirExists(`${depPath}/.git`);

    if (hasGitFolder) {
      // Fetch tags and checkout new version
      await updateDependency(depPath, requiredRef);
      await logger.info(`Updated dependency ${repoName}: ${installedVersion} -> ${requiredRef}`, {
        source: 'PCDDependencies',
        meta: { pcdPath, repoName, from: installedVersion, to: requiredRef, manifestRef },
      });
    } else {
      // No .git folder (legacy or corrupted) - re-clone
      try {
        await Deno.remove(depPath, { recursive: true });
      } catch {
        // Didn't exist
      }
      await cloneDependency(pcdPath, repoUrl, requiredRef, personalAccessToken);
      await logger.info(`Re-cloned dependency ${repoName}@${requiredRef}`, {
        source: 'PCDDependencies',
        meta: { pcdPath, repoName, manifestRef, resolvedRef: requiredRef },
      });
    }

    // Validate the dependency's manifest
    await loadManifest(depPath);
  }
}

/**
 * Validate and fix dependencies on startup
 * Ensures all deps exist and are at the correct version
 */
export async function validateDependencies(pcdPath: string, personalAccessToken?: string): Promise<boolean> {
  try {
    const manifest = await loadManifest(pcdPath);
    const schemaDependencyUrl = resolveSchemaDependencyUrl(manifest.dependencies);

    if (!manifest.dependencies || Object.keys(manifest.dependencies).length === 0) {
      return true;
    }

    let allValid = true;

    for (const [repoUrl, manifestRef] of Object.entries(manifest.dependencies)) {
      const requiredRef = getRequiredDependencyRef(repoUrl, manifestRef, schemaDependencyUrl);
      const repoName = getRepoName(repoUrl);
      const depPath = getDependencyPath(pcdPath, repoName);

      // Check if dependency exists
      if (!(await dirExists(depPath))) {
        await logger.warn(`Missing dependency ${repoName}, will install`, {
          source: 'PCDDependencies',
          meta: { pcdPath, repoName },
        });
        allValid = false;
        continue;
      }

      // Check version
      const installedVersion = await getInstalledVersion(pcdPath, repoName);
      if (installedVersion !== requiredRef) {
        await logger.warn(`Dependency ${repoName} ref mismatch: ${installedVersion} != ${requiredRef}`, {
          source: 'PCDDependencies',
          meta: { pcdPath, repoName, installed: installedVersion, required: requiredRef, manifestRef },
        });
        allValid = false;
      }

      // Validate manifest
      try {
        await loadManifest(depPath);
      } catch {
        await logger.warn(`Dependency ${repoName} has invalid manifest`, {
          source: 'PCDDependencies',
          meta: { pcdPath, repoName },
        });
        allValid = false;
      }
    }

    // If any issues found, run sync to fix them
    if (!allValid) {
      await syncDependencies(pcdPath, personalAccessToken);
    }

    return true;
  } catch (error) {
    await logger.error('Failed to validate dependencies', {
      source: 'PCDDependencies',
      meta: { pcdPath, error: String(error) },
    });
    return false;
  }
}
