/**
 * Git command execution helper
 */

/**
 * Execute a git command with sandboxed environment
 */
export async function execGit(args: string[], cwd: string): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd,
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

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorMessage = new TextDecoder().decode(stderr);
    throw new Error(`Git command failed: ${errorMessage}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

/**
 * Execute a git command, returning null on failure instead of throwing
 */
export async function execGitSafe(args: string[], cwd: string): Promise<string | null> {
  try {
    return await execGit(args, cwd);
  } catch {
    return null;
  }
}
