/**
 * Version Management Script
 *
 * Centralizes version bumps across the monorepo. Updates package.json,
 * praxrr-app/deno.json, and .release-please-manifest.json in lockstep.
 * Optionally updates praxrr-db and praxrr-schema versions, creates git tags,
 * and pushes tags to GitHub.
 *
 * Usage:
 *   deno task version 0.2.3
 *   deno task version 0.2.3 --db-version=0.2.0 --schema-version=1.1.0
 *   deno task version 0.2.3 --create-git-tags --publish --dry-run
 *   deno task publish:app 0.2.3                # shorthand for --create-git-tags --publish
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const VERSION_FILES = {
  packageJson: 'package.json',
  appDenoJson: 'packages/praxrr-app/deno.json',
  dbDenoJson: 'packages/praxrr-db/deno.json',
  schemaDenoJson: 'packages/praxrr-schema/deno.json',
  releaseManifest: '.release-please-manifest.json',
} as const;

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

interface CliArgs {
  version?: string;
  dbVersion?: string;
  schemaVersion?: string;
  createGitTags: boolean;
  publish: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    createGitTags: false,
    publish: false,
    dryRun: false,
    help: false,
  };

  for (const arg of Deno.args) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--db-version=')) {
      args.dbVersion = arg.slice('--db-version='.length);
    } else if (arg.startsWith('--schema-version=')) {
      args.schemaVersion = arg.slice('--schema-version='.length);
    } else if (arg === '--create-git-tags') {
      args.createGitTags = true;
    } else if (arg === '--publish' || arg === '--publish-to-gh') {
      args.publish = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (!arg.startsWith('-')) {
      args.version = arg;
    }
  }

  // --publish implies --create-git-tags
  if (args.publish) args.createGitTags = true;

  return args;
}

function printHelp(): void {
  console.log(`
Version Management Script

Centralizes version bumps across the Praxrr monorepo.

USAGE:
  deno task version <version> [OPTIONS]

ARGUMENTS:
  version                    Semver version (e.g. 0.2.3). Falls back to APP_VERSION env var.

OPTIONS:
  --db-version=X.Y.Z        Also update praxrr-db package version
  --schema-version=X.Y.Z    Also update praxrr-schema package version
  --create-git-tags          Create git tags (app/vX.Y.Z, and db/schema if their versions given)
  --publish                  Push created tags to origin (implies --create-git-tags)
  --dry-run                  Preview changes without writing
  --help, -h                 Show this help message

FILES UPDATED:
  package.json                        Always (app version)
  packages/praxrr-app/deno.json       Always (tracks app version)
  .release-please-manifest.json "."   Always
  packages/praxrr-db/deno.json        When --db-version given
  .release-please-manifest.json db    When --db-version given
  packages/praxrr-schema/deno.json    When --schema-version given
  .release-please-manifest.json schema When --schema-version given

TAGS CREATED (with --create-git-tags):
  app/v{version}                      Always
  db/v{dbVersion}                     When --db-version given
  schema/v{schemaVersion}             When --schema-version given

EXAMPLES:
  deno task version 0.2.3
  deno task version 0.2.3 --dry-run
  deno task version 0.2.3 --db-version=0.2.0 --schema-version=1.1.0
  deno task version 0.2.3 --create-git-tags
  deno task version 0.2.3 --publish
  deno task publish:app 0.2.3              # shorthand for --create-git-tags --publish
`);
}

// ============================================================================
// HELPERS
// ============================================================================

function stripVPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

function validateSemver(version: string, label: string): string {
  const cleaned = stripVPrefix(version);
  if (!SEMVER_RE.test(cleaned)) {
    throw new Error(`Invalid semver for ${label}: "${version}" (expected X.Y.Z)`);
  }
  return cleaned;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(path);
  return JSON.parse(text);
}

async function writeJson(path: string, data: Record<string, unknown>, dryRun: boolean): Promise<void> {
  const text = JSON.stringify(data, null, 2) + '\n';
  if (dryRun) return;
  await Deno.writeTextFile(path, text);
}

interface VersionChange {
  file: string;
  field: string;
  oldVersion: string;
  newVersion: string;
}

// ============================================================================
// VERSION UPDATE LOGIC
// ============================================================================

async function collectChanges(
  appVersion: string,
  dbVersion?: string,
  schemaVersion?: string
): Promise<VersionChange[]> {
  const changes: VersionChange[] = [];

  // package.json — app version
  const pkg = await readJson(VERSION_FILES.packageJson);
  const pkgOld = pkg.version as string;
  if (pkgOld !== appVersion) {
    changes.push({ file: VERSION_FILES.packageJson, field: 'version', oldVersion: pkgOld, newVersion: appVersion });
  }

  // praxrr-app/deno.json — tracks app version
  const appDeno = await readJson(VERSION_FILES.appDenoJson);
  const appDenoOld = appDeno.version as string;
  if (appDenoOld !== appVersion) {
    changes.push({ file: VERSION_FILES.appDenoJson, field: 'version', oldVersion: appDenoOld, newVersion: appVersion });
  }

  // .release-please-manifest.json — root entry
  const manifest = await readJson(VERSION_FILES.releaseManifest);
  const manifestRootOld = manifest['.'] as string;
  if (manifestRootOld !== appVersion) {
    changes.push({
      file: VERSION_FILES.releaseManifest,
      field: '"."',
      oldVersion: manifestRootOld,
      newVersion: appVersion,
    });
  }

  // praxrr-db
  if (dbVersion) {
    const dbDeno = await readJson(VERSION_FILES.dbDenoJson);
    const dbOld = dbDeno.version as string;
    if (dbOld !== dbVersion) {
      changes.push({ file: VERSION_FILES.dbDenoJson, field: 'version', oldVersion: dbOld, newVersion: dbVersion });
    }
    const manifestDbOld = manifest['packages/praxrr-db'] as string;
    if (manifestDbOld !== dbVersion) {
      changes.push({
        file: VERSION_FILES.releaseManifest,
        field: '"packages/praxrr-db"',
        oldVersion: manifestDbOld,
        newVersion: dbVersion,
      });
    }
  }

  // praxrr-schema
  if (schemaVersion) {
    const schemaDeno = await readJson(VERSION_FILES.schemaDenoJson);
    const schemaOld = schemaDeno.version as string;
    if (schemaOld !== schemaVersion) {
      changes.push({
        file: VERSION_FILES.schemaDenoJson,
        field: 'version',
        oldVersion: schemaOld,
        newVersion: schemaVersion,
      });
    }
    const manifestSchemaOld = manifest['packages/praxrr-schema'] as string;
    if (manifestSchemaOld !== schemaVersion) {
      changes.push({
        file: VERSION_FILES.releaseManifest,
        field: '"packages/praxrr-schema"',
        oldVersion: manifestSchemaOld,
        newVersion: schemaVersion,
      });
    }
  }

  return changes;
}

async function applyChanges(
  appVersion: string,
  dbVersion?: string,
  schemaVersion?: string,
  dryRun = false
): Promise<void> {
  // package.json
  const pkg = await readJson(VERSION_FILES.packageJson);
  pkg.version = appVersion;
  await writeJson(VERSION_FILES.packageJson, pkg, dryRun);

  // praxrr-app/deno.json
  const appDeno = await readJson(VERSION_FILES.appDenoJson);
  appDeno.version = appVersion;
  await writeJson(VERSION_FILES.appDenoJson, appDeno, dryRun);

  // .release-please-manifest.json
  const manifest = await readJson(VERSION_FILES.releaseManifest);
  manifest['.'] = appVersion;
  if (dbVersion) manifest['packages/praxrr-db'] = dbVersion;
  if (schemaVersion) manifest['packages/praxrr-schema'] = schemaVersion;
  await writeJson(VERSION_FILES.releaseManifest, manifest, dryRun);

  // praxrr-db
  if (dbVersion) {
    const dbDeno = await readJson(VERSION_FILES.dbDenoJson);
    dbDeno.version = dbVersion;
    await writeJson(VERSION_FILES.dbDenoJson, dbDeno, dryRun);
  }

  // praxrr-schema
  if (schemaVersion) {
    const schemaDeno = await readJson(VERSION_FILES.schemaDenoJson);
    schemaDeno.version = schemaVersion;
    await writeJson(VERSION_FILES.schemaDenoJson, schemaDeno, dryRun);
  }
}

// ============================================================================
// GIT TAG LOGIC
// ============================================================================

async function tagExists(tag: string): Promise<boolean> {
  const cmd = new Deno.Command('git', { args: ['tag', '-l', tag], stdout: 'piped' });
  const { stdout } = await cmd.output();
  return new TextDecoder().decode(stdout).trim() === tag;
}

async function createTag(tag: string, dryRun: boolean): Promise<void> {
  if (await tagExists(tag)) {
    throw new Error(`Tag "${tag}" already exists. Remove it first or use a different version.`);
  }
  if (dryRun) {
    console.log(`[DRY-RUN] git tag ${tag}`);
    return;
  }
  const cmd = new Deno.Command('git', { args: ['tag', tag] });
  const { success } = await cmd.output();
  if (!success) throw new Error(`Failed to create tag: ${tag}`);
  console.log(`  Created tag: ${tag}`);
}

async function pushTags(tags: string[], dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`[DRY-RUN] git push origin ${tags.join(' ')}`);
    return;
  }
  const cmd = new Deno.Command('git', { args: ['push', 'origin', ...tags], stdout: 'piped', stderr: 'piped' });
  const { success, stderr } = await cmd.output();
  if (!success) {
    const err = new TextDecoder().decode(stderr);
    throw new Error(`Failed to push tags: ${err}`);
  }
  console.log(`  Pushed tags to origin: ${tags.join(', ')}`);
}

// ============================================================================
// DISPLAY
// ============================================================================

function printChangeSummary(changes: VersionChange[], dryRun: boolean): void {
  const prefix = dryRun ? '[DRY-RUN] ' : '';

  if (changes.length === 0) {
    console.log(`${prefix}All versions already at target. Nothing to do.`);
    return;
  }

  console.log(`\n${prefix}Version changes:`);
  console.log('─'.repeat(72));

  const maxFile = Math.max(...changes.map((c) => c.file.length));
  const maxField = Math.max(...changes.map((c) => c.field.length));

  for (const { file, field, oldVersion, newVersion } of changes) {
    console.log(`  ${file.padEnd(maxFile)}  ${field.padEnd(maxField)}  ${oldVersion} → ${newVersion}`);
  }

  console.log('─'.repeat(72));
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  // Resolve app version: CLI arg > env var
  const rawVersion = args.version ?? Deno.env.get('APP_VERSION');
  if (!rawVersion) {
    console.error('Error: version argument required (e.g. deno task version 0.2.3)');
    console.error('Run with --help for usage.');
    Deno.exit(1);
  }

  const appVersion = validateSemver(rawVersion, 'app version');
  const dbVersion = args.dbVersion ? validateSemver(args.dbVersion, 'db version') : undefined;
  const schemaVersion = args.schemaVersion ? validateSemver(args.schemaVersion, 'schema version') : undefined;

  // Collect and display changes
  const changes = await collectChanges(appVersion, dbVersion, schemaVersion);
  printChangeSummary(changes, args.dryRun);

  if (changes.length === 0) {
    if (args.createGitTags) {
      console.log('\nCreating git tags...');
    } else {
      Deno.exit(0);
    }
  }

  // Apply file changes
  if (changes.length > 0) {
    await applyChanges(appVersion, dbVersion, schemaVersion, args.dryRun);
    if (args.dryRun) {
      console.log('\n[DRY-RUN] No files were modified.');
    } else {
      console.log(`\nUpdated ${changes.length} version entries.`);
    }
  }

  // Create git tags
  if (args.createGitTags) {
    console.log(args.dryRun ? '\n[DRY-RUN] Tags that would be created:' : '\nCreating git tags...');

    const tags: string[] = [];
    tags.push(`app/v${appVersion}`);
    if (dbVersion) tags.push(`db/v${dbVersion}`);
    if (schemaVersion) tags.push(`schema/v${schemaVersion}`);

    for (const tag of tags) {
      await createTag(tag, args.dryRun);
    }

    // Push tags to origin
    if (args.publish) {
      console.log(args.dryRun ? '\n[DRY-RUN] Tags that would be pushed:' : '\nPushing tags to origin...');
      await pushTags(tags, args.dryRun);
    }
  }

  console.log('\nDone.');
}

main();
