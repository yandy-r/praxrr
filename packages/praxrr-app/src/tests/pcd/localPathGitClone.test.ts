import { assertEquals } from '@std/assert';
import { clone, refreshLocalRepositoryClone } from '$utils/git/write.ts';

function tempPath(name: string): string {
  return `/tmp/praxrr-tests/${name}-${crypto.randomUUID()}`;
}

Deno.test('git clone supports filesystem path repositories for development', async () => {
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

    const isPrivate = await clone(source, target);

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
