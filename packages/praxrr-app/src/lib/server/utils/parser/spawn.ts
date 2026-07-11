/**
 * Parser auto-spawn for standalone binary distribution.
 *
 * When running outside Docker and no explicit PARSER_HOST is set,
 * this module finds the parser binary next to the main executable,
 * spawns it on a free port, and sets PARSER_HOST/PARSER_PORT env vars
 * before the Config singleton reads them.
 *
 * This file is imported dynamically as the first thing in hooks.server.ts.
 */

// — Detection helpers ————————————————————————————————————————————

function isDocker(): boolean {
  try {
    Deno.statSync('/.dockerenv');
    return true;
  } catch {
    try {
      const cgroup = Deno.readTextFileSync('/proc/1/cgroup');
      return cgroup.includes('docker');
    } catch {
      return false;
    }
  }
}

function findParserBinary(): string | null {
  const execPath = Deno.execPath();
  const lastSlash = Math.max(execPath.lastIndexOf('/'), execPath.lastIndexOf('\\'));
  const dir = lastSlash > 0 ? execPath.substring(0, lastSlash) : '.';

  const candidates = [`${dir}/praxrr-parser`, `${dir}/praxrr-parser.exe`];

  for (const path of candidates) {
    try {
      Deno.statSync(path);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

// — Port + health ————————————————————————————————————————————————

async function findFreePort(): Promise<number> {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Parser failed to start within ${timeoutMs}ms`);
}

// — Output streaming —————————————————————————————————————————————

async function streamOutput(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  const color = '\x1b[33m'; // yellow, same as dev.ts
  const reset = '\x1b[0m';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split('\n')) {
        if (line.trim()) {
          console.log(`${color}[parser]${reset} ${line}`);
        }
      }
    }
  } catch {
    // Stream closed
  }
}

// — Main ————————————————————————————————————————————————————————

const parserBinary = findParserBinary();
const shouldSpawn = !isDocker() && !Deno.env.get('PARSER_HOST') && parserBinary !== null;

if (shouldSpawn) {
  const binaryPath = parserBinary;
  const port = await findFreePort();

  const cmd = new Deno.Command(binaryPath, {
    env: {
      PARSER_ADDR: `127.0.0.1:${port}`,
    },
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = cmd.spawn();
  let stopping = false;

  const terminate = () => {
    if (stopping) return;
    stopping = true;
    try {
      process.kill('SIGTERM');
    } catch {
      // Already dead
    }
  };

  // Stream output in background
  void streamOutput(process.stdout.getReader());
  void streamOutput(process.stderr.getReader());

  // Set env vars before Config reads them
  Deno.env.set('PARSER_HOST', '127.0.0.1');
  Deno.env.set('PARSER_PORT', String(port));

  // Wait for parser to be ready
  try {
    await waitForHealth(port, 10_000);
    console.log(`\x1b[33m[parser]\x1b[0m Ready on port ${port}`);
  } catch (err) {
    console.error(`\x1b[31m[parser]\x1b[0m Failed to start: ${err}`);
    terminate();
    // Continue anyway — the app degrades gracefully without the parser
  }

  // Shutdown handlers
  globalThis.addEventListener('unload', terminate, { once: true });

  Deno.addSignalListener('SIGINT', () => {
    terminate();
    void process.status.finally(() => Deno.exit(0));
  });

  // SIGTERM is not supported on Windows
  if (Deno.build.os !== 'windows') {
    Deno.addSignalListener('SIGTERM', () => {
      terminate();
      void process.status.finally(() => Deno.exit(0));
    });
  }

  // Watch for unexpected death
  void process.status.then((status) => {
    if (!stopping && status.code !== 0) {
      console.error(`\x1b[31m[parser]\x1b[0m Process exited unexpectedly (code ${status.code})`);
    }
  });
}

export {};
