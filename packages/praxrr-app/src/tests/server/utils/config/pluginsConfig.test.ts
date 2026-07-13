/**
 * Tests for the plugin-system config surface: the lazy `config.paths.plugins` directory getter.
 *
 * Runtime enablement is DB-backed via `$server/plugins/featureFlag.ts` (not env). `paths.plugins`
 * still reads `PLUGINS_DIR` lazily on every access, so env mutation after import is observable
 * (mirrors `parserUrl.test.ts`). No directory is created here — the host stats-and-degrades instead.
 *
 * Legacy `config.pluginsEnabled` remains as a deprecated env seed source for upgrades only.
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

Deno.test('legacy config.pluginsEnabled remains a boolean (env seed source only)', () => {
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
