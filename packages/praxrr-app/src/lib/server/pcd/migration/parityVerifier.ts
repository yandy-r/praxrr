const MIGRATION_COMPLETE_MESSAGE =
  'SQL-vs-YAML parity verification is retired because migration is complete. This command is no longer available.';

export interface ParityVerifierOptions {
  readonly pcdPath: string;
}

export interface ParityReport {
  readonly pass: false;
  readonly tablesCompared: 0;
  readonly totalRowsA: 0;
  readonly totalRowsB: 0;
  readonly diffs: readonly [];
}

export function getParityVerifierDeprecationMessage(): string {
  return MIGRATION_COMPLETE_MESSAGE;
}

export class ParityVerifierRemovedError extends Error {
  constructor() {
    super(MIGRATION_COMPLETE_MESSAGE);
    this.name = 'ParityVerifierRemovedError';
  }
}

export async function verifyPcdParity(_options: ParityVerifierOptions): Promise<never> {
  throw new ParityVerifierRemovedError();
}
