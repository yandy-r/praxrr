/**
 * Plugin discovery — the sole filesystem boundary of the plugin subsystem (issue #35, Phase-1).
 *
 * `scanPluginDir` enumerates the immediate subdirectories of `PLUGINS_DIR`, reads each one's
 * `praxrr.plugin.json`, and JSON-parses it into a {@link RawManifestEntry}. It is deliberately
 * validation-free: malformed JSON is captured as `parseError` (never thrown), subdirs without a
 * manifest are skipped, and only unexpected filesystem errors propagate. Manifest validation,
 * registration, and dispatch live elsewhere so host orchestration stays pure and injectable.
 * `Deno.readDir` / `Deno.readTextFile` are injected via {@link ScanDeps} so tests can exercise the
 * unexpected-error rethrow path without provoking a real permission failure.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import { logger } from '$logger/logger.ts';

/** The manifest filename every plugin subdirectory must provide (orchestrator decision #1). */
const MANIFEST_FILENAME = 'praxrr.plugin.json';

/**
 * Upper bound on the number of candidate plugin directories a single scan reads. Exceeding it
 * truncates the scan and logs a warning — it NEVER throws, so a pathological `PLUGINS_DIR` cannot
 * stall or crash boot (finite-limit convention, without a throwing env parser at module eval).
 */
const MAX_PLUGIN_DIRS = 256;

/** One discovered plugin directory and the raw, unvalidated result of reading its manifest. */
export interface RawManifestEntry {
  /** Path to the plugin subdirectory (used later as the registry `sourceDir`). */
  readonly dir: string;
  /** The JSON-parsed manifest, present only when the file existed and parsed successfully. */
  readonly raw?: unknown;
  /** The JSON parse-failure message, present only when the manifest existed but was malformed. */
  readonly parseError?: string;
}

/**
 * Injectable filesystem surface. Defaults to Deno's real `readDir` / `readTextFile`; tests override
 * it to drive the unexpected-error rethrow path deterministically.
 */
export interface ScanDeps {
  readonly readDir: (path: string) => AsyncIterable<Deno.DirEntry>;
  readonly readTextFile: (path: string) => Promise<string>;
}

const DEFAULT_SCAN_DEPS: ScanDeps = {
  readDir: (path) => Deno.readDir(path),
  readTextFile: (path) => Deno.readTextFile(path),
};

/**
 * Read one subdirectory's manifest. Returns `null` when the subdir has no manifest (skipped), an
 * entry carrying `raw` on success, or an entry carrying `parseError` on malformed JSON. Only
 * unexpected filesystem errors (anything other than {@link Deno.errors.NotFound}) propagate.
 */
async function readManifestEntry(subdir: string, deps: ScanDeps): Promise<RawManifestEntry | null> {
  const manifestPath = `${subdir}/${MANIFEST_FILENAME}`;
  let text: string;
  try {
    text = await deps.readTextFile(manifestPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }

  try {
    return { dir: subdir, raw: JSON.parse(text) as unknown };
  } catch (error) {
    return { dir: subdir, parseError: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Scan `dir` for plugin manifests — one {@link RawManifestEntry} per immediate subdirectory that
 * contains a readable `praxrr.plugin.json`. Malformed JSON is captured, not thrown; subdirs without a
 * manifest are skipped; a missing `dir` yields an empty result. Only unexpected filesystem errors
 * propagate. At most {@link MAX_PLUGIN_DIRS} directories are read (excess is truncated + logged).
 */
export async function scanPluginDir(
  dir: string,
  deps: ScanDeps = DEFAULT_SCAN_DEPS
): Promise<readonly RawManifestEntry[]> {
  const entries: RawManifestEntry[] = [];
  let scanned = 0;
  let truncated = false;

  try {
    for await (const entry of deps.readDir(dir)) {
      if (!entry.isDirectory) {
        continue;
      }
      if (scanned >= MAX_PLUGIN_DIRS) {
        truncated = true;
        break;
      }
      scanned += 1;
      const parsed = await readManifestEntry(`${dir}/${entry.name}`, deps);
      if (parsed !== null) {
        entries.push(parsed);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return entries;
    }
    throw error;
  }

  if (truncated) {
    await logger.warn('Plugin scan truncated: too many candidate directories', {
      source: 'Plugins',
      meta: { dir, limit: MAX_PLUGIN_DIRS },
    });
  }

  return entries;
}
