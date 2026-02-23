/**
 * Deno global type declarations for SvelteKit project
 */

/** App version injected at build time */
declare const __APP_VERSION__: string;

// Note: Deno namespace types are provided by Deno's built-in lib.deno.ns.d.ts
// Do not redeclare them here to avoid conflicts

// JSR package declarations for svelte-check compatibility
declare module '@felix/bcrypt' {
  export function hash(password: string, rounds?: number): Promise<string>;
  export function verify(password: string, hash: string): Promise<boolean>;
}

declare module '@soapbox/kysely-deno-sqlite' {
  import type {
    DatabaseIntrospector,
    Dialect,
    DialectAdapter,
    Driver,
    Kysely,
    QueryCompiler,
  } from 'kysely';

  export interface DenoSqlite3DialectConfig {
    database: unknown;
    options?: {
      journalMode?: string;
      synchronous?: string;
      tempStore?: string;
      trustedSchema?: boolean;
      readOnly?: boolean;
      timeout?: number;
    };
  }

  export class DenoSqlite3Dialect implements Dialect {
    constructor(config: DenoSqlite3DialectConfig);
    createDriver(): Driver;
    createQueryCompiler(): QueryCompiler;
    createAdapter(): DialectAdapter;
    createIntrospector(db: Kysely<unknown>): DatabaseIntrospector;
  }
}
