/**
 * Test runner script that allows running specific test files or directories
 *
 * Usage:
 *   deno task test              # Run all tests
 *   deno task test filters      # Run packages/praxrr-app/src/tests/upgrades/filters.test.ts
 *   deno task test upgrades     # Run all tests in packages/praxrr-app/src/tests/upgrades/
 *   deno task test logger       # Run all tests in packages/praxrr-app/src/tests/logger/
 */

const aliases: Record<string, string> = {
  // Individual test files
  'arr-adapters':
    'packages/praxrr-app/src/tests/arr/arrVersion.test.ts,packages/praxrr-app/src/tests/arr/arrCompatibilityResolver.test.ts,packages/praxrr-app/src/tests/db/arrInstanceVersion.test.ts,packages/praxrr-app/src/tests/routes/arrCompatibilityApi.test.ts,packages/praxrr-app/src/tests/jobs/arrSyncVersionGate.test.ts',
  backup: 'packages/praxrr-app/src/tests/jobs/createBackup.test.ts',
  canary:
    'packages/praxrr-app/src/tests/jobs/canaryRollout.test.ts,packages/praxrr-app/src/tests/db/canaryQueries.test.ts,packages/praxrr-app/src/tests/db/canaryMigration.test.ts',
  cleanup: 'packages/praxrr-app/src/tests/logger/cleanupLogs.test.ts',
  'config-health':
    'packages/praxrr-app/src/tests/shared/health,packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts,packages/praxrr-app/src/tests/db/configHealthSettings.test.ts,packages/praxrr-app/src/tests/routes/configHealth.test.ts,packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts,packages/praxrr-app/src/tests/jobs/configHealthCleanup.test.ts',
  complexity:
    'packages/praxrr-app/src/tests/complexity,packages/praxrr-app/src/tests/routes/complexityTiersApi.test.ts',
  'env-instances': 'packages/praxrr-app/src/tests/base/envInstances.test.ts',
  filters: 'packages/praxrr-app/src/tests/upgrades/filters.test.ts',
  impactSimulator:
    'packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts,packages/praxrr-app/src/tests/pcd/sandbox,packages/praxrr-app/src/tests/pcd/simulate,packages/praxrr-app/src/tests/pcd/scoring,packages/praxrr-app/src/tests/shared/thresholdState.test.ts',
  normalize: 'packages/praxrr-app/src/tests/upgrades/normalize.test.ts',
  parity:
    'packages/praxrr-app/src/tests/arr/parityMap.test.ts,packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts,packages/praxrr-app/src/tests/routes/parityMapApi.test.ts',
  phase3:
    'packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts,packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts',
  resolvedConfig:
    'packages/praxrr-app/src/tests/pcd/resolved,packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts',
  'security-posture':
    'packages/praxrr-app/src/tests/shared/security,packages/praxrr-app/src/tests/shared/scoring/rollup.test.ts,packages/praxrr-app/src/tests/routes/securityPosture.test.ts,packages/praxrr-app/src/tests/logger/sanitizerRegression.test.ts',
  selectors: 'packages/praxrr-app/src/tests/upgrades/selectors.test.ts',
  'setup-wizard':
    'packages/praxrr-app/src/tests/routes/setupWizard.test.ts,packages/praxrr-app/src/tests/base/setupProgress.test.ts',
  'sync-history':
    'packages/praxrr-app/src/tests/db/syncHistoryQueries.test.ts,packages/praxrr-app/src/tests/db/syncHistoryRetention.test.ts,packages/praxrr-app/src/tests/sync/syncHistoryRecord.test.ts,packages/praxrr-app/src/tests/routes/syncHistory.test.ts,packages/praxrr-app/src/tests/jobs/syncHistoryCleanup.test.ts',
  'url-state': 'packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts',
  'what-if': 'packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts',

  // Directories
  jobs: 'packages/praxrr-app/src/tests/jobs',
  logger: 'packages/praxrr-app/src/tests/logger',
  upgrades: 'packages/praxrr-app/src/tests/upgrades',
};

// Get the test target from args
const target = Deno.args[0];
const testPath = target ? (aliases[target] ?? target) : 'packages/praxrr-app/src/tests';
const testPaths = testPath
  .split(',')
  .map((path) => path.trim())
  .filter((path) => path.length > 0);
const repoRoot = Deno.cwd();

// Check if it's a valid path
if (target && !aliases[target]) {
  // Check if it's a direct path
  try {
    await Deno.stat(target);
  } catch {
    console.error(`Unknown test target: "${target}"`);
    console.error('\nAvailable aliases:');
    for (const [alias, path] of Object.entries(aliases)) {
      console.error(`  ${alias.padEnd(12)} -> ${path}`);
    }
    Deno.exit(1);
  }
}

console.log(`Running tests: ${testPaths.join(',')}\n`);

const cmd = new Deno.Command('deno', {
  args: [
    'test',
    ...testPaths,
    '--allow-net',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-ffi',
    '--allow-run',
  ],
  env: {
    ...Deno.env.toObject(),
    APP_BASE_PATH: `${repoRoot}/dist/test`,
  },
  stdout: 'inherit',
  stderr: 'inherit',
});

const { code } = await cmd.output();
Deno.exit(code);
