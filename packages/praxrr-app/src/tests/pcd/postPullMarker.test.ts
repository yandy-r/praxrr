/**
 * YAN-1996: a sync that pulled but failed afterwards (e.g. a dependency fetch with a revoked
 * token) leaves a marker so the next sync finishes the work instead of reporting "up to date".
 */
import { assert, assertFalse } from '@std/assert';
import { clearPostPullPending, hasPostPullPending, markPostPullPending } from '$pcd/git/postPullMarker.ts';

Deno.test('post-pull marker round-trips inside the clone .git directory', async () => {
  const repoPath = `/tmp/praxrr-tests/post-pull-marker-${crypto.randomUUID()}`;
  await Deno.mkdir(`${repoPath}/.git`, { recursive: true });
  try {
    assertFalse(await hasPostPullPending(repoPath));

    await markPostPullPending(repoPath);
    assert(await hasPostPullPending(repoPath));
    // Never written into the working tree.
    assertFalse((await Array.fromAsync(Deno.readDir(repoPath))).some((entry) => entry.name !== '.git'));

    await clearPostPullPending(repoPath);
    assertFalse(await hasPostPullPending(repoPath));
    // Clearing an absent marker is a no-op.
    await clearPostPullPending(repoPath);
  } finally {
    await Deno.remove(repoPath, { recursive: true }).catch(() => {});
  }
});

Deno.test('post-pull marker reports false for a path without a .git directory', async () => {
  assertFalse(await hasPostPullPending(`/tmp/praxrr-tests/missing-${crypto.randomUUID()}`));
});
