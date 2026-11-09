/**
 * YAN-460: a GitHub personal access token must never be persisted in a clone's .git/config
 * (and therefore never in backup archives). The token is supplied per git command only.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes, assertThrows } from '@std/assert';
import { buildGitEnv, GITHUB_CREDENTIAL_SCOPE } from '$utils/git/exec.ts';
import { clone, scrubRemoteCredentials, stripUrlCredentials } from '$utils/git/write.ts';
import { scrubStoredGitCredentials } from '$pcd/git/credentialScrub.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';

const TOKEN = 'ghp_TestOnlyToken1234567890abcdef';

function tempPath(name: string): string {
  return `/tmp/praxrr-tests/${name}-${crypto.randomUUID()}`;
}

async function git(args: string[], cwd?: string, env: Record<string, string> = {}): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command('git', {
    args,
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env },
  }).output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
  return new TextDecoder().decode(stdout).trim();
}

async function createSeedRepository(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
  await git(['init', '--initial-branch=main'], path);
  await git(['config', 'user.name', 'Praxrr Test'], path);
  await git(['config', 'user.email', 'praxrr@example.invalid'], path);
  await Deno.writeTextFile(`${path}/pcd.json`, '{"name":"seed"}\n');
  await git(['add', 'pcd.json'], path);
  await git(['commit', '-m', 'test: seed'], path);
}

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(vars)) Deno.env.set(key, value);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test('buildGitEnv scopes the token to GitHub as a per-command header and keeps helpers disabled', () => {
  const plain = buildGitEnv();
  assertEquals(plain.GIT_CONFIG_COUNT, '1');
  assertEquals(plain.GIT_CONFIG_KEY_0, 'credential.helper');
  assertEquals(plain.GIT_CONFIG_VALUE_0, '');
  assertEquals(plain.GIT_TERMINAL_PROMPT, '0');

  const env = buildGitEnv({ personalAccessToken: TOKEN });
  assertEquals(env.GIT_CONFIG_COUNT, '2');
  assertEquals(env.GIT_CONFIG_KEY_0, 'credential.helper');
  assertEquals(env.GIT_CONFIG_KEY_1, `http.${GITHUB_CREDENTIAL_SCOPE}.extraHeader`);
  assertEquals(env.GIT_CONFIG_VALUE_1, `Authorization: Basic ${btoa(`x-access-token:${TOKEN}`)}`);

  assertEquals(buildGitEnv({ personalAccessToken: '   ' }).GIT_CONFIG_COUNT, '1');
  assertThrows(() => buildGitEnv({ personalAccessToken: 'abc\nextra' }));
});

Deno.test('git resolves the per-command header for GitHub URLs only', async () => {
  const env = buildGitEnv({ personalAccessToken: TOKEN });
  const lookup = (url: string) =>
    git(['config', '--get-urlmatch', 'http.extraHeader', url], undefined, env).catch(() => '');

  assertEquals(await lookup('https://github.com/o/r'), env.GIT_CONFIG_VALUE_1);
  assertEquals(await lookup('https://github.com/o/r.git/info/refs'), env.GIT_CONFIG_VALUE_1);
  assertEquals(await lookup('https://gitlab.com/o/r'), '');
  assertEquals(await lookup('https://github.com.evil.example/o/r'), '');
  assertEquals(await lookup('http://github.com/o/r'), '');
});

Deno.test('clone with a personal access token stores a token-free remote URL in .git/config', async () => {
  const root = tempPath('pat-clone');
  const seed = `${root}/seed`;
  const target = `${root}/target`;
  const globalConfig = `${root}/gitconfig`;
  const repositoryUrl = 'https://github.com/praxrr-test/private-db';
  const originalFetch = globalThis.fetch;

  try {
    await createSeedRepository(seed);
    // Route the GitHub URL to the local seed so the test never touches the network.
    await Deno.writeTextFile(globalConfig, `[url "file://${seed}"]\n\tinsteadOf = ${repositoryUrl}\n`);
    let sawAuthorization = false;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sawAuthorization = headers.get('Authorization') === `Bearer ${TOKEN}`;
      return Promise.resolve(new Response(JSON.stringify({ private: true }), { status: 200 }));
    }) as typeof globalThis.fetch;

    const isPrivate = await withEnv({ GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' }, () =>
      clone(repositoryUrl, target, 'main', TOKEN)
    );

    assert(isPrivate);
    assert(sawAuthorization);
    assertEquals(await git(['config', '--local', '--get', 'remote.origin.url'], target), repositoryUrl);
    const gitConfig = await Deno.readTextFile(`${target}/.git/config`);
    assertFalse(gitConfig.includes(TOKEN), '.git/config must not contain the token');
    assertFalse(gitConfig.includes(btoa(`x-access-token:${TOKEN}`)), '.git/config must not contain the header');
    assertEquals(await Deno.readTextFile(`${target}/pcd.json`), '{"name":"seed"}\n');
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('stripUrlCredentials removes userinfo only from http(s) URLs', () => {
  assertEquals(stripUrlCredentials(`https://${TOKEN}@github.com/o/r`), 'https://github.com/o/r');
  assertEquals(stripUrlCredentials(`https://x-access-token:${TOKEN}@github.com/o/r.git`), 'https://github.com/o/r.git');
  assertEquals(stripUrlCredentials('https://github.com/o/r'), 'https://github.com/o/r');
  assertEquals(stripUrlCredentials('/srv/pcd/local'), '/srv/pcd/local');
  assertEquals(stripUrlCredentials('git@github.com:o/r.git'), 'git@github.com:o/r.git');
  assertEquals(stripUrlCredentials('file:///srv/pcd/local'), 'file:///srv/pcd/local');
});

Deno.test('scrubRemoteCredentials rewrites a legacy token-bearing origin and is a no-op afterwards', async () => {
  const root = tempPath('pat-scrub');
  try {
    await createSeedRepository(root);
    await git(['remote', 'add', 'origin', `https://${TOKEN}@github.com/praxrr-test/private-db`], root);

    assert(await scrubRemoteCredentials(root));
    assertEquals(await git(['remote', 'get-url', 'origin'], root), 'https://github.com/praxrr-test/private-db');
    const gitConfig = await Deno.readTextFile(`${root}/.git/config`);
    assertFalse(gitConfig.includes(TOKEN));
    assertStringIncludes(gitConfig, 'https://github.com/praxrr-test/private-db');

    assertFalse(await scrubRemoteCredentials(root));
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('scrubRemoteCredentials ignores repositories without an origin', async () => {
  const root = tempPath('pat-scrub-no-origin');
  try {
    await createSeedRepository(root);
    assertFalse(await scrubRemoteCredentials(root));
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('scrubStoredGitCredentials cleans PCD, dependency and TRaSH clones and skips non-repos', async () => {
  const root = tempPath('pat-scrub-all');
  const pcd = `${root}/pcd`;
  const dep = `${pcd}/deps/praxrr-schema`;
  const trash = `${root}/trash`;
  const notRepo = `${root}/not-a-repo`;
  const dirty = (repo: string) => `https://x-access-token:${TOKEN}@github.com/praxrr-test/${repo}`;
  const restoreDb = databaseInstancesQueries.getAll;
  const restoreTrash = trashGuideSourcesQueries.getAll;

  try {
    for (const [path, repo] of [
      [pcd, 'db'],
      [dep, 'schema'],
      [trash, 'guides'],
    ] as const) {
      await createSeedRepository(path);
      await git(['remote', 'add', 'origin', dirty(repo)], path);
    }
    await Deno.mkdir(notRepo, { recursive: true });

    databaseInstancesQueries.getAll = (() => [
      { local_path: pcd },
      { local_path: notRepo },
    ]) as unknown as typeof databaseInstancesQueries.getAll;
    trashGuideSourcesQueries.getAll = (() => [
      { local_path: trash },
    ]) as unknown as typeof trashGuideSourcesQueries.getAll;

    const result = await scrubStoredGitCredentials();

    assertEquals(result.failed, []);
    assert(result.scrubbed >= 3);
    for (const [path, repo] of [
      [pcd, 'db'],
      [dep, 'schema'],
      [trash, 'guides'],
    ] as const) {
      assertEquals(await git(['remote', 'get-url', 'origin'], path), `https://github.com/praxrr-test/${repo}`);
      assertFalse((await Deno.readTextFile(`${path}/.git/config`)).includes(TOKEN));
    }
    assertEquals(await Deno.stat(`${notRepo}/.git`).catch(() => null), null);
  } finally {
    databaseInstancesQueries.getAll = restoreDb;
    trashGuideSourcesQueries.getAll = restoreTrash;
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
