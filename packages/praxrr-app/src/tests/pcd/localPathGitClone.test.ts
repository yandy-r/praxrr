import { assert, assertEquals, assertRejects } from '@std/assert';
import { clone, refreshLocalRepositoryClone } from '$utils/git/write.ts';
import { fetchRemoteBranch, getAheadBehind } from '$pcd/ops/exporter.ts';

function tempPath(name: string): string {
  return `/tmp/praxrr-tests/${name}-${crypto.randomUUID()}`;
}

async function git(args: string[], cwd?: string): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
    },
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr));
  }
  return new TextDecoder().decode(stdout).trim();
}

async function createWorkingRepository(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
  await git(['init', '--initial-branch=main'], path);
  await git(['config', 'user.name', 'Praxrr Test'], path);
  await git(['config', 'user.email', 'praxrr@example.invalid'], path);
  await Deno.writeTextFile(`${path}/pcd.json`, '{"name":"committed"}\n');
  await git(['add', 'pcd.json'], path);
  await git(['commit', '-m', 'test: seed local repository'], path);
}

Deno.test('git clone preserves recursive-copy behavior for non-Git filesystem directories', async () => {
  const root = tempPath('local-clone');
  const source = `${root}/source`;
  const target = `${root}/target`;

  try {
    await Deno.mkdir(`${source}/entities/demo`, { recursive: true });
    await Deno.writeTextFile(
      `${source}/pcd.json`,
      JSON.stringify(
        {
          name: 'Local Dev DB',
          version: '1.0.0',
          description: 'Local dev fixture',
          dependencies: {
            'https://github.com/yandy-r/praxrr-schema': '1.0.0',
          },
          praxrr: {
            minimum_version: '2.1.0',
          },
        },
        null,
        2
      )
    );
    await Deno.writeTextFile(`${source}/entities/demo/item.yaml`, 'name: demo\n');

    const isPrivate = await clone(source, target, 'ignored-for-non-git-source');

    assertEquals(isPrivate, false);
    assertEquals(await Deno.readTextFile(`${target}/pcd.json`), await Deno.readTextFile(`${source}/pcd.json`));
    assertEquals(
      await Deno.readTextFile(`${target}/entities/demo/item.yaml`),
      await Deno.readTextFile(`${source}/entities/demo/item.yaml`)
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('git clone turns a working local Git source into a clean clone on the requested branch', async () => {
  const root = tempPath('local-working-git-clone');
  const source = `${root}/source`;
  const target = `${root}/target`;

  try {
    await createWorkingRepository(source);
    await Deno.writeTextFile(`${source}/pcd.json`, '{"name":"dirty"}\n');
    await Deno.writeTextFile(`${source}/untracked.txt`, 'must not be copied\n');

    const isPrivate = await clone(source, target, 'main');

    assertEquals(isPrivate, false);
    assertEquals(await git(['status', '--porcelain'], target), '');
    assertEquals(await git(['branch', '--show-current'], target), 'main');
    assertEquals(await git(['rev-parse', 'origin/main'], target), await git(['rev-parse', 'HEAD'], target));
    assertEquals(await git(['remote', 'get-url', 'origin'], target), source);
    assertEquals(await Deno.readTextFile(`${target}/pcd.json`), '{"name":"committed"}\n');
    assertEquals(await Deno.stat(`${target}/untracked.txt`).catch(() => null), null);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('git clone from a bare local source retains a writable origin/main', async () => {
  const root = tempPath('local-bare-git-clone');
  const seed = `${root}/seed`;
  const source = `${root}/source.git`;
  const target = `${root}/target`;

  try {
    await createWorkingRepository(seed);
    await git(['clone', '--bare', seed, source]);

    await clone(`file://${source}`, target, 'main');

    assertEquals(await git(['status', '--porcelain'], target), '');
    assertEquals(await git(['branch', '--show-current'], target), 'main');
    assertEquals(await git(['rev-parse', 'origin/main'], target), await git(['rev-parse', 'HEAD'], target));
    assertEquals(await git(['remote', 'get-url', 'origin'], target), `file://${source}`);

    await git(['config', 'user.name', 'Praxrr Test'], target);
    await git(['config', 'user.email', 'praxrr@example.invalid'], target);
    await Deno.writeTextFile(`${target}/pcd.json`, '{"name":"pushed"}\n');
    await git(['add', 'pcd.json'], target);
    await git(['commit', '-m', 'test: verify writable origin'], target);
    await git(['push', 'origin', 'main'], target);

    assertEquals(await git(['rev-parse', 'refs/heads/main'], source), await git(['rev-parse', 'HEAD'], target));
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('export preflight fetch keeps a local bare origin/main and reports divergence', async () => {
  const root = tempPath('local-bare-preflight-fetch');
  const seed = `${root}/seed`;
  const source = `${root}/source.git`;
  const target = `${root}/target`;
  const updater = `${root}/updater`;
  const remoteUrl = `file://${source}`;

  try {
    await createWorkingRepository(seed);
    await git(['clone', '--bare', seed, source]);
    await clone(remoteUrl, target, 'main');
    await git(['clone', remoteUrl, updater]);

    await git(['config', 'user.name', 'Praxrr Test'], updater);
    await git(['config', 'user.email', 'praxrr@example.invalid'], updater);
    await Deno.writeTextFile(`${updater}/remote.txt`, 'remote change\n');
    await git(['add', 'remote.txt'], updater);
    await git(['commit', '-m', 'test: advance bare remote'], updater);
    await git(['push', 'origin', 'main'], updater);

    await fetchRemoteBranch(target, remoteUrl, 'main');
    assertEquals(await git(['rev-parse', 'origin/main'], target), await git(['rev-parse', 'HEAD'], updater));
    assertEquals(await getAheadBehind(target, 'main'), { ahead: 0, behind: 1 });

    await git(['config', 'user.name', 'Praxrr Test'], target);
    await git(['config', 'user.email', 'praxrr@example.invalid'], target);
    await Deno.writeTextFile(`${target}/local.txt`, 'local change\n');
    await git(['add', 'local.txt'], target);
    await git(['commit', '-m', 'test: create local divergence'], target);

    assertEquals(await getAheadBehind(target, 'main'), { ahead: 1, behind: 1 });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('local Git clone reports a bounded safe failure and removes partial output', async () => {
  const root = tempPath('local-git-clone-error');
  const source = `${root}/source`;
  const target = `${root}/target`;

  try {
    await createWorkingRepository(source);

    const error = await assertRejects(() => clone(source, target, 'missing-branch'), Error, 'Local Git clone failed');
    assert(!error.message.includes('GIT_ASKPASS'));
    assertEquals(await Deno.stat(target).catch(() => null), null);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('git clone supports file:// repository paths for development', async () => {
  const root = tempPath('local-clone-file-url');
  const source = `${root}/source`;
  const target = `${root}/target`;

  try {
    await Deno.mkdir(source, { recursive: true });
    await Deno.writeTextFile(
      `${source}/pcd.json`,
      JSON.stringify(
        {
          name: 'Local Dev DB',
          version: '1.0.0',
          description: 'Local dev fixture',
          dependencies: {
            'https://github.com/yandy-r/praxrr-schema': '1.0.0',
          },
          praxrr: {
            minimum_version: '2.1.0',
          },
        },
        null,
        2
      )
    );

    const isPrivate = await clone(`file://${source}`, target);

    assertEquals(isPrivate, false);
    assertEquals(await Deno.readTextFile(`${target}/pcd.json`), await Deno.readTextFile(`${source}/pcd.json`));
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('local repository refresh re-copies source changes into target clone', async () => {
  const root = tempPath('local-clone-refresh');
  const source = `${root}/source`;
  const target = `${root}/target`;

  try {
    await Deno.mkdir(source, { recursive: true });
    await Deno.writeTextFile(`${source}/pcd.json`, '{"name":"before"}\n');

    await clone(source, target);
    assertEquals(await Deno.readTextFile(`${target}/pcd.json`), '{"name":"before"}\n');

    await Deno.writeTextFile(`${source}/pcd.json`, '{"name":"after"}\n');

    await refreshLocalRepositoryClone(source, target);
    assertEquals(await Deno.readTextFile(`${target}/pcd.json`), '{"name":"after"}\n');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test('local Git repository refresh preserves the target clone branch', async () => {
  const root = tempPath('local-git-clone-branch-refresh');
  const source = `${root}/source`;
  const target = `${root}/target`;

  try {
    await createWorkingRepository(source);
    await git(['switch', '-c', 'develop'], source);
    await Deno.writeTextFile(`${source}/pcd.json`, '{"name":"develop-before"}\n');
    await git(['add', 'pcd.json'], source);
    await git(['commit', '-m', 'test: seed develop branch'], source);
    await git(['switch', 'main'], source);

    await clone(source, target, 'develop');

    await git(['switch', 'develop'], source);
    await Deno.writeTextFile(`${source}/pcd.json`, '{"name":"develop-after"}\n');
    await git(['add', 'pcd.json'], source);
    await git(['commit', '-m', 'test: advance develop branch'], source);
    await git(['switch', 'main'], source);

    await refreshLocalRepositoryClone(source, target);

    assertEquals(await git(['branch', '--show-current'], target), 'develop');
    assertEquals(await Deno.readTextFile(`${target}/pcd.json`), '{"name":"develop-after"}\n');
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
