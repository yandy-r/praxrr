/**
 * Git command execution helper
 */

import { NotGitRepositoryError, isNotGitRepositoryMessage } from './errors.ts';

/**
 * Host prefix the per-command credential is scoped to. Remote clones are GitHub-only
 * (`validateRepository`), and scoping the header keeps the token from reaching any other host
 * (local paths, `file://` sources, dependency mirrors on other hosts).
 */
export const GITHUB_CREDENTIAL_SCOPE = 'https://github.com/';

export interface GitExecOptions {
  /**
   * GitHub personal access token for this command only. It is passed to git through
   * environment-scoped config (`http.<scope>.extraHeader`), so it never appears in argv,
   * `.git/config`, or anything git persists.
   */
  personalAccessToken?: string | null;
}

function encodeBase64Utf8(value: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Build the sandboxed environment for a git subprocess.
 *
 * Interactive prompts and credential helpers are disabled. When a token is supplied it is added
 * as a GitHub-scoped `Authorization` header via `GIT_CONFIG_*` variables.
 */
export function buildGitEnv(options: GitExecOptions = {}): Record<string, string> {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
  };

  const token = options.personalAccessToken?.trim();
  if (token) {
    if (/[\r\n]/.test(token)) {
      throw new Error('Personal access token contains invalid characters');
    }
    env.GIT_CONFIG_COUNT = '2';
    env.GIT_CONFIG_KEY_1 = `http.${GITHUB_CREDENTIAL_SCOPE}.extraHeader`;
    env.GIT_CONFIG_VALUE_1 = `Authorization: Basic ${encodeBase64Utf8(`x-access-token:${token}`)}`;
  }

  return env;
}

/**
 * Execute a git command with sandboxed environment
 */
export async function execGit(args: string[], cwd: string, options: GitExecOptions = {}): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
    env: buildGitEnv(options),
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorMessage = new TextDecoder().decode(stderr);
    if (isNotGitRepositoryMessage(errorMessage)) {
      throw new NotGitRepositoryError(`Git command failed: ${errorMessage}`);
    }

    throw new Error(`Git command failed: ${errorMessage}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

/**
 * Execute a git command, returning null on failure instead of throwing
 */
export async function execGitSafe(args: string[], cwd: string, options: GitExecOptions = {}): Promise<string | null> {
  try {
    return await execGit(args, cwd, options);
  } catch {
    return null;
  }
}
