/**
 * YAN-1996: a failed remote fetch must surface instead of being reported as "no updates", and the
 * surfaced error must never carry the personal access token or its `http.extraHeader` value.
 */
import { assert, assertEquals, assertFalse, assertInstanceOf, assertRejects, assertStringIncludes } from '@std/assert';
import { redactGitOutput } from '$utils/git/exec.ts';
import {
  checkForUpdates,
  classifyGitFetchFailure,
  fetch,
  fetchTags,
  getIncomingChanges,
  getStatus,
  GitFetchError,
  NotGitRepositoryError,
} from '$utils/git/index.ts';

const TOKEN = 'ghp_FetchFailureTestToken1234567890';
const ENCODED_HEADER = btoa(`x-access-token:${TOKEN}`);

function tempPath(name: string): string {
  return `/tmp/praxrr-tests/${name}-${crypto.randomUUID()}`;
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command('git', {
    args,
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  return new TextDecoder().decode(stdout).trim();
}

/** A clone of a local seed repository whose `origin` is then pointed at `remoteUrl`. */
async function createCloneWithRemote(remoteUrl: string): Promise<{ root: string; clonePath: string }> {
  const root = tempPath('git-fetch-failure');
  const seedPath = `${root}/seed`;
  const clonePath = `${root}/clone`;
  await Deno.mkdir(seedPath, { recursive: true });
  await git(['init', '--initial-branch=main'], seedPath);
  await git(['config', 'user.name', 'Praxrr Test'], seedPath);
  await git(['config', 'user.email', 'praxrr@example.invalid'], seedPath);
  await Deno.writeTextFile(`${seedPath}/pcd.json`, '{"name":"seed"}\n');
  await git(['add', 'pcd.json'], seedPath);
  await git(['commit', '-m', 'test: seed'], seedPath);
  await git(['clone', seedPath, clonePath]);
  await git(['remote', 'set-url', 'origin', remoteUrl], clonePath);
  return { root, clonePath };
}

function assertNoCredentials(text: string): void {
  assertFalse(text.includes(TOKEN), `token leaked: ${text}`);
  assertFalse(text.includes(ENCODED_HEADER), `encoded header leaked: ${text}`);
}

Deno.test('redactGitOutput strips the token, the extraHeader value and URL userinfo', () => {
  const raw = [
    `fatal: repository '/srv/${TOKEN}/repo.git' not found`,
    `trace: http.https://github.com/.extraheader=Authorization: Basic ${ENCODED_HEADER}`,
    `> Authorization: Basic ${ENCODED_HEADER}`,
    `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/o/r.git/'`,
    `fatal: unable to access 'https://someone:hunter2@github.com/o/r.git/'`,
  ].join('\n');

  const redacted = redactGitOutput(raw, { personalAccessToken: TOKEN });

  assertNoCredentials(redacted);
  assertFalse(redacted.includes('hunter2'));
  assertStringIncludes(redacted, '[REDACTED]');
  // Non-secret context is preserved for diagnostics.
  assertStringIncludes(redacted, 'github.com/o/r.git');

  // Header and userinfo redaction do not depend on knowing the token.
  const withoutToken = redactGitOutput(raw);
  assertFalse(withoutToken.includes(ENCODED_HEADER));
  assertFalse(withoutToken.includes('hunter2'));
});

Deno.test('classifyGitFetchFailure separates auth, network and unknown failures', () => {
  assertEquals(classifyGitFetchFailure("fatal: Authentication failed for 'https://github.com/o/r.git/'"), 'auth');
  assertEquals(classifyGitFetchFailure('remote: Invalid username or token.'), 'auth');
  assertEquals(classifyGitFetchFailure('The requested URL returned error: 403'), 'auth');
  assertEquals(classifyGitFetchFailure('remote: Repository not found.'), 'auth');
  assertEquals(classifyGitFetchFailure("fatal: could not read Username for 'https://github.com'"), 'auth');
  assertEquals(classifyGitFetchFailure('fatal: unable to access: Could not resolve host: github.com'), 'network');
  assertEquals(classifyGitFetchFailure('Failed to connect to github.com port 443'), 'network');
  assertEquals(classifyGitFetchFailure("fatal: '/gone' does not appear to be a git repository"), 'unknown');
});

Deno.test('a failed fetch throws instead of reporting "no updates" from every update check', async () => {
  const { root, clonePath } = await createCloneWithRemote(`${tempPath('missing-remote')}/repo.git`);
  try {
    await assertRejects(() => fetch(clonePath), GitFetchError);
    await assertRejects(() => fetchTags(clonePath), GitFetchError);
    await assertRejects(() => checkForUpdates(clonePath), GitFetchError);
    await assertRejects(() => getIncomingChanges(clonePath), GitFetchError);
    await assertRejects(() => getStatus(clonePath, { fetch: true }), GitFetchError);

    // Without a fetch, local status still works (the routes fall back to it).
    const status = await getStatus(clonePath);
    assertEquals(status.branch, 'main');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('a fetch that git echoes the token into never surfaces the token', async () => {
  // A local remote path containing the token makes git print it in its error output.
  const { root, clonePath } = await createCloneWithRemote(`${tempPath('missing')}/${TOKEN}/repo.git`);
  try {
    const error = await assertRejects(() => checkForUpdates(clonePath, { personalAccessToken: TOKEN }), GitFetchError);
    assertNoCredentials(error.message);
    assertNoCredentials(error.detail);
    assertStringIncludes(error.detail, '[REDACTED]');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('a remote that rejects credentials surfaces an auth failure with a token hint', async () => {
  const controller = new AbortController();
  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen: () => {} },
    () => new Response('denied', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="praxrr-test"' } })
  );
  const { port } = server.addr as Deno.NetAddr;
  // The token in the URL path is echoed by git in "Authentication failed for '<url>'".
  const { root, clonePath } = await createCloneWithRemote(`http://127.0.0.1:${port}/${TOKEN}/repo.git`);
  try {
    const error = await assertRejects(() => checkForUpdates(clonePath, { personalAccessToken: TOKEN }), GitFetchError);
    assertEquals(error.kind, 'auth');
    assertStringIncludes(error.message, 'personal access token');
    assertNoCredentials(error.message);
    assertNoCredentials(error.detail);
  } finally {
    controller.abort();
    await server.finished;
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('fetch outside a git repository still reports NotGitRepositoryError', async () => {
  const path = tempPath('not-a-repo');
  await Deno.mkdir(path, { recursive: true });
  try {
    const error = await assertRejects(() => fetch(path));
    assertInstanceOf(error, NotGitRepositoryError);
    assert(!(error instanceof GitFetchError));
  } finally {
    await Deno.remove(path, { recursive: true }).catch(() => {});
  }
});
