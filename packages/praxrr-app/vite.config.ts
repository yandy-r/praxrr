import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import deno from '@deno/vite-plugin';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const distBuildOutput = join(repoRoot, 'dist', 'build');
const distSvelteKitOutput = join(repoRoot, 'dist', '.svelte-kit');

const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
const appSrcDir = resolve(process.cwd(), 'src');

export default defineConfig({
  plugins: [
    deno(),
    tailwindcss(),
    // SvelteKit 3 no longer reads svelte.config.js; its options are passed here.
    sveltekit({
      preprocess: vitePreprocess(),
      csrf: {
        // CSRF is enforced at runtime by src/hooks.server.ts (src/lib/server/security/csrf.ts):
        // proxy-aware (TRUSTED_PROXY-gated X-Forwarded-*), PRAXRR_TRUSTED_ORIGINS-aware, and it
        // covers JSON bodies — none of which SvelteKit's build-time check can do (its
        // trustedOrigins is baked into the generated bundle and cannot read runtime env).
        // Kit 3 removed `csrf.checkOrigin`; `trustedOrigins: ['*']` is its documented
        // replacement for `checkOrigin: false` and compiles SvelteKit's own check out, so the
        // app guard above stays the single CSRF gate (unchanged from Kit 2). Do not set
        // `paths.origin`: it is build-time and would override adapter-node's runtime ORIGIN.
        trustedOrigins: ['*'],
      },
      // Built with adapter-node and compiled into a standalone binary with `deno compile`
      // (entry: server-entry.js). `envPrefix` stays empty so the documented PORT/HOST/
      // BODY_SIZE_LIMIT/SHUTDOWN_TIMEOUT variables apply unprefixed.
      adapter: adapter({ out: distBuildOutput }),
      outDir: distSvelteKitOutput,
      alias: {
        // Kit 3 no longer provides $lib automatically.
        $lib: './src/lib',
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
    }),
  ],
  server: {
    port: 6969,
    host: true,
    allowedHosts: ['localhost', 'ubsrv'],
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: ['**/*.tmp.*', '**/*~', '**/.#*'],
    },
    fs: {
      allow: [appSrcDir],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});
