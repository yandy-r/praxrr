#!/usr/bin/env -S deno run -A

import type { ParityReport } from '$pcd/migration/parityVerifier.ts';
import { formatStableJson } from '$pcd/migration/migrationImportUtils.ts';

interface RuntimeDependencies {
  config: {
    setBasePath: (path: string) => void;
    init: () => Promise<void>;
  };
  runMigrations: () => Promise<void>;
  db: { close: () => void };
  initializeDb: () => Promise<void>;
  verifyPcdParity: (options: { pcdPath: string }) => Promise<ParityReport>;
}

interface ParsedArgs {
  pcdPath: string | null;
  entitiesDir: string;
  strict: boolean;
  format: 'text' | 'json';
  verbose: boolean;
  help: boolean;
}

type ExitCode = 0 | 1 | 2 | 3;

type PathKind = 'missing' | 'file' | 'directory';
const KNOWN_BOOL_KEYS = new Set(['true', 'false']);

const USAGE = `Usage: deno task verify:pcd-parity [options]

Compares SQL-compiled PCD state against migration entity output.

Options:
  --pcd-path=<path>              Required. Path to a cloned PCD repository.
  --entities-dir=<path>           Directory containing migration entity files.
                                 Default: <pcd-path>/entities
  --strict                        Fail on parity mismatches.
                                 Default: true
  --strict=false                  Disable strict parity mismatch failures.
  --format=text|json              Output format. Default: text
  --verbose                       Print detailed diff list.
                                 Default: false
  --help, -h                     Show this help text.

Defaults:
  --strict=true
  --format=text
  --verbose=false
`;

async function loadRuntimeDependencies(runtimeBaseDir: string): Promise<RuntimeDependencies> {
  const [configModule, migrationModule, dbModule, parityModule] = await Promise.all([
    import('$config'),
    import('$db/migrations.ts'),
    import('$db/db.ts'),
    import('$pcd/migration/parityVerifier.ts'),
  ]);

  const config = configModule.config;

  config.setBasePath(runtimeBaseDir);

  return {
    config,
    runMigrations: migrationModule.runMigrations,
    db: { close: () => dbModule.db.close() },
    initializeDb: dbModule.db.initialize,
    verifyPcdParity: parityModule.verifyPcdParity,
  };
}

function parseArgs(rawArgs: string[]): ParsedArgs {
  const result: ParsedArgs = {
    pcdPath: null,
    entitiesDir: '',
    strict: true,
    format: 'text',
    verbose: false,
    help: false,
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }

    if (arg === '--verbose') {
      result.verbose = true;
      continue;
    }

    if (arg === '--strict') {
      result.strict = true;
      continue;
    }

    if (arg.startsWith('--strict=')) {
      const value = arg.slice('--strict='.length).trim().toLowerCase();
      if (!KNOWN_BOOL_KEYS.has(value)) {
        throw new UsageError(`Invalid --strict value: ${value}. Expected true or false.`);
      }
      result.strict = value === 'true';
      continue;
    }

    if (arg.startsWith('--pcd-path=')) {
      const value = arg.slice('--pcd-path='.length).trim();
      if (!value) {
        throw new UsageError('Missing value for --pcd-path');
      }
      result.pcdPath = value;
      continue;
    }

    if (arg === '--pcd-path') {
      if (i + 1 >= rawArgs.length) {
        throw new UsageError('Missing value for --pcd-path');
      }

      const value = rawArgs[i + 1].trim();
      if (!value) {
        throw new UsageError('Missing value for --pcd-path');
      }

      result.pcdPath = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--entities-dir=')) {
      const value = arg.slice('--entities-dir='.length).trim();
      if (!value) {
        throw new UsageError('Missing value for --entities-dir');
      }
      result.entitiesDir = value;
      continue;
    }

    if (arg === '--entities-dir') {
      if (i + 1 >= rawArgs.length) {
        throw new UsageError('Missing value for --entities-dir');
      }

      const value = rawArgs[i + 1].trim();
      if (!value) {
        throw new UsageError('Missing value for --entities-dir');
      }

      result.entitiesDir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length).trim().toLowerCase();
      if (value !== 'text' && value !== 'json') {
        throw new UsageError(`Invalid --format value: ${value}. Expected text or json.`);
      }
      result.format = value;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new UsageError(`Unknown option: ${arg}`);
    }

    throw new UsageError(`Unexpected positional argument: ${arg}`);
  }

  if (result.help) {
    return result;
  }

  if (result.pcdPath === null) {
    throw new UsageError('--pcd-path is required');
  }

  if (!result.entitiesDir) {
    result.entitiesDir = `${result.pcdPath}/entities`;
  }

  result.pcdPath = stripTrailingSeparators(result.pcdPath);
  result.entitiesDir = stripTrailingSeparators(result.entitiesDir);

  if (!result.pcdPath) {
    throw new UsageError('--pcd-path cannot be empty');
  }

  if (!result.entitiesDir) {
    throw new UsageError('--entities-dir cannot be empty');
  }

  return result;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, '');
}

async function getPathKind(path: string): Promise<PathKind> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory ? 'directory' : 'file';
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return 'missing';
    }
    throw error;
  }
}

async function ensureDirectory(path: string, label: string): Promise<void> {
  const pathKind = await getPathKind(path);
  if (pathKind === 'missing') {
    throw new UsageError(`${label} does not exist: ${path}`);
  }

  if (pathKind === 'file') {
    throw new UsageError(`${label} must be a directory: ${path}`);
  }
}

function toCanonicalPath(value: string): Promise<string> {
  return Deno.realPath(value);
}

function normalizeForComparison(value: string): string {
  return stripTrailingSeparators(value).replaceAll('\\', '/');
}

function isDefaultEntitiesDir(pcdPath: string, entitiesPath: string): Promise<boolean> {
  return Promise.all([
    toCanonicalPath(pcdPath).catch(() => pcdPath),
    toCanonicalPath(entitiesPath).catch(() => entitiesPath),
  ]).then(([canonicalPcdPath, canonicalEntitiesPath]) => {
    const normalizedEntities = `${normalizeForComparison(canonicalPcdPath)}/entities`;
    return normalizeForComparison(canonicalEntitiesPath) === normalizedEntities;
  });
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  const stat = await Deno.stat(source);
  if (stat.isDirectory) {
    await Deno.mkdir(destination, { recursive: true });
    for await (const entry of Deno.readDir(source)) {
      if (entry.name === '.git' && entry.isDirectory) {
        continue;
      }
      const sourcePath = `${source}/${entry.name}`;
      const destinationPath = `${destination}/${entry.name}`;
      if (entry.isDirectory) {
        await copyDirectory(sourcePath, destinationPath);
      } else if (entry.isFile) {
        await Deno.copyFile(sourcePath, destinationPath);
      }
    }
    return;
  }

  await Deno.copyFile(source, destination);
}

async function buildWorkspaceForEntitiesDir(
  pcdPath: string,
  entitiesDir: string
): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  if (await isDefaultEntitiesDir(pcdPath, entitiesDir)) {
    return {
      path: pcdPath,
      cleanup: () => Promise.resolve(),
    };
  }

  const workspaceDir = await Deno.makeTempDir({ prefix: 'praxrr-pcd-parity-' });

  try {
    for await (const entry of Deno.readDir(pcdPath)) {
      if (entry.name === '.git' || entry.name === 'entities') {
        continue;
      }
      const sourcePath = `${pcdPath}/${entry.name}`;
      const destinationPath = `${workspaceDir}/${entry.name}`;
      await copyDirectory(sourcePath, destinationPath);
    }

    await copyDirectory(entitiesDir, `${workspaceDir}/entities`);

    return {
      path: workspaceDir,
      cleanup: async () => {
        try {
          await Deno.remove(workspaceDir, { recursive: true });
        } catch {
          // Ignore cleanup failure for process exit.
        }
      },
    };
  } catch (error) {
    try {
      await Deno.remove(workspaceDir, { recursive: true });
    } catch {
      // Ignore cleanup failure for process exit.
    }
    throw error;
  }
}

function summarizeByTable(report: ParityReport): Map<string, { count: number; kinds: Set<string> }> {
  const byTable = new Map<string, { count: number; kinds: Set<string> }>();

  for (const diff of report.diffs) {
    const entry = byTable.get(diff.table);
    if (entry) {
      entry.count += 1;
      entry.kinds.add(diff.kind);
      continue;
    }

    byTable.set(diff.table, {
      count: 1,
      kinds: new Set([diff.kind]),
    });
  }

  return byTable;
}

function renderTextSummary(report: ParityReport, strict: boolean, verbose: boolean): string {
  const lines = [
    `Parity report: ${report.pass ? 'PASS' : 'FAIL'}`,
    `Tables compared: ${report.tablesCompared}`,
    `Rows in SQL snapshot: ${report.totalRowsA}`,
    `Rows in entity snapshot: ${report.totalRowsB}`,
    `Differences: ${report.diffs.length}`,
    `Strict: ${strict ? 'enabled' : 'disabled'}`,
  ];

  if (report.pass) {
    return lines.join('\n');
  }

  if (verbose) {
    lines.push('');
    lines.push(formatDetailedDifferences(report));
    return lines.join('\n');
  }

  const byTable = summarizeByTable(report);
  lines.push('');
  lines.push('Differences by table:');
  for (const [table, details] of [...byTable.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  ${table}: ${details.count} (${[...details.kinds].sort().join(', ')})`);
  }

  const limit = 12;
  const sampleDiffs = report.diffs.slice(0, limit);
  lines.push('');
  lines.push('Samples:');
  for (const diff of sampleDiffs) {
    const key = formatStableJson(diff.naturalKey);
    if (diff.kind === 'field_mismatch') {
      lines.push(`  - ${diff.table}: field_mismatch ${key}`);
      lines.push(`    ${diff.field}: ${formatStableJson(diff.valueA)} != ${formatStableJson(diff.valueB)}`);
      continue;
    }
    lines.push(`  - ${diff.table}: ${diff.kind} ${key}`);
  }

  if (report.diffs.length > sampleDiffs.length) {
    lines.push(`  ... and ${report.diffs.length - sampleDiffs.length} more differences`);
  }

  lines.push('');
  lines.push('Run with --verbose for full diff details.');

  return lines.join('\n');
}

function formatDetailedDifferences(report: ParityReport): string {
  return report.diffs
    .map((diff) => {
      if (diff.kind === 'field_mismatch') {
        return `${diff.table}: field_mismatch ${formatStableJson(diff.naturalKey)} ${diff.field}: ${formatStableJson(diff.valueA)} != ${formatStableJson(diff.valueB)}`;
      }

      return `${diff.table}: ${diff.kind} ${formatStableJson(diff.naturalKey)}`;
    })
    .join('\n');
}

function formatJsonOutput(report: ParityReport, args: ParsedArgs): string {
  return JSON.stringify(
    {
      status: report.pass ? 'pass' : 'fail',
      strict: args.strict,
      pcdPath: args.pcdPath,
      entitiesPath: args.entitiesDir,
      format: args.format,
      report,
    },
    null,
    2
  );
}

function isUsageOrValidationError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('--pcd-path') ||
    message.includes('--entities-dir') ||
    message.includes('does not exist') ||
    message.includes('must be a directory') ||
    message.includes('parity verifier failed') ||
    message.includes('unable to read migration entities from') ||
    message.includes('required table') ||
    message.includes('missing table')
  );
}

async function runParityCheck(args: ParsedArgs): Promise<ExitCode> {
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  await ensureDirectory(args.pcdPath ?? '', '--pcd-path');
  await ensureDirectory(args.entitiesDir, '--entities-dir');

  let runtimeDependencies: RuntimeDependencies | null = null;
  let runtimeBaseDir: string | null = null;
  let workspaceCleanup: (() => Promise<void>) | null = null;

  try {
    runtimeBaseDir = await Deno.makeTempDir({ prefix: 'praxrr-pcd-parity-runtime-' });
    runtimeDependencies = await loadRuntimeDependencies(runtimeBaseDir);

    await runtimeDependencies.config.init();
    await runtimeDependencies.initializeDb();
    await runtimeDependencies.runMigrations();

    const workspace = await buildWorkspaceForEntitiesDir(args.pcdPath ?? '', args.entitiesDir);
    workspaceCleanup = workspace.cleanup;

    const report = await runtimeDependencies.verifyPcdParity({
      pcdPath: workspace.path,
    });

    if (args.format === 'json') {
      console.log(formatJsonOutput(report, args));
    } else {
      console.log(renderTextSummary(report, args.strict, args.verbose));
    }

    if (report.pass) {
      return 0;
    }

    return args.strict ? 2 : 0;
  } catch (error) {
    if (error instanceof UsageError || isUsageOrValidationError(error)) {
      console.error(error.message);
      return 3;
    }

    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (workspaceCleanup) {
      await workspaceCleanup();
    }

    if (runtimeDependencies) {
      await runtimeDependencies.db.close();
    }

    if (runtimeBaseDir) {
      try {
        await Deno.remove(runtimeBaseDir, { recursive: true });
      } catch {
        // Ignore cleanup failure for process exit.
      }
    }
  }
}

if (import.meta.main) {
  try {
    const args = parseArgs(Deno.args);
    const exitCode = await runParityCheck(args);
    Deno.exit(exitCode);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error('\n');
      console.error(USAGE);
      Deno.exit(3);
    }

    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
