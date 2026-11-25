/**
 * Marker for post-pull sync work that has not completed yet.
 *
 * `pcdManager.sync` writes the marker before pulling and clears it only after dependency sync,
 * base-op import and compilation finish. If any of those fail (for example a dependency fetch with
 * a revoked token), the parent clone already matches the remote, so the next update check reports
 * "no updates". The marker makes the next sync finish the interrupted work instead of skipping it.
 *
 * It lives inside the clone's `.git` directory: never tracked, never part of the working tree.
 */

const MARKER_NAME = 'praxrr-post-pull-pending';

function markerPath(repoPath: string): string {
  return `${repoPath}/.git/${MARKER_NAME}`;
}

export async function markPostPullPending(repoPath: string): Promise<void> {
  await Deno.writeTextFile(markerPath(repoPath), `${new Date().toISOString()}\n`);
}

export async function clearPostPullPending(repoPath: string): Promise<void> {
  try {
    await Deno.remove(markerPath(repoPath));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

export async function hasPostPullPending(repoPath: string): Promise<boolean> {
  try {
    return (await Deno.stat(markerPath(repoPath))).isFile;
  } catch {
    return false;
  }
}
