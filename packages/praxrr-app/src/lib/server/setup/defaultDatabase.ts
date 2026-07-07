export interface DefaultDatabaseConfig {
  configured: boolean;
  url: string | null;
  branch: string;
  name: string;
}

/**
 * Resolve the default database config the same way across `hooks.server.ts`,
 * `/setup/link-database`, and `/api/v1/setup/state`: unset falls back to the
 * canonical `praxrr-db` repo, explicitly empty disables it. Never substitute a
 * fallback when the env var is set to ''.
 */
export function resolveDefaultDatabaseConfig(): DefaultDatabaseConfig {
  const fromEnv = Deno.env.get('PRAXRR_DEFAULT_DB_URL');
  const url = fromEnv === undefined ? 'https://github.com/yandy-r/praxrr-db' : fromEnv.trim();
  const branch = Deno.env.get('PRAXRR_DEFAULT_DB_BRANCH')?.trim() || 'main';
  const name = Deno.env.get('PRAXRR_DEFAULT_DB_NAME')?.trim() || 'Praxrr-DB';

  return { configured: url !== '', url: url !== '' ? url : null, branch, name };
}
