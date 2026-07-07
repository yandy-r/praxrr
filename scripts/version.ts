/**
 * Version Management Script
 *
 * Centralizes version bumps across the monorepo. Each package (app, db, schema)
 * is versioned independently; --target selects the scope. Updates the relevant
 * deno.json / package.json and .release-please-manifest.json entries, commits the
 * bump as "chore(release): ...", then optionally creates and pushes the matching
 * git tags (tag points at the release commit, working tree left clean).
 *
 * Usage:
 *   deno task version 0.3.0                      # app only
 *   deno task version --target=db 0.2.4 --dry-run
 *   deno task publish:app 0.3.0                  # app: bump + tag + push
 *   deno task publish:db 0.2.4                   # db: bump + tag + push
 *   deno task publish:schema 0.2.4               # schema: bump + tag + push
 *   deno task publish:all 0.3.0                  # all three (per-package overrides available)
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

type Target = 'app' | 'db' | 'schema' | 'all';

const TARGETS: readonly Target[] = ['app', 'db', 'schema', 'all'];

interface CliArgs {
  target: Target;
  version?: string;
  appVersion?: string;
  dbVersion?: string;
  schemaVersion?: string;
  commit?: boolean;
  createGitTags: boolean;
  publish: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    target: 'app',
    createGitTags: false,
    publish: false,
    dryRun: false,
    help: false,
  };

  for (const arg of Deno.args) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg.startsWith('--target=')) {
      const target = arg.slice('--target='.length) as Target;
      if (!TARGETS.includes(target)) {
        throw new Error(`Invalid --target: "${target}" (expected ${TARGETS.join('|')})`);
      }
      args.target = target;
    } else if (arg.startsWith('--app-version=')) {
      args.appVersion = arg.slice('--app-version='.length);
    } else if (arg.startsWith('--db-version=')) {
      args.dbVersion = arg.slice('--db-version='.length);
    } else if (arg.startsWith('--schema-version=')) {
      args.schemaVersion = arg.slice('--schema-version='.length);
    } else if (arg === '--create-git-tags') {
      args.createGitTags = true;
    } else if (arg === '--commit') {
      args.commit = true;
    } else if (arg === '--no-commit') {
      args.commit = false;
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

Centralizes version bumps across the Praxrr monorepo. Each package (app, db,
schema) is versioned independently; pick the scope with --target.

USAGE:
  deno task version <version> [OPTIONS]

ARGUMENTS:
  version                    Semver version (e.g. 0.2.3). Applies to the --target
                             package(s). Falls back to APP_VERSION env var.

OPTIONS:
  --target=app|db|schema|all Which package(s) to version/tag. Default: app.
  --app-version=X.Y.Z        Override the app version (else the positional value)
  --db-version=X.Y.Z         Override the db version (else the positional value)
  --schema-version=X.Y.Z     Override the schema version (else the positional value)
  --create-git-tags          Create git tags for the in-scope packages
  --commit                   Commit the version bump (auto-on with --create-git-tags)
  --no-commit                Skip the commit; leaves the bump uncommitted (footgun)
  --publish                  Push the commit + tags to origin (implies --create-git-tags)
  --dry-run                  Preview changes without writing
  --help, -h                 Show this help message

ORDER OF OPERATIONS (with --create-git-tags):
  1. Write version files    2. Commit "chore(release): ..." (bumped files only)
  3. Create tag(s)          4. Push commit + tags (with --publish)
  The commit lands before the tag so tags point at the release commit and the
  working tree stays clean. Only bumped version files are staged.

TARGET SCOPE:
  app     Bumps package.json, packages/praxrr-app/deno.json, manifest "."; tags app/v*
  db      Bumps packages/praxrr-db/deno.json, manifest db; tags db/v*
  schema  Bumps packages/praxrr-schema/deno.json, manifest schema; tags schema/v*
  all     All three. The positional version applies to every package unless a
          per-package --*-version flag overrides it (packages are independent).

EXAMPLES:
  deno task version 0.2.3                              # bump app only (preview with --dry-run)
  deno task version --target=db 0.2.4 --dry-run        # preview db bump
  deno task publish:app 0.3.0                          # bump + tag app/v0.3.0 + push
  deno task publish:db 0.2.4                           # bump + tag db/v0.2.4 + push
  deno task publish:schema 0.2.4                       # bump + tag schema/v0.2.4 + push
  deno task publish:all 0.3.0                          # all three at 0.3.0
  deno task publish:all 0.3.0 --db-version=0.2.4 --schema-version=0.2.4  # independent versions
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
  appVersion?: string,
  dbVersion?: string,
  schemaVersion?: string
): Promise<VersionChange[]> {
  const changes: VersionChange[] = [];

  // .release-please-manifest.json — shared across all packages
  const manifest = await readJson(VERSION_FILES.releaseManifest);

  if (appVersion) {
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
      changes.push({
        file: VERSION_FILES.appDenoJson,
        field: 'version',
        oldVersion: appDenoOld,
        newVersion: appVersion,
      });
    }

    // .release-please-manifest.json — root entry
    const manifestRootOld = manifest['.'] as string;
    if (manifestRootOld !== appVersion) {
      changes.push({
        file: VERSION_FILES.releaseManifest,
        field: '"."',
        oldVersion: manifestRootOld,
        newVersion: appVersion,
      });
    }
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
  appVersion?: string,
  dbVersion?: string,
  schemaVersion?: string,
  dryRun = false
): Promise<void> {
  if (appVersion) {
    // package.json
    const pkg = await readJson(VERSION_FILES.packageJson);
    pkg.version = appVersion;
    await writeJson(VERSION_FILES.packageJson, pkg, dryRun);

    // praxrr-app/deno.json
    const appDeno = await readJson(VERSION_FILES.appDenoJson);
    appDeno.version = appVersion;
    await writeJson(VERSION_FILES.appDenoJson, appDeno, dryRun);
  }

  // .release-please-manifest.json
  const manifest = await readJson(VERSION_FILES.releaseManifest);
  if (appVersion) manifest['.'] = appVersion;
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

async function commitChanges(files: string[], message: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`[DRY-RUN] git add ${files.join(' ')}`);
    console.log(`[DRY-RUN] git commit -m "${message}"`);
    return;
  }
  const add = new Deno.Command('git', { args: ['add', ...files], stderr: 'piped' });
  const addResult = await add.output();
  if (!addResult.success) {
    throw new Error(`Failed to stage version files: ${new TextDecoder().decode(addResult.stderr)}`);
  }
  const commit = new Deno.Command('git', { args: ['commit', '-m', message], stdout: 'piped', stderr: 'piped' });
  const { success, stderr } = await commit.output();
  if (!success) {
    throw new Error(`Failed to commit version bump: ${new TextDecoder().decode(stderr)}`);
  }
  console.log(`  Created commit: ${message}`);
}

async function pushToOrigin(refs: string[], dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`[DRY-RUN] git push origin ${refs.join(' ')}`);
    return;
  }
  const cmd = new Deno.Command('git', { args: ['push', 'origin', ...refs], stdout: 'piped', stderr: 'piped' });
  const { success, stderr } = await cmd.output();
  if (!success) {
    const err = new TextDecoder().decode(stderr);
    throw new Error(`Failed to push to origin: ${err}`);
  }
  console.log(`  Pushed to origin: ${refs.join(', ')}`);
}

function buildReleaseMessage(appVersion?: string, dbVersion?: string, schemaVersion?: string): string {
  const parts: string[] = [];
  if (appVersion) parts.push(`v${appVersion}`);
  if (dbVersion) parts.push(`db v${dbVersion}`);
  if (schemaVersion) parts.push(`schema v${schemaVersion}`);
  return `chore(release): ${parts.join(', ')}`;
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

  // Resolve versions per target. The positional version (CLI arg > env var) is the
  // base; explicit --app/--db/--schema-version flags override it per package.
  const positional = args.version ?? Deno.env.get('APP_VERSION');

  const requireVersion = (value: string | undefined, hint: string): string => {
    if (!value) {
      console.error(`Error: version argument required (e.g. ${hint})`);
      console.error('Run with --help for usage.');
      Deno.exit(1);
    }
    return value;
  };

  let appVersion: string | undefined;
  let dbVersion: string | undefined;
  let schemaVersion: string | undefined;

  switch (args.target) {
    case 'app':
      appVersion = validateSemver(
        requireVersion(args.appVersion ?? positional, 'deno task publish:app 0.3.0'),
        'app version'
      );
      break;
    case 'db':
      dbVersion = validateSemver(
        requireVersion(args.dbVersion ?? positional, 'deno task publish:db 0.2.4'),
        'db version'
      );
      break;
    case 'schema':
      schemaVersion = validateSemver(
        requireVersion(args.schemaVersion ?? positional, 'deno task publish:schema 0.2.4'),
        'schema version'
      );
      break;
    case 'all': {
      const base = requireVersion(positional, 'deno task publish:all 0.3.0 [--db-version=..] [--schema-version=..]');
      appVersion = validateSemver(args.appVersion ?? base, 'app version');
      dbVersion = validateSemver(args.dbVersion ?? base, 'db version');
      schemaVersion = validateSemver(args.schemaVersion ?? base, 'schema version');
      break;
    }
  }

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

  // Commit the version bump BEFORE tagging so tags point at the release commit and
  // the working tree is left clean. Only the bumped version files are staged — any
  // other unrelated working-tree changes are left untouched. Defaults on whenever
  // tags are created (i.e. every publish:* task); opt out with --no-commit.
  const doCommit = changes.length > 0 && (args.commit ?? args.createGitTags);
  let didCommit = false;
  if (doCommit) {
    const message = buildReleaseMessage(appVersion, dbVersion, schemaVersion);
    const files = [...new Set(changes.map((c) => c.file))];
    console.log(args.dryRun ? '\n[DRY-RUN] Commit that would be created:' : '\nCommitting version bump...');
    await commitChanges(files, message, args.dryRun);
    didCommit = true;
  } else if (changes.length > 0 && args.createGitTags && args.commit === false) {
    console.warn(
      '\nWarning: --no-commit set — version files remain uncommitted and tags will point at the ' +
        'current (pre-bump) HEAD.'
    );
  }

  // Create git tags
  if (args.createGitTags) {
    const tags: string[] = [];
    if (appVersion) tags.push(`app/v${appVersion}`);
    if (dbVersion) tags.push(`db/v${dbVersion}`);
    if (schemaVersion) tags.push(`schema/v${schemaVersion}`);

    console.log(args.dryRun ? '\n[DRY-RUN] Tags that would be created:' : '\nCreating git tags...');
    for (const tag of tags) {
      await createTag(tag, args.dryRun);
    }

    // Push the release commit (if any) and tags together so origin stays in sync.
    if (args.publish) {
      const refs = didCommit ? ['HEAD', ...tags] : tags;
      console.log(args.dryRun ? '\n[DRY-RUN] Refs that would be pushed:' : '\nPushing to origin...');
      await pushToOrigin(refs, args.dryRun);
    }
  }

  console.log('\nDone.');
}

main();
