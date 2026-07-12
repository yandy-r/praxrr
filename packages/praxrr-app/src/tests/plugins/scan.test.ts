/**
 * Plugin discovery scan tests (issue #35, Phase-1).
 *
 * Exercises `scanPluginDir` against a real temporary `PLUGINS_DIR` (one raw entry per subdir that
 * contains a `praxrr.plugin.json`, malformed JSON captured as `parseError` rather than thrown,
 * manifest-less subdirs and stray files skipped, empty/missing directories tolerated) and drives the
 * unexpected-filesystem-error rethrow paths through an injected throwing {@link ScanDeps} — no real
 * permission failure required, so the assertion stays deterministic under `--allow-read`.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';
import { MAX_PLUGIN_MANIFEST_BYTES, scanPluginDir, type ScanDeps } from '$server/plugins/scan.ts';

Deno.test('scanPluginDir returns one raw entry per subdir containing a manifest', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'plugin-scan-manifests-' });
  try {
    await Deno.mkdir(`${dir}/alpha`);
    await Deno.mkdir(`${dir}/beta`);
    await Deno.writeTextFile(`${dir}/alpha/praxrr.plugin.json`, JSON.stringify({ id: 'com.example.alpha' }));
    await Deno.writeTextFile(`${dir}/beta/praxrr.plugin.json`, JSON.stringify({ id: 'com.example.beta' }));

    const entries = await scanPluginDir(dir);
    const byDir = new Map(entries.map((entry) => [entry.dir, entry]));

    assertEquals(entries.length, 2);
    assertEquals(byDir.get(`${dir}/alpha`)?.raw, { id: 'com.example.alpha' });
    assertEquals(byDir.get(`${dir}/beta`)?.raw, { id: 'com.example.beta' });
    // A successful read never carries a parse error.
    assert(entries.every((entry) => entry.parseError === undefined));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('scanPluginDir captures malformed JSON as parseError without throwing', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'plugin-scan-malformed-' });
  try {
    await Deno.mkdir(`${dir}/broken`);
    await Deno.writeTextFile(`${dir}/broken/praxrr.plugin.json`, '{ not valid json');

    const entries = await scanPluginDir(dir);

    assertEquals(entries.length, 1);
    assertEquals(entries[0].dir, `${dir}/broken`);
    assertEquals(entries[0].raw, undefined);
    assert(typeof entries[0].parseError === 'string');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('scanPluginDir rejects an oversized manifest before JSON parsing', async () => {
  const oversized = JSON.stringify({ value: 'x'.repeat(MAX_PLUGIN_MANIFEST_BYTES) });
  const deps: ScanDeps = {
    readDir: async function* (): AsyncGenerator<Deno.DirEntry> {
      yield { name: 'oversized', isFile: false, isDirectory: true, isSymlink: false };
    },
    readTextFile: () => Promise.resolve(oversized),
  };

  const entries = await scanPluginDir('/any/dir', deps);

  assertEquals(entries.length, 1);
  assertEquals(entries[0].raw, undefined);
  assertEquals(entries[0].parseError, `manifest exceeds ${MAX_PLUGIN_MANIFEST_BYTES} UTF-8 bytes`);
});

Deno.test('scanPluginDir applies the manifest limit to UTF-8 bytes, not string code units', async () => {
  const oversizedUtf8 = JSON.stringify({ value: 'é'.repeat(MAX_PLUGIN_MANIFEST_BYTES / 2) });
  assert(oversizedUtf8.length < MAX_PLUGIN_MANIFEST_BYTES);
  const deps: ScanDeps = {
    readDir: async function* (): AsyncGenerator<Deno.DirEntry> {
      yield { name: 'oversized-utf8', isFile: false, isDirectory: true, isSymlink: false };
    },
    readTextFile: () => Promise.resolve(oversizedUtf8),
  };

  const entries = await scanPluginDir('/any/dir', deps);

  assertEquals(entries[0].raw, undefined);
  assertEquals(entries[0].parseError, `manifest exceeds ${MAX_PLUGIN_MANIFEST_BYTES} UTF-8 bytes`);
});

Deno.test('scanPluginDir skips subdirs without a manifest and ignores non-directory entries', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'plugin-scan-skip-' });
  try {
    await Deno.mkdir(`${dir}/with-manifest`);
    await Deno.mkdir(`${dir}/no-manifest`);
    await Deno.writeTextFile(`${dir}/with-manifest/praxrr.plugin.json`, JSON.stringify({ id: 'com.example.present' }));
    await Deno.writeTextFile(`${dir}/no-manifest/README.md`, '# not a manifest');
    // A stray top-level file must not be treated as a plugin directory.
    await Deno.writeTextFile(`${dir}/loose.txt`, 'ignore me');

    const entries = await scanPluginDir(dir);

    assertEquals(entries.length, 1);
    assertEquals(entries[0].dir, `${dir}/with-manifest`);
    assertEquals(entries[0].raw, { id: 'com.example.present' });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('scanPluginDir tolerates an empty directory', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'plugin-scan-empty-' });
  try {
    assertEquals(await scanPluginDir(dir), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('scanPluginDir returns an empty result for a missing directory', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'plugin-scan-missing-' });
  await Deno.remove(dir, { recursive: true });
  // `dir` no longer exists: the NotFound from readDir degrades to an empty scan rather than throwing.
  assertEquals(await scanPluginDir(dir), []);
});

Deno.test('scanPluginDir rethrows an unexpected readDir error', async () => {
  // Inject an fs surface whose directory read fails with a non-NotFound error to model, e.g., a
  // permission failure deterministically — the scan must propagate it rather than swallow it.
  const deps: ScanDeps = {
    readDir: (): AsyncIterable<Deno.DirEntry> => {
      throw new Deno.errors.PermissionDenied('scan blocked');
    },
    readTextFile: () => Promise.reject(new Error('readTextFile must not be reached')),
  };

  await assertRejects(() => scanPluginDir('/any/dir', deps), Deno.errors.PermissionDenied, 'scan blocked');
});

Deno.test('scanPluginDir rethrows an unexpected manifest read error', async () => {
  // The directory lists fine, but reading the manifest fails with a non-NotFound error; that error
  // must surface instead of being captured as a parseError or skipped.
  const deps: ScanDeps = {
    readDir: async function* (): AsyncGenerator<Deno.DirEntry> {
      yield { name: 'alpha', isFile: false, isDirectory: true, isSymlink: false };
    },
    readTextFile: () => Promise.reject(new Deno.errors.PermissionDenied('manifest read blocked')),
  };

  await assertRejects(() => scanPluginDir('/any/dir', deps), Deno.errors.PermissionDenied, 'manifest read blocked');
});

Deno.test('scanPluginDir truncates at the finite MAX_PLUGIN_DIRS limit and never throws', async () => {
  // More candidate directories than the internal MAX_PLUGIN_DIRS (256): the scan must cap the read
  // (finite-limit DoS guard) and resolve rather than throw or run unbounded.
  const total = 300;
  const deps: ScanDeps = {
    readDir: async function* (): AsyncGenerator<Deno.DirEntry> {
      for (let i = 0; i < total; i += 1) {
        yield { name: `plugin-${i}`, isFile: false, isDirectory: true, isSymlink: false };
      }
    },
    readTextFile: () => Promise.resolve(JSON.stringify({ id: 'com.example.bulk' })),
  };

  const entries = await scanPluginDir('/any/dir', deps);
  assertEquals(entries.length, 256);
});
