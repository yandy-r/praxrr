/**
 * Git repository commands
 */

import { execGit, execGitSafe } from './exec.ts';
import type { RepoInfo } from './types.ts';
import { getCachedRepoInfo } from '../github/cache.ts';
import { logger } from '$logger/logger.ts';

type GitHubApiError = {
  message: string;
  rateLimited: boolean;
};

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function resolveLocalRepositoryPath(repositoryUrl: string): string | null {
  const normalized = repositoryUrl.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(normalized).pathname);
    } catch {
      return null;
    }
  }

  if (
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    isWindowsDrivePath(normalized)
  ) {
    return normalized;
  }

  return null;
}

/**
 * Determine whether a repository URL points to a local repository source.
 *
 * @param repositoryUrl - Repository URL or path.
 * @returns True if the value can be resolved as a local path.
 */
export function isLocalRepositorySource(repositoryUrl: string): boolean {
  return resolveLocalRepositoryPath(repositoryUrl) !== null;
}

async function copyPathRecursive(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStat = await Deno.stat(sourcePath);

  if (sourceStat.isFile) {
    await Deno.copyFile(sourcePath, targetPath);
    return;
  }

  if (!sourceStat.isDirectory) {
    throw new Error(`Unsupported local repository entry type at "${sourcePath}"`);
  }

  await Deno.mkdir(targetPath, { recursive: true });
  for await (const entry of Deno.readDir(sourcePath)) {
    const entrySourcePath = `${sourcePath}/${entry.name}`;
    const entryTargetPath = `${targetPath}/${entry.name}`;
    await copyPathRecursive(entrySourcePath, entryTargetPath);
  }
}

const LOCAL_CLONE_TIMEOUT_MS = 30_000;

async function isGitRepositoryRoot(path: string): Promise<boolean> {
  const isBare = await execGitSafe(['rev-parse', '--is-bare-repository'], path);
  if (isBare === 'true') {
    return true;
  }
  if (isBare !== 'false') {
    return false;
  }

  const topLevel = await execGitSafe(['rev-parse', '--show-toplevel'], path);
  if (!topLevel) {
    return false;
  }

  const [sourcePath, repositoryRoot] = await Promise.all([Deno.realPath(path), Deno.realPath(topLevel)]);
  return sourcePath === repositoryRoot;
}

async function cloneLocalGitRepository(repositoryUrl: string, targetPath: string, branch?: string): Promise<void> {
  const args = ['clone'];
  if (branch) {
    args.push('--branch', branch);
  }
  args.push(repositoryUrl, targetPath);

  const child = new Deno.Command('git', {
    args,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
    },
  }).spawn();

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {
      // Process already exited.
    }
  }, LOCAL_CLONE_TIMEOUT_MS);

  try {
    const { code, stderr } = await child.output();
    if (timedOut) {
      throw new Error(`Local Git clone timed out after ${LOCAL_CLONE_TIMEOUT_MS}ms`);
    }
    if (code !== 0) {
      const detail = new TextDecoder().decode(stderr).trim();
      throw new Error(`Local Git clone failed${detail ? `: ${detail}` : ''}`);
    }
  } catch (error) {
    await Deno.remove(targetPath, { recursive: true }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function warnIgnoredLocalBranch(
  repositoryUrl: string,
  localRepositoryPath: string,
  branch: string
): Promise<void> {
  await logger.warn('Ignoring branch selection for non-Git local repository path clone', {
    source: 'Git',
    meta: { repositoryUrl, localRepositoryPath, branch },
  });
}

async function copyLocalDirectory(
  repositoryUrl: string,
  localRepositoryPath: string,
  targetPath: string,
  branch?: string
): Promise<void> {
  if (branch) {
    await warnIgnoredLocalBranch(repositoryUrl, localRepositoryPath, branch);
  }
  await copyPathRecursive(localRepositoryPath, targetPath);
}

/**
 * Refresh an existing target directory with files from a local repository path.
 *
 * @param repositoryUrl - Local repository URL/path.
 * @param targetPath - Destination directory to sync into.
 * @throws Error when repository path is invalid or not a directory.
 */
export async function refreshLocalRepositoryClone(repositoryUrl: string, targetPath: string): Promise<void> {
  const localRepositoryPath = resolveLocalRepositoryPath(repositoryUrl);
  if (!localRepositoryPath) {
    throw new Error(`Repository URL is not a local source path: ${repositoryUrl}`);
  }

  const sourceStat = await Deno.stat(localRepositoryPath).catch(() => null);
  if (!sourceStat || !sourceStat.isDirectory) {
    throw new Error(`Local repository path does not exist or is not a directory: ${localRepositoryPath}`);
  }

  try {
    await Deno.remove(targetPath, { recursive: true });
  } catch {
    // Fresh install path.
  }

  if (await isGitRepositoryRoot(localRepositoryPath)) {
    await cloneLocalGitRepository(repositoryUrl, targetPath);
  } else {
    await copyPathRecursive(localRepositoryPath, targetPath);
  }
}

async function parseGitHubErrorResponse(response: Response): Promise<{
  message: string;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  resetAtEpoch: number | null;
}> {
  let apiMessage = '';
  try {
    const payload = await response.json();
    if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
      apiMessage = payload.message;
    }
  } catch {
    // Ignore JSON parse failures and rely on status/headers.
  }

  const messageLower = apiMessage.toLowerCase();
  const retryAfterRaw = response.headers.get('retry-after');
  const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : null;
  const resetAtRaw = response.headers.get('x-ratelimit-reset');
  const resetAtEpoch = resetAtRaw ? Number.parseInt(resetAtRaw, 10) : null;
  const remaining = response.headers.get('x-ratelimit-remaining');
  const hasRateLimitMessage = messageLower.includes('rate limit') || messageLower.includes('secondary rate limit');

  const rateLimited =
    response.status === 429 || (response.status === 403 && (remaining === '0' || hasRateLimitMessage));

  return {
    message: apiMessage,
    rateLimited,
    retryAfterSeconds: retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    resetAtEpoch: resetAtEpoch !== null && Number.isFinite(resetAtEpoch) ? resetAtEpoch : null,
  };
}

function formatRateLimitMessage(
  context: 'authenticated' | 'unauthenticated',
  retryAfterSeconds: number | null,
  resetAtEpoch: number | null
): string {
  let hint = '';
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    hint = ` Retry after ~${retryAfterSeconds} seconds.`;
  } else if (resetAtEpoch !== null && resetAtEpoch > 0) {
    hint = ` Rate limit resets around ${new Date(resetAtEpoch * 1000).toISOString()}.`;
  }

  if (context === 'authenticated') {
    return `GitHub API rate limit exceeded for the supplied Personal Access Token.${hint}`;
  }

  return `GitHub API rate limit exceeded for unauthenticated requests.${hint} Add a Personal Access Token to avoid this limit.`;
}

async function classifyGitHubResponseError(
  response: Response,
  context: 'authenticated' | 'unauthenticated'
): Promise<GitHubApiError> {
  const parsed = await parseGitHubErrorResponse(response);

  // Prioritize explicit auth failures so invalid/expired tokens are not mislabeled as rate limits.
  if (context === 'authenticated' && response.status === 401) {
    return {
      message: 'Unable to access repository. Please check your Personal Access Token.',
      rateLimited: false,
    };
  }

  if (parsed.rateLimited) {
    return {
      message: formatRateLimitMessage(context, parsed.retryAfterSeconds, parsed.resetAtEpoch),
      rateLimited: true,
    };
  }

  if (context === 'authenticated') {
    if (response.status === 404) {
      return {
        message:
          'Repository not found or inaccessible with this Personal Access Token. Verify the URL and token permissions.',
        rateLimited: false,
      };
    }

    if (response.status === 403) {
      return {
        message:
          'GitHub denied access to this repository with the supplied Personal Access Token. Check token permissions.',
        rateLimited: false,
      };
    }
  } else {
    if (response.status === 404) {
      return {
        message: 'Repository not found. If this repository is private, provide a Personal Access Token.',
        rateLimited: false,
      };
    }

    if (response.status === 403) {
      return {
        message:
          'GitHub denied unauthenticated access to this repository. It may be private or access-restricted. Provide a Personal Access Token.',
        rateLimited: false,
      };
    }
  }

  const suffix = parsed.message ? ` (${parsed.message})` : '';
  return {
    message: `GitHub API error: ${response.status}${suffix}`,
    rateLimited: false,
  };
}

/**
 * Validate that a repository URL is accessible and detect if it's private
 */
async function validateRepository(repositoryUrl: string, personalAccessToken?: string): Promise<boolean> {
  const githubPattern = /^https:\/\/github\.com\/([\w-]+)\/([\w-]+)\/?$/;
  const normalizedUrl = repositoryUrl.replace(/\.git$/, '');
  const match = normalizedUrl.match(githubPattern);

  if (!match) {
    throw new Error('Repository URL must be a valid GitHub repository (https://github.com/username/repo)');
  }

  const [, owner, repo] = match;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Praxrr',
  };

  // If we have a PAT, use it directly to avoid burning unauthenticated rate limit
  if (personalAccessToken) {
    const authResponse = await globalThis.fetch(apiUrl, {
      headers: { ...headers, Authorization: `Bearer ${personalAccessToken}` },
    });

    if (authResponse.ok) {
      const data = await authResponse.json();
      return data.private === true;
    }

    const classified = await classifyGitHubResponseError(authResponse, 'authenticated');
    throw new Error(classified.message);
  }

  // No PAT — try unauthenticated
  const response = await globalThis.fetch(apiUrl, { headers });

  if (response.ok) {
    const data = await response.json();
    return data.private === true;
  }

  const classified = await classifyGitHubResponseError(response, 'unauthenticated');
  throw new Error(classified.message);
}

/**
 * Clone a git repository
 * Returns true if private, false if public
 */
export async function clone(
  repositoryUrl: string,
  targetPath: string,
  branch?: string,
  personalAccessToken?: string
): Promise<boolean> {
  const localRepositoryPath = resolveLocalRepositoryPath(repositoryUrl);
  if (localRepositoryPath) {
    const sourceStat = await Deno.stat(localRepositoryPath).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory) {
      throw new Error(`Local repository path does not exist or is not a directory: ${localRepositoryPath}`);
    }

    if (await isGitRepositoryRoot(localRepositoryPath)) {
      await cloneLocalGitRepository(repositoryUrl, targetPath, branch);
    } else {
      await copyLocalDirectory(repositoryUrl, localRepositoryPath, targetPath, branch);
    }

    return false;
  }

  let isPrivate = !!personalAccessToken;
  try {
    isPrivate = await validateRepository(repositoryUrl, personalAccessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    // GitHub API rate limits should not block clone attempts; git clone is authoritative.
    if (!message.includes('rate limit')) {
      throw error;
    }
    await logger.warn('GitHub API validation rate-limited; continuing with git clone fallback', {
      source: 'Git',
      meta: { repositoryUrl, hasPersonalAccessToken: !!personalAccessToken },
    });
  }

  const args = ['clone'];
  if (branch) args.push('--branch', branch);

  let authUrl = repositoryUrl;
  if (personalAccessToken) {
    authUrl = repositoryUrl.replace('https://github.com', `https://${personalAccessToken}@github.com`);
  }

  args.push(authUrl, targetPath);

  const command = new Deno.Command('git', {
    args,
    stdout: 'piped',
    stderr: 'piped',
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
    },
  });

  const { code, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(`Git clone failed: ${new TextDecoder().decode(stderr)}`);
  }

  return isPrivate;
}

/**
 * Fetch from remote (silent)
 */
export async function fetch(repoPath: string): Promise<void> {
  await execGitSafe(['fetch', '--quiet'], repoPath);
}

/**
 * Fetch tags from remote
 */
export async function fetchTags(repoPath: string): Promise<void> {
  await execGitSafe(['fetch', '--tags', '--quiet'], repoPath);
}

/**
 * Pull from remote
 */
export async function pull(repoPath: string): Promise<void> {
  await execGit(['pull'], repoPath);
}

/**
 * Push to remote
 */
export async function push(repoPath: string): Promise<void> {
  await execGit(['push'], repoPath);
}

/**
 * Checkout a branch
 */
export async function checkout(repoPath: string, branch: string): Promise<void> {
  await execGit(['checkout', branch], repoPath);
}

/**
 * Reset repository to match remote (discards local changes)
 */
export async function resetToRemoteBranch(repoPath: string, branch: string): Promise<void> {
  const remoteBranchRef = `origin/${branch}`;

  await execGit(['fetch', '--quiet', 'origin', `${branch}:refs/remotes/origin/${branch}`], repoPath);
  await execGit(['reset', '--hard'], repoPath);
  await execGit(['clean', '-fdx'], repoPath);
  await execGit(['checkout', '-B', branch, remoteBranchRef], repoPath);
  await execGit(['reset', '--hard', remoteBranchRef], repoPath);
  await execGit(['clean', '-fdx'], repoPath);
}

/**
 * Stage files
 */
export async function stage(repoPath: string, filepaths: string[]): Promise<void> {
  for (const filepath of filepaths) {
    // Convert to relative path if it starts with the repo path
    const relativePath = filepath.startsWith(repoPath + '/') ? filepath.slice(repoPath.length + 1) : filepath;
    await execGit(['add', relativePath], repoPath);
  }
}

/**
 * Commit staged changes
 */
export async function commit(repoPath: string, message: string): Promise<void> {
  await execGit(['commit', '-m', message], repoPath);
}

/**
 * Configure local git author identity for the repository
 */
export async function configureIdentity(repoPath: string, name: string, email: string): Promise<void> {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  if (!trimmedName || !trimmedEmail) {
    throw new Error('Git author name and email are required');
  }

  await execGit(['config', 'user.name', trimmedName], repoPath);
  await execGit(['config', 'user.email', trimmedEmail], repoPath);
}

/**
 * Get repository info from GitHub API (cached)
 */
export async function getRepoInfo(
  repositoryUrl: string,
  personalAccessToken?: string | null
): Promise<RepoInfo | null> {
  return getCachedRepoInfo(repositoryUrl, personalAccessToken);
}
