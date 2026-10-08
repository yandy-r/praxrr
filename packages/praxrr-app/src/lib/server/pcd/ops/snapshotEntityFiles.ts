/**
 * Shared serializer-side helpers for exporting entities from an ephemeral snapshot cache
 * into a repo checkout's `entities/` directory tree.
 */
import { parse as parseYaml } from '@std/yaml';
import type { EntityType } from '$shared/pcd/portable.ts';
import { logger } from '$logger/logger.ts';
import type { PCDCache } from '$pcd/index.ts';
import { formatDeterministicYaml } from '$pcd/migration/yamlFormatter.ts';
import { ENTITY_DIRECTORY_BY_TYPE, serializeEntityPortable } from '$pcd/migration/converter.ts';
import { resolveEntitySlug } from '$pcd/migration/slug.ts';
import { parseOpMetadata, type EntityRef } from './exportSnapshot.ts';

export type { EntityRef };

export const ENTITY_YAML_ROOT = 'entities';

/** Re-export op-label parsing so exporter + repair share one SQL-label regex. */
export function parseOpLabelLabels(sql: string): EntityRef[] {
  const refs: EntityRef[] = [];
  const pattern = /-- --- BEGIN op \d+ \(\s*(create|update|delete)\s+(\S+)\s+"([^"]+)"\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const type = (match[2] === 'metadata_profile' ? 'lidarr_metadata_profile' : match[2]) as EntityType;
    refs.push({ type, name: match[3] });
  }
  return refs;
}

/** Parse an op-row-metadata set of affected entities (same derive pass as the exporter). */
export function affectedFromMetadata(labels: Array<ReturnType<typeof parseOpMetadata>>): EntityRef[] {
  const seen = new Map<string, EntityRef>();
  for (const metadata of labels) {
    if (!metadata?.entity || !metadata.name) continue;
    const key = `${metadata.entity}::${metadata.name}`;
    if (!seen.has(key)) seen.set(key, { type: metadata.entity as EntityType, name: metadata.name });
  }
  return [...seen.values()];
}

function dirPath(repoDir: string, type: EntityType): string {
  return `${repoDir}/${ENTITY_YAML_ROOT}/${ENTITY_DIRECTORY_BY_TYPE[type]}`;
}

export async function symlinkSafeWrite(repoDir: string, absolutePath: string, content: string): Promise<null> {
  if (!absolutePath.startsWith(`${repoDir}/`)) throw new Error(`Path escapes repo clone: ${absolutePath}`);
  const relative = absolutePath.slice(repoDir.length + 1);
  let current = repoDir;
  for (const segment of relative.split('/').slice(0, -1)) {
    current = `${current}/${segment}`;
    const info = await Deno.lstat(current).catch(() => null);
    if (info?.isSymlink) throw new Error(`Symlink on export path: ${relative}`);
    if (!info) await Deno.mkdir(current);
  }
  const targetInfo = await Deno.lstat(absolutePath).catch(() => null);
  if (targetInfo?.isSymlink) throw new Error(`Symlink on export path: ${relative}`);
  await Deno.writeTextFile(absolutePath, content);
  return null;
}

/** Enumerate existing slug stems (`<slug>` of `<slug>.yaml|.yml|.json`) in a clone dir. */
export async function existingSlugs(dir: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      const match = entry.name.match(/^(.+)\.(yaml|yml|json)$/i);
      if (match) entries.set(match[1], entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return entries;
}

/** Find the entity file whose parsed top-level `name` equals `name`. */
async function findEntityFileByName(directory: string, name: string): Promise<string | null> {
  const entries: Array<Deno.DirEntry> = [];
  try {
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile || !/\.(yaml|yml)$/i.test(entry.name)) continue;
    const parsed = parseYaml(await Deno.readTextFile(`${directory}/${entry.name}`)) as { name?: unknown };
    if (typeof parsed?.name === 'string' && parsed.name.toLowerCase() === name.toLowerCase()) return entry.name;
  }
  return null;
}

/**
 * Serialize `ref` from the snapshot cache and write (or reuse the exact existing file of)
 * `entities/<dir>/<slug>.yaml` in the clone. Returns the absolute path written. Fails fast.
 * Regen semantics: an existing file for the SAME entity (matched by parsed `name`) is
 * overwritten in place, never suffixed — the export tree must mirror canonical state.
 */
export async function writeSnapshotEntityYaml(repoDir: string, cache: PCDCache, ref: EntityRef): Promise<string> {
  const directory = dirPath(repoDir, ref.type);
  await Deno.mkdir(directory, { recursive: true });
  const portable = await serializeEntityPortable(ref.type, cache, ref.name);
  const document = formatDeterministicYaml(portable);
  const sameEntityFile = await findEntityFileByName(directory, ref.name);
  if (sameEntityFile) {
    const absolutePath = `${directory}/${sameEntityFile}`;
    await symlinkSafeWrite(repoDir, absolutePath, document);
    return absolutePath;
  }
  const slugs = await existingSlugs(directory);
  const slug = resolveEntitySlug(ref.name, slugs.keys());
  const existing = slugs.get(slug);
  const absolutePath = existing ? `${directory}/${existing}` : `${directory}/${slug}.yaml`;
  await symlinkSafeWrite(repoDir, absolutePath, document);
  return absolutePath;
}

/**
 * Remove the file in `ref.type`'s dir whose parsed top-level `name` equals `ref.name`.
 * Returns the removed absolute path; warns and returns null when no file matches.
 */
export async function removeSnapshotEntityYaml(
  repoDir: string,
  ref: EntityRef,
  databaseId: number
): Promise<string | null> {
  const directory = dirPath(repoDir, ref.type);
  const entries: Array<Deno.DirEntry> = [];
  try {
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile || !/\.(yaml|yml)$/i.test(entry.name)) continue;
    const absolutePath = `${directory}/${entry.name}`;
    let parsed: { name?: unknown };
    try {
      parsed = parseYaml(await Deno.readTextFile(absolutePath)) as { name?: unknown };
    } catch (error) {
      throw new Error(
        `Failed to parse entity file ${ENTITY_YAML_ROOT}/${ENTITY_DIRECTORY_BY_TYPE[ref.type]}/${entry.name}: ${String(error)}`
      );
    }
    if (parsed?.name === ref.name) {
      await Deno.remove(absolutePath);
      return absolutePath;
    }
  }
  await logger.warn(`Export YAML removal skipped: no entity file named "${ref.name}"`, {
    source: 'PCDExporter',
    meta: { databaseId, entity: ref.type, name: ref.name },
  });
  return null;
}
