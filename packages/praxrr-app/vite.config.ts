import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import deno from '@deno/vite-plugin';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), '../../package.json'), 'utf-8'));
const appSrcDir = resolve(process.cwd(), 'src');

export default defineConfig({
  plugins: [deno(), tailwindcss(), sveltekit()],
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
