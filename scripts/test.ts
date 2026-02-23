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
  filters: 'packages/praxrr-app/src/tests/upgrades/filters.test.ts',
  normalize: 'packages/praxrr-app/src/tests/upgrades/normalize.test.ts',
  selectors: 'packages/praxrr-app/src/tests/upgrades/selectors.test.ts',
  'env-instances': 'packages/praxrr-app/src/tests/base/envInstances.test.ts',
  backup: 'packages/praxrr-app/src/tests/jobs/createBackup.test.ts',
  cleanup: 'packages/praxrr-app/src/tests/logger/cleanupLogs.test.ts',

  // Directories
  upgrades: 'packages/praxrr-app/src/tests/upgrades',
  jobs: 'packages/praxrr-app/src/tests/jobs',
  logger: 'packages/praxrr-app/src/tests/logger',
};

// Get the test target from args
const target = Deno.args[0];
const testPath = target ? (aliases[target] ?? target) : 'packages/praxrr-app/src/tests';

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

console.log(`Running tests: ${testPath}\n`);

const cmd = new Deno.Command('deno', {
  args: ['test', testPath, '--allow-read', '--allow-write', '--allow-env', '--allow-ffi', '--allow-run'],
  env: {
    ...Deno.env.toObject(),
    APP_BASE_PATH: './dist/test',
  },
  stdout: 'inherit',
  stderr: 'inherit',
});

const { code } = await cmd.output();
Deno.exit(code);
