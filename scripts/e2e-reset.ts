/**
 * Manual E2E repo reset helper.
 *
 * Examples:
 *   deno task test:e2e:reset -- --database-name "E2E Dev" --head
 *   deno task test:e2e:reset -- --database-id 12 --commit <sha>
 *   deno task test:e2e:reset -- --database-name "E2E Dev" --commit <sha> --push
 */

import { Database } from '@jsr/db__sqlite';
import path from 'node:path';

type DatabaseRow = {
  id: number;
  name: string;
  local_path: string;
};

type CliOptions = {
  databaseId: number | null;
  databaseName: string | null;
  headOnly: boolean;
  commit: string | null;
  push: boolean;
};

function loadDotEnv(): void {
  const envPath = path.resolve('.env');
  let content = '';
  try {
    content = Deno.readTextFileSync(envPath);
  } catch {
    return;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (!Deno.env.get(key)) {
      Deno.env.set(key, value);
    }
  }
}

function printHelp(): void {
  console.log('E2E repo reset helper');
  console.log('');
  console.log('Usage:');
  console.log('  deno task test:e2e:reset -- --database-id <id> --head');
  console.log('  deno task test:e2e:reset -- --database-name "<name>" --head');
  console.log('  deno task test:e2e:reset -- --database-id <id> --commit <sha> [--push]');
  console.log('  deno task test:e2e:reset -- --database-name "<name>" --commit <sha> [--push]');
  console.log('');
  console.log('Flags:');
  console.log('  --database-id <id>       Database instance id from profilarr.db');
  console.log('  --database-name <name>   Database instance name from profilarr.db');
  console.log('  --head                   Print current HEAD commit and exit');
  console.log('  --commit <sha>           Reset local clone to this commit');
  console.log('  --push                   Force-push after reset');
  console.log('  --help, -h               Show this help');
}

function fail(message: string): never {
  console.error(message);
  console.error('');
  printHelp();
  Deno.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    databaseId: null,
    databaseName: null,
    headOnly: false,
    commit: null,
    push: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      Deno.exit(0);
    }

    if (arg === '--database-id') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --database-id');
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) fail(`Invalid --database-id: ${value}`);
      options.databaseId = parsed;
      i += 1;
      continue;
    }

    if (arg === '--database-name') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --database-name');
      options.databaseName = value;
      i += 1;
      continue;
    }

    if (arg === '--head') {
      options.headOnly = true;
      continue;
    }

    if (arg === '--commit') {
      const value = args[i + 1];
      if (!value) fail('Missing value for --commit');
      options.commit = value;
      i += 1;
      continue;
    }

    if (arg === '--push') {
      options.push = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  const hasId = options.databaseId !== null;
  const hasName = !!options.databaseName;
  if (hasId === hasName) {
    fail('Provide exactly one of --database-id or --database-name');
  }

  if (!options.headOnly && !options.commit) {
    fail('Provide --head or --commit <sha>');
  }

  return options;
}

function getDatabaseRow(dbPath: string, options: CliOptions): DatabaseRow {
  const db = new Database(dbPath, { readonly: true });
  try {
    let row: DatabaseRow | undefined;
    if (options.databaseId !== null) {
      row = db.prepare('SELECT id, name, local_path FROM database_instances WHERE id = ?').get(options.databaseId) as
        | DatabaseRow
        | undefined;
    } else {
      row = db
        .prepare('SELECT id, name, local_path FROM database_instances WHERE name = ?')
        .get(options.databaseName) as DatabaseRow | undefined;
    }

    if (!row) {
      const label = options.databaseId !== null ? `id ${options.databaseId}` : `name "${options.databaseName}"`;
      throw new Error(`Database instance not found for ${label}`);
    }

    return row;
  } finally {
    db.close();
  }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stdout, stderr } = await command.output();
  const stderrText = new TextDecoder().decode(stderr).trim();
  if (code !== 0) {
    throw new Error(stderrText || `git ${args.join(' ')} failed with exit code ${code}`);
  }
  return new TextDecoder().decode(stdout).trim();
}

loadDotEnv();
const options = parseArgs(Deno.args);
const dbPath = path.resolve(Deno.env.get('DB_PATH') || 'dist/dev/data/profilarr.db');
const dbRow = getDatabaseRow(dbPath, options);

if (options.headOnly) {
  const head = await runGit(['rev-parse', 'HEAD'], dbRow.local_path);
  console.log(head);
  Deno.exit(0);
}

const targetCommit = options.commit as string;
await runGit(['rev-parse', '--verify', `${targetCommit}^{commit}`], dbRow.local_path);
await runGit(['reset', '--hard', targetCommit], dbRow.local_path);

if (options.push) {
  await runGit(['push', '--force'], dbRow.local_path);
}

const newHead = await runGit(['rev-parse', 'HEAD'], dbRow.local_path);
console.log(
  `Reset database ${dbRow.id} "${dbRow.name}" to ${newHead}${options.push ? ' and force-pushed origin' : ''}.`
);
