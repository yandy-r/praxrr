#!/usr/bin/env -S deno run -A

import type { EntityType } from '$shared/pcd/portable.ts';
import { ENTITY_TYPES } from '$shared/pcd/portable.ts';
import type { ConvertReport } from '$pcd/migration/converter.ts';

interface RuntimeDependencies {
  config: {
    setBasePath: (path: string) => void;
    init: () => Promise<void>;
  };
  compile: (pcdPath: string, databaseId: number) => Promise<unknown>;
  getCache: (databaseId: number) => {
    isBuilt: () => boolean;
    close: () => void;
  } | null;
  deleteCache: (databaseId: number) => void;
  importBaseOps: (
    databaseId: number,
    pcdPath: string,
    options: { pcdMigrationIngestionMode: 'sql-only' | 'hybrid' }
  ) => Promise<unknown>;
  runMigrations: () => Promise<void>;
  db: { close: () => void };
  initializeDb: () => Promise<void>;
  createDatabaseInstance: (input: {
    uuid: string;
    name: string;
    repositoryUrl: string;
    localPath: string;
    localOpsEnabled: boolean;
  conflictStrategy: string;
  }) => number;
  convertCompiledCacheToEntities: typeof import('$pcd/migration/converter.ts').convertCompiledCacheToEntities;
  ConverterConfigError: typeof import('$pcd/migration/converter.ts').ConverterConfigError;
  ConverterSerializationError: typeof import('$pcd/migration/converter.ts').ConverterSerializationError;
  ConverterWriteError: typeof import('$pcd/migration/converter.ts').ConverterWriteError;
}

async function loadRuntimeDependencies(runtimeBaseDir: string): Promise<RuntimeDependencies> {
  const configModule = await import('$config');
  const config = configModule.config;
  config.setBasePath(runtimeBaseDir);

  const [
    compilerModule,
    registryModule,
    importBaseOpsModule,
    migrationModule,
    dbModule,
    databaseInstancesModule,
    converterModule,
  ] = await Promise.all([
    import('$pcd/database/compiler.ts'),
    import('$pcd/database/registry.ts'),
    import('$pcd/ops/importBaseOps.ts'),
    import('$db/migrations.ts'),
    import('$db/db.ts'),
    import('$db/queries/databaseInstances.ts'),
    import('$pcd/migration/converter.ts'),
  ]);

  return {
    config,
    compile: compilerModule.compile,
    getCache: registryModule.getCache,
    deleteCache: registryModule.deleteCache,
    importBaseOps: importBaseOpsModule.importBaseOps,
    runMigrations: migrationModule.runMigrations,
    db: { close: () => dbModule.db.close() },
    initializeDb: () => dbModule.db.initialize(),
    createDatabaseInstance: databaseInstancesModule.databaseInstancesQueries.create,
    convertCompiledCacheToEntities: converterModule.convertCompiledCacheToEntities,
    ConverterConfigError: converterModule.ConverterConfigError,
    ConverterSerializationError: converterModule.ConverterSerializationError,
    ConverterWriteError: converterModule.ConverterWriteError,
  };
}

type PortableFormat = 'yaml' | 'json';

interface ParsedArgs {
  pcdPath: string | null;
  outputDir: string;
  format: PortableFormat;
  entityTypes: readonly EntityType[];
  overwrite: boolean;
  dryRun: boolean;
  strict: boolean;
  verbose: boolean;
  help: boolean;
}

interface StandaloneCacheContext {
  runtimeBaseDir: string;
  databaseId: number;
  dependencies: RuntimeDependencies;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

class PathConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathConflictError';
  }
}

type ExitCode = 0 | 1 | 2 | 3;

const KNOWN_ENTITY_TYPES = new Set<EntityType>(ENTITY_TYPES);

const USAGE = `Usage: deno task convert:pcd-entities [options]

Converts a PCD repo at --pcd-path into migration entity files.

Options:
  --pcd-path=<path>            Required. Path to a cloned PCD repository.
  --output-dir=<path>           Output directory for entity files.
                               Default: <pcd-path>/entities
  --format=yaml|json            Output format. Default: yaml
  --entity-type=<type>          Repeatable filter for one or more entity types.
  --overwrite                   Allow writing to an existing --output-dir.
                               Default: false
  --dry-run                     Preview planned writes without writing files.
                               Default: false
  --strict                      Include migration metadata in output.
                               Default: false
  --verbose                     Print file-level details.
                               Default: false
  --help, -h                    Show this help text.

Defaults:
  --format=yaml
  --overwrite=false
  --dry-run=false
  --strict=false
  --verbose=false
`;

function parseArgs(rawArgs: string[]): ParsedArgs {
  const result: ParsedArgs = {
    pcdPath: null,
    outputDir: '',
    format: 'yaml',
    entityTypes: [],
    overwrite: false,
    dryRun: false,
    strict: false,
    verbose: false,
    help: false,
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }

    if (arg === '--overwrite') {
      result.overwrite = true;
      continue;
    }

    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }

    if (arg === '--strict') {
      result.strict = true;
      continue;
    }

    if (arg === '--verbose') {
      result.verbose = true;
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

    if (arg.startsWith('--output-dir=')) {
      const value = arg.slice('--output-dir='.length).trim();
      if (!value) {
        throw new UsageError('Missing value for --output-dir');
      }
      result.outputDir = value;
      continue;
    }

    if (arg === '--output-dir') {
      if (i + 1 >= rawArgs.length) {
        throw new UsageError('Missing value for --output-dir');
      }

      const value = rawArgs[i + 1].trim();
      if (!value) {
        throw new UsageError('Missing value for --output-dir');
      }

      result.outputDir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length).trim().toLowerCase();
      if (!isPortableFormat(value)) {
        throw new UsageError(`Invalid --format value: ${value}. Expected yaml or json.`);
      }
      result.format = value;
      continue;
    }

    if (arg.startsWith('--entity-type=')) {
      const value = arg.slice('--entity-type='.length).trim();
      if (!value) {
        throw new UsageError('Missing value for --entity-type');
      }
      if (!KNOWN_ENTITY_TYPES.has(value as EntityType)) {
        throw new UsageError(`Invalid --entity-type value: ${value}`);
      }
      result.entityTypes = [...result.entityTypes, value as EntityType];
      continue;
    }

    if (arg === '--entity-type') {
      if (i + 1 >= rawArgs.length) {
        throw new UsageError('Missing value for --entity-type');
      }

      const value = rawArgs[i + 1].trim();
      if (!value) {
        throw new UsageError('Missing value for --entity-type');
      }

      if (!KNOWN_ENTITY_TYPES.has(value as EntityType)) {
        throw new UsageError(`Invalid --entity-type value: ${value}`);
      }

      result.entityTypes = [...result.entityTypes, value as EntityType];
      i += 1;
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

  if (!result.outputDir) {
    result.outputDir = `${result.pcdPath}/entities`;
  }

  result.pcdPath = stripTrailingSeparators(result.pcdPath);
  result.outputDir = stripTrailingSeparators(result.outputDir);

  if (!result.pcdPath) {
    throw new UsageError('--pcd-path cannot be empty');
  }

  if (!result.outputDir) {
    throw new UsageError('--output-dir cannot be empty');
  }

  return result;
}

function isPortableFormat(value: string): value is PortableFormat {
  return value === 'yaml' || value === 'json';
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, '');
}

type PathKind = 'missing' | 'file' | 'directory';

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

async function assertNoOutputConflict(outputDir: string, overwrite: boolean): Promise<void> {
  const pathKind = await getPathKind(outputDir);
  if (pathKind === 'file') {
    throw new PathConflictError(`outputDir exists but is not a directory: ${outputDir}`);
  }

  if (pathKind === 'directory' && !overwrite) {
    throw new PathConflictError(`outputDir already exists and overwrite is disabled: ${outputDir}`);
  }
}

async function collectFiles(rootDir: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const nextRelative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(`${dir}/${entry.name}`, nextRelative);
        continue;
      }
      paths.push(nextRelative);
    }
  }

  await walk(rootDir, '');
  paths.sort();
  return paths;
}

async function buildStandaloneCache(
  pcdPath: string,
  verbose: boolean,
  dependencies: RuntimeDependencies,
  runtimeBaseDir: string
): Promise<StandaloneCacheContext> {
  let databaseId: number | null = null;

  try {
    await dependencies.config.init();
    await dependencies.initializeDb();
    await dependencies.runMigrations();

    databaseId = dependencies.createDatabaseInstance({
      uuid: crypto.randomUUID(),
      name: `pcd-converter-${Date.now()}`,
      repositoryUrl: `file://${pcdPath}`,
      localPath: pcdPath,
      localOpsEnabled: false,
      conflictStrategy: 'override',
    });

    if (verbose) {
      console.log(`Created standalone database instance ${databaseId}`);
    }

    await dependencies.importBaseOps(databaseId, pcdPath, { pcdMigrationIngestionMode: 'sql-only' });
    await dependencies.compile(pcdPath, databaseId);

    const cache = dependencies.getCache(databaseId);
    if (!cache) {
      throw new Error('Compiled cache was not produced for the temporary PCD instance');
    }

    if (!cache.isBuilt()) {
      cache.close();
      dependencies.deleteCache(databaseId);
      throw new Error('Compiled cache is not ready for conversion');
    }

    return {
      runtimeBaseDir,
      databaseId,
      dependencies,
    };
  } catch (error) {
    if (databaseId !== null) {
      await cleanupStandaloneCache({ runtimeBaseDir, databaseId, dependencies }, dependencies);
    } else {
      try {
        await Deno.remove(runtimeBaseDir, { recursive: true });
      } catch {
        // Ignore cleanup failure for process exit.
      }
    }

    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}

async function cleanupStandaloneCache(
  context: StandaloneCacheContext | null,
  dependencies: RuntimeDependencies | null
): Promise<void> {
  if (context === null) {
    return;
  }

  const cache = dependencies?.getCache(context.databaseId) ?? null;
  if (cache) {
    cache.close();
    dependencies?.deleteCache(context.databaseId);
  }

  try {
    dependencies?.db.close();
  } catch {
    // Ignore cleanup failure for process exit.
  }

  try {
    await Deno.remove(context.runtimeBaseDir, { recursive: true });
  } catch {
    // Ignore cleanup failure for process exit.
  }
}

function formatPlannedWrites(directory: string, files: string[]): void {
  for (const file of files) {
    console.log(`  ${directory}/${file}`);
  }
}

async function runConversion(args: ParsedArgs): Promise<ExitCode> {
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const pcdPath = args.pcdPath ?? '';
  const outputDir = stripTrailingSeparators(args.outputDir);
  let runtime: StandaloneCacheContext | null = null;
  let conversionOutputDir: string | null = null;
  let runtimeDependencies: RuntimeDependencies | null = null;

  await ensureDirectory(pcdPath, '--pcd-path');

  if (args.dryRun) {
    await assertNoOutputConflict(outputDir, args.overwrite);
  }

  try {
    const runtimeBaseDir = await Deno.makeTempDir({ prefix: 'praxrr-pcd-runtime-' });
    runtimeDependencies = await loadRuntimeDependencies(runtimeBaseDir);
    runtime = await buildStandaloneCache(pcdPath, args.verbose, runtimeDependencies, runtimeBaseDir);
    if (args.verbose) {
      console.log(`Built standalone cache at ${runtime.runtimeBaseDir}`);
    }

    conversionOutputDir = args.dryRun
      ? await Deno.makeTempDir({ prefix: 'praxrr-converter-output-' })
      : outputDir;

    const cache = runtime.dependencies.getCache(runtime.databaseId);
    if (!cache) {
      throw new Error('Failed to access compiled cache');
    }

    const report: ConvertReport = await runtime.dependencies.convertCompiledCacheToEntities({
      cache,
      outputDir: conversionOutputDir,
      format: args.format,
      overwrite: args.overwrite,
      entityTypes: args.entityTypes.length > 0 ? args.entityTypes : undefined,
      includeMigrationMetadata: args.strict,
    });

    const writtenFiles = await collectFiles(conversionOutputDir);
    if (writtenFiles.length > 0) {
      if (args.verbose || args.dryRun) {
        console.log(`${args.dryRun ? 'Planned' : 'Wrote'} files:`);
        formatPlannedWrites(args.dryRun ? outputDir : conversionOutputDir, writtenFiles);
      } else {
        console.log(
          `Conversion complete. Wrote ${report.writtenFiles}/${report.totalFiles} files to ${args.dryRun ? outputDir : conversionOutputDir}.`
        );
      }
    }

    if (args.verbose) {
      for (const summary of report.entitySummaries) {
        console.log(`  ${summary.relativeDir}: ${summary.written}/${summary.total}`);
      }
      console.log(`Total files: ${report.writtenFiles}/${report.totalFiles}`);
      console.log(`Output dir: ${args.dryRun ? outputDir : conversionOutputDir}`);
    } else if (args.dryRun) {
      console.log(`Planned file count: ${report.totalFiles}`);
      console.log(`Dry-run complete. No files were written to ${outputDir}`);
    }

    return 0;
  } catch (error) {
    if (error instanceof PathConflictError || isPathConflictError(error, runtime?.dependencies ?? runtimeDependencies)) {
      console.error(error instanceof Error ? error.message : String(error));
      return 3;
    }

    if (error instanceof UsageError || isConverterConfigError(error, runtime?.dependencies ?? runtimeDependencies)) {
      console.error(error.message);
      return 2;
    }

    if (isConverterConversionError(error, runtime?.dependencies ?? runtimeDependencies)) {
      console.error(error.message);
      if ('failures' in error && Array.isArray((error as { failures?: unknown[] }).failures)) {
        const failures = (error as { failures: Array<Record<string, unknown>> }).failures;
        const limit = args.verbose ? failures.length : Math.min(failures.length, 20);
        for (let i = 0; i < limit; i += 1) {
          const failure = failures[i];
          const path = typeof failure.path === 'string' ? failure.path : '<unknown-path>';
          const stage = typeof failure.stage === 'string' ? failure.stage : 'unknown-stage';
          const message = typeof failure.message === 'string' ? failure.message : 'unknown failure';
          console.error(`  [${stage}] ${path}: ${message}`);
        }
        if (!args.verbose && failures.length > limit) {
          console.error(`  ... ${failures.length - limit} more failures omitted (use --verbose)`);
        }
      }
      return 1;
    }

    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (args.dryRun && conversionOutputDir) {
      try {
        await Deno.remove(conversionOutputDir, { recursive: true });
      } catch {
        // Ignore cleanup failure for process exit.
      }
    }

    await cleanupStandaloneCache(runtime, runtime?.dependencies ?? runtimeDependencies);
  }
}

function isPathConflictError(error: unknown, runtimeDependencies: RuntimeDependencies | null): boolean {
  if (!runtimeDependencies || !isConverterConfigError(error, runtimeDependencies)) {
    return false;
  }

  const message = (error as Error).message.toLowerCase();
  return (
    message.includes('outputdir already exists and overwrite is disabled') ||
    message.includes('outputdir exists but is not a directory')
  );
}

function isConverterConfigError(
  error: unknown,
  runtimeDependencies: RuntimeDependencies | null
): error is Error {
  if (runtimeDependencies === null) {
    return false;
  }

  return error instanceof runtimeDependencies.ConverterConfigError;
}

function isConverterConversionError(
  error: unknown,
  runtimeDependencies: RuntimeDependencies | null
): error is Error {
  if (runtimeDependencies === null) {
    return false;
  }

  return (
    error instanceof runtimeDependencies.ConverterSerializationError ||
    error instanceof runtimeDependencies.ConverterWriteError
  );
}

if (import.meta.main) {
  try {
    const args = parseArgs(Deno.args);
    const exitCode = await runConversion(args);
    if (exitCode === 2) {
      console.error('\n');
      console.error(USAGE);
    }
    Deno.exit(exitCode);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error('\n');
      console.error(USAGE);
      Deno.exit(2);
    }

    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
