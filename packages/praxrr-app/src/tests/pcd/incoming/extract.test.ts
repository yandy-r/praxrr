// Git plumbing for the incoming preview: strict fetch, archive extraction, ls-tree cross-check.

import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  assertPreviewableTree,
  assertSafeBranchName,
  extractTreeAtRef,
  fetchRemoteBranchStrict,
  listTreeEntries,
  resolveCommit,
  verifyExtractedTree,
} from '$pcd/incoming/extract.ts';
import { IncomingPreviewError } from '$pcd/incoming/types.ts';
import { git } from './incomingTestHelpers.ts';

async function makeRepo(): Promise<{ root: string; repo: string; remote: string }> {
  const root = await Deno.makeTempDir({ prefix: 'incoming-extract-' });
  const remote = `${root}/remote.git`;
  const repo = `${root}/repo`;
  await Deno.mkdir(remote);
  await git(['init', '--bare', '--initial-branch=main'], remote);
  await git(['clone', remote, repo], root);
  await git(['config', 'user.name', 'T'], repo);
  await git(['config', 'user.email', 't@example.invalid'], repo);
  return { root, repo, remote };
}

Deno.test('assertSafeBranchName rejects option-like and traversal branch names', () => {
  for (const bad of ['', '-x', '--upload-pack=evil', 'a..b', 'a b', 'a;b', 'a//b', 'main/', 'x.lock', '$(id)']) {
    let thrown = false;
    try {
      assertSafeBranchName(bad);
    } catch (error) {
      thrown = error instanceof IncomingPreviewError;
    }
    assert(thrown, `expected "${bad}" to be rejected`);
  }
  assertSafeBranchName('main');
  assertSafeBranchName('release/1.2.x');
});

Deno.test('fetchRemoteBranchStrict updates only origin/<branch> and throws on failure', async () => {
  const { root, repo, remote } = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/a.txt`, 'a');
    await git(['add', '-A'], repo);
    await git(['commit', '-m', 'one'], repo);
    await git(['push', 'origin', 'HEAD:main'], repo);
    await git(['tag', 'v1'], repo);
    await git(['push', 'origin', 'v1'], repo);

    const other = `${root}/other`;
    await git(['clone', remote, other], root);
    await git(['config', 'user.name', 'T'], other);
    await git(['config', 'user.email', 't@example.invalid'], other);
    await Deno.writeTextFile(`${other}/b.txt`, 'b');
    await git(['add', '-A'], other);
    await git(['commit', '-m', 'two'], other);
    await git(['tag', 'v2'], other);
    await git(['push', 'origin', 'HEAD:main', 'v2'], other);
    const upstreamHead = await git(['rev-parse', 'HEAD'], other);

    const head = await git(['rev-parse', 'HEAD'], repo);
    await fetchRemoteBranchStrict(repo, 'main');
    assertEquals(await git(['rev-parse', 'refs/remotes/origin/main'], repo), upstreamHead);
    assertEquals(await git(['rev-parse', 'HEAD'], repo), head);
    assertEquals(await git(['status', '--porcelain'], repo), '');
    assertEquals((await git(['tag', '--list'], repo)).split('\n').sort(), ['v1'], '--no-tags: v2 must not appear');

    await assertRejects(() => fetchRemoteBranchStrict(repo, 'does-not-exist'), IncomingPreviewError);
    await Deno.remove(remote, { recursive: true });
    const failure = await assertRejects(() => fetchRemoteBranchStrict(repo, 'main'), IncomingPreviewError);
    assertEquals(failure.code, 'fetch_failed');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('assertPreviewableTree rejects symlinks, gitlinks and tracked deps/', async () => {
  const { root, repo } = await makeRepo();
  try {
    await Deno.mkdir(`${repo}/entities`, { recursive: true });
    await Deno.writeTextFile(`${repo}/entities/a.yaml`, 'name: A\n');
    await Deno.symlink('/etc/passwd', `${repo}/entities/link.yaml`);
    await git(['add', '-A'], repo);
    await git(['commit', '-m', 'one'], repo);
    const commit = await resolveCommit(repo, 'HEAD');
    await assertRejects(() => assertPreviewableTree(repo, commit), IncomingPreviewError, 'symlink');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }

  const root2 = await Deno.makeTempDir({ prefix: 'incoming-extract-' });
  try {
    const repo2 = `${root2}/repo`;
    await Deno.mkdir(repo2);
    await git(['init', '--initial-branch=main'], repo2);
    await git(['config', 'user.name', 'T'], repo2);
    await git(['config', 'user.email', 't@example.invalid'], repo2);
    await Deno.mkdir(`${repo2}/deps/schema/ops`, { recursive: true });
    await Deno.writeTextFile(`${repo2}/deps/schema/ops/0.sql`, 'SELECT 1;\n');
    await git(['add', '-A'], repo2);
    await git(['commit', '-m', 'deps'], repo2);
    const commit2 = await resolveCommit(repo2, 'HEAD');
    await assertRejects(() => assertPreviewableTree(repo2, commit2), IncomingPreviewError, 'deps/');
  } finally {
    await Deno.remove(root2, { recursive: true }).catch(() => {});
  }
});

Deno.test(
  'extractTreeAtRef materializes the tree without .git; verifyExtractedTree passes on a clean tree',
  async () => {
    const { root, repo } = await makeRepo();
    try {
      await Deno.mkdir(`${repo}/entities/custom-formats`, { recursive: true });
      await Deno.writeTextFile(`${repo}/entities/custom-formats/a.yaml`, 'name: A\n');
      await Deno.writeTextFile(`${repo}/pcd.json`, '{}');
      await git(['add', '-A'], repo);
      await git(['commit', '-m', 'one'], repo);
      const commit = await resolveCommit(repo, 'HEAD');

      const dest = `${root}/tree`;
      await Deno.mkdir(dest);
      await extractTreeAtRef(repo, commit, dest);
      assertEquals(await Deno.readTextFile(`${dest}/entities/custom-formats/a.yaml`), 'name: A\n');
      assertEquals(
        await Deno.stat(`${dest}/.git`).then(
          () => true,
          () => false
        ),
        false
      );
      assertEquals(
        (await listTreeEntries(repo, commit)).map((entry) => entry.slice(entry.indexOf('\t') + 1)),
        ['entities/custom-formats/a.yaml', 'pcd.json']
      );
      await verifyExtractedTree(repo, commit, dest);

      await assertRejects(() => extractTreeAtRef(repo, 'HEAD', dest), IncomingPreviewError);
      await assertRejects(() => resolveCommit(repo, '--evil'), IncomingPreviewError);
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  }
);

Deno.test('verifyExtractedTree fails closed when export-ignore drops entity files from the archive', async () => {
  const { root, repo } = await makeRepo();
  try {
    await Deno.mkdir(`${repo}/entities`, { recursive: true });
    await Deno.writeTextFile(`${repo}/entities/keep.yaml`, 'name: Keep\n');
    await Deno.writeTextFile(`${repo}/entities/hidden.yaml`, 'name: Hidden\n');
    await Deno.writeTextFile(`${repo}/.gitattributes`, 'entities/hidden.yaml export-ignore\n');
    await git(['add', '-A'], repo);
    await git(['commit', '-m', 'one'], repo);
    const commit = await resolveCommit(repo, 'HEAD');

    const dest = `${root}/tree`;
    await Deno.mkdir(dest);
    await extractTreeAtRef(repo, commit, dest);
    const error = await assertRejects(() => verifyExtractedTree(repo, commit, dest), IncomingPreviewError);
    assertEquals(error.code, 'incoming_unavailable');
    assert(error.message.includes('archive_export_ignore'));
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('verifyExtractedTree rejects symlinks anywhere in the tree', async () => {
  const { root, repo } = await makeRepo();
  try {
    await Deno.mkdir(`${repo}/entities`, { recursive: true });
    await Deno.writeTextFile(`${repo}/entities/a.yaml`, 'name: A\n');
    await Deno.symlink('/etc/passwd', `${repo}/entities/link.yaml`);
    await git(['add', '-A'], repo);
    await git(['commit', '-m', 'one'], repo);
    const commit = await resolveCommit(repo, 'HEAD');

    const dest = `${root}/tree`;
    await Deno.mkdir(dest);
    await extractTreeAtRef(repo, commit, dest);
    await assertRejects(() => verifyExtractedTree(repo, commit, dest), IncomingPreviewError, 'symlink');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
