/**
 * Startup banner and logging
 */

import { config } from '$config';
import { appInfoQueries } from '$db/queries/appInfo.ts';
import { logger } from './logger.ts';

const BANNER = String.raw`
  ____                           
 |  _ \ _ __ __ ___  ___ __ _ __ 
 | |_) | '__/ _\` \ \/ / '__| '__|
 |  __/| | | (_| |>  <| |  | |   
 |_|   |_|  \__,_/_/\_\_|  |_|   
`;

/**
 * Check if running inside a Docker container
 */
function isDocker(): boolean {
  try {
    // Check for .dockerenv file (most reliable)
    Deno.statSync('/.dockerenv');
    return true;
  } catch {
    // Check for docker in cgroup (fallback)
    try {
      const cgroup = Deno.readTextFileSync('/proc/1/cgroup');
      return cgroup.includes('docker');
    } catch {
      return false;
    }
  }
}

/**
 * Log container configuration (only when running in Docker)
 */
export async function logContainerConfig(): Promise<void> {
  if (!isDocker()) return;

  await logger.info('Container initialized', {
    source: 'Docker',
    meta: {
      puid: Deno.env.get('PUID') || '1000',
      pgid: Deno.env.get('PGID') || '1000',
      umask: Deno.env.get('UMASK') || '022',
      tz: Deno.env.get('TZ') || 'UTC',
    },
  });
}

/**
 * Prints the application ASCII banner and server URL to the console.
 */
export function printBanner(): void {
  const version = appInfoQueries.getVersion();
  const url = config.serverUrl;

  console.log(BANNER);
  console.log(`  v${version}  |  ${url}`);
  console.log();
}

export interface ServerInfo {
  version: string;
  env: string;
  timezone: string;
  basePath: string;
  hostname: string;
}

/**
 * Returns structured server info including version, environment, timezone, base path, and hostname.
 *
 * @returns A `ServerInfo` object with the current runtime configuration
 */
export function getServerInfo(): ServerInfo {
  return {
    version: appInfoQueries.getVersion(),
    env: Deno.env.get('DENO_ENV') || 'production',
    timezone: config.timezone,
    basePath: config.paths.base,
    hostname: typeof Deno !== 'undefined' ? Deno.hostname() : 'unknown',
  };
}
