import { assertEquals, assertMatch } from '@std/assert';
import { config } from '$config';
import { validateExportFilePaths } from '$pcd/ops/exporter.ts';
import { readLogsFromFile } from '$logger/reader.ts';

const status = (modified: string[], untracked: string[] = []) => ({ modified, untracked });

Deno.test('export file paths: accepts listed regular files inside the repo', async () => {
  const repo = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${repo}/a`);
    await Deno.writeTextFile(`${repo}/a/b.yaml`, 'x');
    await Deno.writeTextFile(`${repo}/new.yaml`, 'x');
    assertEquals(
      await validateExportFilePaths(repo, ['a/b.yaml', 'new.yaml'], status(['a/b.yaml'], ['new.yaml'])),
      null
    );
    assertEquals(await validateExportFilePaths(repo, [], undefined), null);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test('export file paths: rejects absolute, traversal, unlisted, excluded and symlinked paths', async () => {
  const repo = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${outside}/secret`, 's');
    await Deno.symlink(`${outside}/secret`, `${repo}/link`);
    await Deno.symlink(outside, `${repo}/dirlink`);
    await Deno.mkdir(`${repo}/ops`);
    await Deno.writeTextFile(`${repo}/ops/1.sql`, 'x');
    await Deno.writeTextFile(`${repo}/unlisted.yaml`, 'x');

    const cases = [
      `${outside}/secret`,
      '../secret',
      'a/../../secret',
      './unlisted.yaml',
      'unlisted.yaml',
      'ops/1.sql',
      'link',
      'dirlink/secret',
      'a\\..\\secret',
    ];
    const listed = status(cases);
    for (const fp of cases) {
      const error = await validateExportFilePaths(repo, [fp], fp === 'unlisted.yaml' ? status([]) : listed);
      assertMatch(error ?? '', /^Invalid file path/, `expected rejection for ${fp}`);
    }
    assertMatch((await validateExportFilePaths(repo, ['x'], undefined)) ?? '', /status unavailable/);
  } finally {
    await Deno.remove(repo, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test('log reader: only opens files listed in the logs directory', async () => {
  const logsDir = config.paths.logs;
  await Deno.mkdir(logsDir, { recursive: true });
  const name = '2099-01-01.log';
  const outsideName = `praxrr-traversal-${crypto.randomUUID()}.json`;
  const outsidePath = `${logsDir}/../${outsideName}`;
  try {
    await Deno.writeTextFile(`${logsDir}/${name}`, JSON.stringify({ timestamp: 't', message: 'ok' }) + '\n');
    await Deno.writeTextFile(outsidePath, JSON.stringify({ timestamp: 't', leaked: true }) + '\n');
    assertEquals((await readLogsFromFile(name)).length, 1);
    assertEquals(await readLogsFromFile(`../${outsideName}`), []);
    assertEquals(await readLogsFromFile('missing.log'), []);
  } finally {
    await Deno.remove(`${logsDir}/${name}`).catch(() => {});
    await Deno.remove(outsidePath).catch(() => {});
  }
});

Deno.test('git status: unquoted unicode names and files inside untracked dirs are exportable', async () => {
  const { getStatus } = await import('$utils/git/read.ts');
  const repo = await Deno.makeTempDir();
  const git = (...args: string[]) => new Deno.Command('git', { args, cwd: repo }).output();
  try {
    await git('init', '-q', '-b', 'main');
    await Deno.mkdir(`${repo}/newdir`);
    await Deno.writeTextFile(`${repo}/newdir/new.yaml`, 'x');
    await Deno.writeTextFile(`${repo}/étude.yaml`, 'x');
    const status = await getStatus(repo);
    assertEquals(status.untracked.sort(), ['newdir/new.yaml', 'étude.yaml'].sort());
    assertEquals(await validateExportFilePaths(repo, ['newdir/new.yaml', 'étude.yaml'], status), null);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
