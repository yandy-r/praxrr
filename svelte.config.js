import adapter from 'sveltekit-adapter-deno';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    csrf: {
      trustedOrigins: ['*'],
    },
    files: {
      src: 'packages/praxrr-app/src',
    },
    adapter: adapter({
      usage: 'deno-compile',
      out: 'dist/build',
      buildOptions: {
        logOverride: {
          'ignored-bare-import': 'silent',
        },
      },
    }),
    outDir: 'dist/.svelte-kit',
    alias: {
      $api: './packages/praxrr-app/src/lib/api',
      $config: './packages/praxrr-app/src/lib/server/utils/config/config.ts',
      $logger: './packages/praxrr-app/src/lib/server/utils/logger',
      $shared: './packages/praxrr-app/src/lib/shared',
      $stores: './packages/praxrr-app/src/lib/client/stores',
      $ui: './packages/praxrr-app/src/lib/client/ui',
      $assets: './packages/praxrr-app/src/lib/client/assets',
      $alerts: './packages/praxrr-app/src/lib/client/alerts',
      $server: './packages/praxrr-app/src/lib/server',
      $db: './packages/praxrr-app/src/lib/server/db',
      $jobs: './packages/praxrr-app/src/lib/server/jobs',
      $pcd: './packages/praxrr-app/src/lib/server/pcd',
      $arr: './packages/praxrr-app/src/lib/server/utils/arr',
      $http: './packages/praxrr-app/src/lib/server/utils/http',
      $utils: './packages/praxrr-app/src/lib/server/utils',
      $notifications: './packages/praxrr-app/src/lib/server/notifications',
      $cache: './packages/praxrr-app/src/lib/server/utils/cache',
      $sync: './packages/praxrr-app/src/lib/server/sync',
      $auth: './packages/praxrr-app/src/lib/server/utils/auth',
    },
  },
};

export default config;
