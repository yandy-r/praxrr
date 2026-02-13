import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import deno from '@deno/vite-plugin';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [deno(), tailwindcss(), sveltekit()],
  server: {
    port: 6969,
    host: true,
    allowedHosts: ['localhost', 'ubsrv'],
    hmr: {
      host: 'localhost',
    },
    watch: {
      usePolling: true,
      interval: 1000,
      // Ignore temporary files created by editors
      ignored: ['**/*.tmp.*', '**/*~', '**/.#*'],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});
