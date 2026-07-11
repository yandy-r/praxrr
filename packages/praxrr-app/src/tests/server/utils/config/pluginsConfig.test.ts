/**
 * Tests for the plugin-system config surface (issue #35): the non-throwing `config.pluginsEnabled`
 * feature flag and the lazy `config.paths.plugins` directory getter.
 *
 * `pluginsEnabled` is parsed once in the `Config` constructor via the existing non-throwing
 * `parseBooleanEnv` (like `pullOnStart`, NOT the default-on `mcpEnabled`), so the singleton's value
 * is cached at module-eval time — a `PLUGINS_ENABLED` typo can never brick boot. `paths.plugins`, in
 * contrast, reads `PLUGINS_DIR` lazily on every access, so env mutation after import is observable
 * (mirrors `parserUrl.test.ts`). No directory is created here — the host stats-and-degrades instead.
 */

import { assertEquals } from '@std/assert';
import { config } from '$config';

const PLUGINS_DIR_ENV = 'PLUGINS_DIR';

/** Save/restore `PLUGINS_DIR` around a body so the lazy getter can be exercised without leaking env. */
function withPluginsDir(value: string | undefined, run: () => void): void {
  const saved = Deno.env.get(PLUGINS_DIR_ENV);
  try {
    if (value === undefined) Deno.env.delete(PLUGINS_DIR_ENV);
    else Deno.env.set(PLUGINS_DIR_ENV, value);
    run();
  } finally {
    if (saved === undefined) Deno.env.delete(PLUGINS_DIR_ENV);
    else Deno.env.set(PLUGINS_DIR_ENV, saved);
  }
}

Deno.test('config.pluginsEnabled defaults to false when PLUGINS_ENABLED is unset', () => {
  // Constructor-cached from module-eval; the test process leaves PLUGINS_ENABLED unset.
  assertEquals(config.pluginsEnabled, false);
});

Deno.test('config.pluginsEnabled is a strict boolean produced by a non-throwing parse', () => {
  // Reaching this assertion at all proves importing `$config` (which runs `parseBooleanEnv` in the
  // constructor) never threw — module-eval safety. Unlike `parsePositiveIntEnv`, the boolean parser
  // coerces any/invalid value to `false` rather than throwing, so the field is always a strict boolean.
  assertEquals(typeof config.pluginsEnabled, 'boolean');
});

Deno.test('config.paths.plugins defaults to `${basePath}/plugins` when PLUGINS_DIR is unset', () => {
  withPluginsDir(undefined, () => {
    assertEquals(config.paths.plugins, `${config.paths.base}/plugins`);
  });
});

Deno.test('config.paths.plugins honors a PLUGINS_DIR override (lazy getter)', () => {
  withPluginsDir('/srv/praxrr/plugins', () => {
    assertEquals(config.paths.plugins, '/srv/praxrr/plugins');
  });
});

Deno.test('config.paths.plugins trims a PLUGINS_DIR override', () => {
  withPluginsDir('  /custom/plugins  ', () => {
    assertEquals(config.paths.plugins, '/custom/plugins');
  });
});

Deno.test('config.paths.plugins falls back to the default for an empty/whitespace PLUGINS_DIR (non-throwing)', () => {
  const fallback = `${config.paths.base}/plugins`;
  withPluginsDir('', () => {
    assertEquals(config.paths.plugins, fallback);
  });
  withPluginsDir('   ', () => {
    assertEquals(config.paths.plugins, fallback);
  });
});
