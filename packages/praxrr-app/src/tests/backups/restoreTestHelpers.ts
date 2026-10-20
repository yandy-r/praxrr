/**
 * Shared fixtures for backup restore tests.
 */

import { Database } from '@jsr/db__sqlite';

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function tar(args: string[]): Promise<void> {
  const { code, stderr } = await new Deno.Command('tar', { args, stdout: 'piped', stderr: 'piped' }).output();
  if (code !== 0) {
    throw new Error(`tar failed: ${new TextDecoder().decode(stderr)}`);
  }
}

export function createSqliteDb(path: string, value: string): void {
  const database = new Database(path);
  try {
    database.exec('CREATE TABLE marker (value TEXT)');
    database.prepare('INSERT INTO marker (value) VALUES (?)').run(value);
  } finally {
    database.close();
  }
}

export function readMarker(path: string): string {
  const database = new Database(path, { readonly: true });
  try {
    const row = database.prepare('SELECT value FROM marker').get() as { value: string };
    return row.value;
  } finally {
    database.close();
  }
}

/** Build `<root>/data/praxrr.db` (+ extra file) and archive it as `data/...`. */
export async function buildValidArchive(root: string, archivePath: string, marker: string): Promise<void> {
  await Deno.mkdir(`${root}/data/databases`, { recursive: true });
  createSqliteDb(`${root}/data/praxrr.db`, marker);
  await Deno.writeTextFile(`${root}/data/databases/note.txt`, `${marker}\n`);
  await tar(['-czf', archivePath, '-C', root, 'data']);
}

/** Build a live base dir with a WAL database plus stray -wal/-shm files. */
export async function buildLiveBase(basePath: string): Promise<void> {
  await Deno.mkdir(`${basePath}/data`, { recursive: true });
  createSqliteDb(`${basePath}/data/praxrr.db`, 'live');
  await Deno.writeTextFile(`${basePath}/data/praxrr.db-wal`, 'stale-wal');
  await Deno.writeTextFile(`${basePath}/data/praxrr.db-shm`, 'stale-shm');
}

export async function listNames(dir: string, prefix: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.startsWith(prefix)) names.push(entry.name);
  }
  return names.sort();
}
