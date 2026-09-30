import adapter from 'sveltekit-adapter-deno';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, '..', '..');
const distBuildOutput = path.join(repoRoot, 'dist', 'build');
const distSvelteKitOutput = path.join(repoRoot, 'dist', '.svelte-kit');

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    csrf: {
      // CSRF is enforced at runtime by src/hooks.server.ts (src/lib/server/security/csrf.ts):
      // proxy-aware (TRUSTED_PROXY-gated X-Forwarded-*), PRAXRR_TRUSTED_ORIGINS-aware, and it
      // covers JSON bodies — none of which SvelteKit's build-time check can do (its
      // trustedOrigins is baked into the generated bundle and cannot read runtime env).
      // The previous trustedOrigins: ['*'] wildcard disabled origin checks in production
      // builds — see YAN-433 / #276.
      checkOrigin: false,
    },
    adapter: adapter({
      usage: 'deno-compile',
      out: distBuildOutput,
      buildOptions: {
        logOverride: {
          'ignored-bare-import': 'silent',
        },
      },
    }),
    outDir: distSvelteKitOutput,
    alias: {
      $api: './src/lib/api',
      $config: './src/lib/server/utils/config/config.ts',
      $logger: './src/lib/server/utils/logger',
      $trashguide: './src/lib/server/trashguide',
      $shared: './src/lib/shared',
      $stores: './src/lib/client/stores',
      $ui: './src/lib/client/ui',
      $assets: './src/lib/client/assets',
      $alerts: './src/lib/client/alerts',
      $server: './src/lib/server',
      $db: './src/lib/server/db',
      $jobs: './src/lib/server/jobs',
      $pcd: './src/lib/server/pcd',
      $arr: './src/lib/server/utils/arr',
      $http: './src/lib/server/utils/http',
      $utils: './src/lib/server/utils',
      $notifications: './src/lib/server/notifications',
      $cache: './src/lib/server/utils/cache',
      $sync: './src/lib/server/sync',
      $auth: './src/lib/server/utils/auth',
    },
  },
};

export default config;
