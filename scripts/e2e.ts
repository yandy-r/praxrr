/**
 * E2E test runner helper for shorthand selectors.
 *
 * Usage examples:
 *   deno task test:e2e:headed -- 1.12
 *   deno task test:e2e:headed -- 1
 *   deno task test:e2e:headed -- 1 2
 *   deno task test:e2e:headed -- 1.12,1.15
 */

const SPEC_DIR = 'src/tests/e2e/specs';

const rawArgs = [...Deno.args];
const playwrightArgs: string[] = [];
const selectors: string[] = [];

for (const arg of rawArgs) {
  if (arg === '--help' || arg === '-h') {
    printHelp();
    Deno.exit(0);
  }

  if (arg.startsWith('--')) {
    playwrightArgs.push(arg);
    continue;
  }

  for (const part of arg.split(',')) {
    const trimmed = part.trim();
    if (trimmed) {
      selectors.push(trimmed);
    }
  }
}

const specFiles = await listSpecFiles(SPEC_DIR);
const testTargets: string[] = [];
const seen = new Set<string>();

function addTarget(target: string) {
  if (seen.has(target)) return;
  seen.add(target);
  testTargets.push(target);
}

function addMatches(matches: string[], label: string) {
  if (matches.length === 0) {
    fail(`No specs matched "${label}".`, specFiles);
  }
  for (const match of matches) {
    addTarget(match);
  }
}

if (selectors.length === 0) {
  addTarget(SPEC_DIR);
} else {
  for (const selector of selectors) {
    if (isDirectPath(selector)) {
      addTarget(selector);
      continue;
    }

    const majorRange = selector.match(/^(\d+)-(\d+)$/);
    if (majorRange) {
      const start = Number.parseInt(majorRange[1], 10);
      const end = Number.parseInt(majorRange[2], 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        fail(`Invalid range "${selector}".`, specFiles);
      }
      for (let major = start; major <= end; major += 1) {
        const matches = matchMajor(specFiles, String(major));
        addMatches(matches, String(major));
      }
      continue;
    }

    if (/^\d+$/.test(selector)) {
      const matches = matchMajor(specFiles, selector);
      addMatches(matches, selector);
      continue;
    }

    if (/^\d+\.\d+$/.test(selector)) {
      const matches = matchExact(specFiles, selector);
      addMatches(matches, selector);
      continue;
    }

    fail(`Unknown selector "${selector}".`, specFiles);
  }
}

const cmd = new Deno.Command('npx', {
  args: ['playwright', 'test', ...playwrightArgs, ...testTargets],
  stdout: 'inherit',
  stderr: 'inherit',
});

const { code } = await cmd.output();
Deno.exit(code);

function isDirectPath(selector: string) {
  return selector.includes('/') || selector.includes('*') || selector.endsWith('.spec.ts');
}

async function listSpecFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith('.spec.ts')) continue;
      files.push(`${dir}/${entry.name}`);
    }
  } catch (error) {
    console.error(`Failed to read spec directory "${dir}".`);
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function matchMajor(files: string[], major: string) {
  const prefix = `${major}.`;
  return files.filter((file) => {
    const name = file.split('/').pop() ?? file;
    return name.startsWith(prefix);
  });
}

function matchExact(files: string[], exact: string) {
  const prefix = `${exact}-`;
  return files.filter((file) => {
    const name = file.split('/').pop() ?? file;
    return name.startsWith(prefix);
  });
}

function fail(message: string, files: string[]): never {
  console.error(message);
  console.error('');
  console.error('Available specs:');
  for (const name of files.map((file) => file.split('/').pop() ?? file)) {
    console.error(`  ${name}`);
  }
  Deno.exit(1);
}

function printHelp() {
  console.log('E2E shorthand runner');
  console.log('');
  console.log('Usage:');
  console.log('  deno task test:e2e:headed -- 1.12');
  console.log('  deno task test:e2e:headed -- 1');
  console.log('  deno task test:e2e:headed -- 1 2');
  console.log('  deno task test:e2e:headed -- 1.12,1.15');
  console.log('');
  console.log('Selectors:');
  console.log('  1       -> all specs starting with "1."');
  console.log('  1.12    -> spec starting with "1.12-"');
  console.log('  1-2     -> majors 1 and 2');
  console.log('');
  console.log('Any direct path (or glob) is passed through to Playwright.');
}
