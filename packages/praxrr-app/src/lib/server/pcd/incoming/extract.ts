/**
 * Git plumbing for the incoming-upstream preview (YAN-570).
 *
 * Everything here is read-only with respect to the user's clone: the strict fetch updates a
 * single remote-tracking ref (never HEAD, the index, the working tree or tags), and the tree is
 * materialized with `git archive` into a caller-owned temp directory (no `.git`, no worktree
 * registration). All commands use argument arrays; no string reaches a shell.
 */

import { execGit } from '$utils/git/exec.ts';
import { IncomingPreviewError } from './types.ts';

const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: '',
};

/** Reject branch names that could be interpreted as options, revision ranges or path escapes. */
export function assertSafeBranchName(branch: string): void {
  if (
    !BRANCH_PATTERN.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    branch.endsWith('.lock')
  ) {
    throw new IncomingPreviewError('incoming_unavailable', `Refusing to preview unsafe branch name "${branch}"`);
  }
}

/**
 * Fetch exactly `origin/<branch>`. Unlike the silent `fetch()` helper this THROWS on failure so a
 * stale ref is never previewed as if it were current. Only `refs/remotes/origin/<branch>` moves.
 */
export async function fetchRemoteBranchStrict(repoPath: string, branch: string): Promise<void> {
  assertSafeBranchName(branch);
  try {
    await execGit(
      [
        '-c',
        'gc.auto=0',
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        'origin',
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ],
      repoPath
    );
  } catch (error) {
    throw new IncomingPreviewError(
      'fetch_failed',
      `Failed to fetch origin/${branch}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/** Resolve a ref to its full commit SHA so listing and archiving address the same object. */
export async function resolveCommit(repoPath: string, ref: string): Promise<string> {
  if (ref.startsWith('-')) {
    throw new IncomingPreviewError('incoming_unavailable', `Refusing unsafe ref "${ref}"`);
  }
  try {
    const sha = await execGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoPath);
    if (!COMMIT_PATTERN.test(sha)) {
      throw new Error(`unexpected rev-parse output "${sha}"`);
    }
    return sha;
  } catch (error) {
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Cannot resolve ${ref}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

/**
 * Materialize the tree at `commit` into `destDir` (`git archive | tar -x`). `commit` MUST be a
 * full SHA from `resolveCommit`. `git archive` and `tar` are piped together, so a failure of
 * either can surface as a broken pipe on the other; both statuses are awaited with
 * `Promise.allSettled` before reporting, and any failure is `incoming_unavailable`.
 */
export async function extractTreeAtRef(repoPath: string, commit: string, destDir: string): Promise<void> {
  if (!COMMIT_PATTERN.test(commit)) {
    throw new IncomingPreviewError('incoming_unavailable', 'extractTreeAtRef requires a full commit SHA');
  }

  const archive = new Deno.Command('git', {
    args: ['archive', '--format=tar', commit],
    cwd: repoPath,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    env: GIT_ENV,
  }).spawn();
  const tar = new Deno.Command('tar', {
    args: ['-x', '-f', '-', '-C', destDir],
    stdin: 'piped',
    stdout: 'null',
    stderr: 'piped',
  }).spawn();

  const settled = await Promise.allSettled([
    archive.stdout.pipeTo(tar.stdin),
    archive.status,
    tar.status,
    readAll(archive.stderr),
    readAll(tar.stderr),
  ]);
  const [pipeResult, archiveStatusResult, tarStatusResult, archiveErrResult, tarErrResult] = settled;

  const firstReason = (entry: (typeof settled)[number]) => (entry.status === 'rejected' ? String(entry.reason) : null);
  const message = (detail: string | null) =>
    new IncomingPreviewError(
      'incoming_unavailable',
      `Failed to extract the upstream tree at ${commit.slice(0, 12)}: ${detail ?? 'unknown error'}`
    );

  if (firstReason(pipeResult)) throw message(firstReason(pipeResult));
  if (firstReason(archiveErrResult)) throw message(firstReason(archiveErrResult));
  if (firstReason(tarErrResult)) throw message(firstReason(tarErrResult));
  if (archiveStatusResult.status === 'fulfilled' && !archiveStatusResult.value.success) {
    const stderr = archiveErrResult.status === 'fulfilled' ? archiveErrResult.value.trim() : 'unknown error';
    throw message(`git archive failed: ${stderr}`);
  }
  if (tarStatusResult.status === 'fulfilled' && !tarStatusResult.value.success) {
    const stderr = tarErrResult.status === 'fulfilled' ? tarErrResult.value.trim() : 'unknown error';
    throw message(`tar extraction failed: ${stderr}`);
  }
  if (archiveStatusResult.status === 'rejected') throw message(firstReason(archiveStatusResult));
  if (tarStatusResult.status === 'rejected') throw message(firstReason(tarStatusResult));
}

/**
 * One entry per blob/tree of the upstream tree: `mode SP type SP path` from
 * `git ls-tree -r -z --full-tree <commit>`. Raw modes expose symlinks (120000) and submodule
 * gitlinks (160000), which `git archive` silently skips or materializes as empty dirs.
 */
export async function listTreeEntries(repoPath: string, commit: string): Promise<string[]> {
  if (commit.startsWith('-')) {
    throw new IncomingPreviewError('incoming_unavailable', 'Refusing unsafe ls-tree arguments');
  }
  const output = await execGit(['ls-tree', '-r', '-z', '--full-tree', commit], repoPath);
  return output.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Reject upstream trees the preview cannot faithfully materialize: any symlink (mode 120000) or
 * gitlink/submodule (mode 160000) anywhere, and any tracked path under `deps/` (dependencies are
 * resolved by `syncDependencies`, never taken from the upstream tree).
 */
export async function assertPreviewableTree(repoPath: string, commit: string): Promise<void> {
  const entries = await listTreeEntries(repoPath, commit);
  const offenders: string[] = [];
  let depsTracked = false;
  for (const raw of entries) {
    const tabIndex = raw.indexOf('\t');
    if (tabIndex === -1) continue;
    const meta = raw.slice(0, tabIndex);
    const path = raw.slice(tabIndex + 1);
    const mode = meta.split(' ')[0];
    if (mode === '120000' || mode === '160000') offenders.push(`${mode} ${path}`);
    if (path === 'deps' || path.startsWith('deps/')) depsTracked = true;
  }
  if (depsTracked) {
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Upstream tree tracks files under deps/ (${commit.slice(0, 12)}); dependencies must come from the manifest, not the PCD repo`
    );
  }
  if (offenders.length > 0) {
    const shown = offenders.slice(0, 3).join(', ');
    const suffix = offenders.length > 3 ? ` (+${offenders.length - 3} more)` : '';
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Upstream tree contains symlink/submodule entries (${shown}${suffix}); refusing to preview`
    );
  }
}

async function walkFiles(root: string, relative: string, out: string[]): Promise<void> {
  try {
    for await (const entry of Deno.readDir(`${root}/${relative}`)) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymlink) {
        throw new IncomingPreviewError(
          'incoming_unavailable',
          `Extracted tree contains a symlink (${child}); refusing to preview`
        );
      }
      if (entry.isDirectory) {
        await walkFiles(root, child, out);
      } else {
        out.push(child);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

/**
 * Cross-check the ENTIRE extracted tree against `git ls-tree`: `git archive` honours
 * `export-ignore`, so a difference means files (entities, tweaks, the manifest, ...) silently
 * went missing. Fails closed on any difference or on a symlink anywhere in the tree.
 */
export async function verifyExtractedTree(repoPath: string, commit: string, extractedDir: string): Promise<void> {
  const extracted: string[] = [];
  await walkFiles(extractedDir, '', extracted);

  const listed: string[] = [];
  for (const raw of await listTreeEntries(repoPath, commit)) {
    const tabIndex = raw.indexOf('\t');
    if (tabIndex === -1) continue;
    const path = raw.slice(tabIndex + 1);
    const type = raw.slice(0, tabIndex).split(' ')[1];
    // gitlinks never extract as content; assertPreviewableTree already rejected them.
    if (type !== 'tree') listed.push(path);
  }

  const listedSet = new Set(listed);
  const extractedSet = new Set(extracted);
  const missing = listed.filter((path) => !extractedSet.has(path));
  const extra = extracted.filter((path) => !listedSet.has(path));
  if (missing.length > 0 || extra.length > 0) {
    throw new IncomingPreviewError(
      'incoming_unavailable',
      `Extracted tree does not match git ls-tree at ${commit.slice(0, 12)} (archive_export_ignore): missing=${missing.length}, unexpected=${extra.length}`
    );
  }
}

/**
 * Seed `destRoot/deps` with the clone's installed dependency checkouts (skipping any already
 * present in the extracted tree) so `syncDependencies` against the temp tree only fetches when the
 * incoming manifest actually changes a dependency ref -- the same condition the real pull has.
 * Refuses symlinks: a symlinked dependency checkout is not a state the preview can reproduce.
 */
export async function copyInstalledDependencies(cloneRoot: string, destRoot: string): Promise<void> {
  const source = `${cloneRoot}/deps`;
  const existingDeps = await Deno.lstat(`${destRoot}/deps`).then(
    (info) => info,
    () => null
  );
  if (existingDeps?.isSymlink) {
    throw new IncomingPreviewError('incoming_unavailable', 'Temp tree deps/ resolved to a symlink; refusing to copy');
  }

  await Deno.mkdir(`${destRoot}/deps`, { recursive: true });
  try {
    for await (const entry of Deno.readDir(source)) {
      // Reject symlinked checkouts at the source too: `copyDirectory` only guards entries.
      const sourceInfo = await Deno.lstat(`${source}/${entry.name}`);
      if (sourceInfo.isSymlink) {
        throw new IncomingPreviewError(
          'incoming_unavailable',
          `Installed dependency checkout is a symlink (${source}/${entry.name}); refusing to preview`
        );
      }
      const target = `${destRoot}/deps/${entry.name}`;
      const targetInfo = await Deno.lstat(target).then(
        (info) => info,
        () => null
      );
      if (targetInfo) continue;
      await copyDirectory(`${source}/${entry.name}`, target);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

async function copyDirectory(from: string, to: string): Promise<void> {
  const sourceInfo = await Deno.lstat(from).then(
    (info) => info,
    () => null
  );
  if (!sourceInfo?.isDirectory) {
    throw new IncomingPreviewError('incoming_unavailable', `Dependency checkout at ${from} is not a directory`);
  }

  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (entry.isSymlink) {
      throw new IncomingPreviewError(
        'incoming_unavailable',
        `Dependency checkout contains a symlink (${from}/${entry.name}); refusing to preview`
      );
    }
    const src = `${from}/${entry.name}`;
    const dst = `${to}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDirectory(src, dst);
    } else if (entry.isFile) {
      await Deno.copyFile(src, dst);
    }
  }
}
