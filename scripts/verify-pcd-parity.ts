#!/usr/bin/env -S deno run -A

const DEPRECATED_MESSAGE = 'This verification task is retired after SQL-to-YAML migration completion.';

const USAGE = `Usage: deno task verify:pcd-parity:legacy

This task is retired and intentionally does not run parity checks in the migrated runtime.
`;

function isHelpRequested(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function printMigrationMessage(): void {
  console.error(DEPRECATED_MESSAGE);
  console.error('');
  console.error('Use scripts/compat-check.ts for the active YAML-first validation path.');
  console.error('This command path is intentionally removed to avoid deprecated SQL-vs-YAML parity builds.');
}

if (import.meta.main) {
  try {
    if (isHelpRequested(Deno.args)) {
      console.log(USAGE);
      Deno.exit(0);
    }

    if (Deno.args.length > 0) {
      console.error(`Unsupported arguments: ${Deno.args.join(' ')}`);
      Deno.exit(2);
    }

    printMigrationMessage();
    Deno.exit(3);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
