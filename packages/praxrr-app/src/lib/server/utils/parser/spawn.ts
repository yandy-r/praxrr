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

// — Listener + health ————————————————————————————————————————————

function parserListenerPort(line: string): number | null {
  try {
    const entry = JSON.parse(line) as { msg?: unknown; addr?: unknown };
    if (entry.msg !== 'parser server listening' || typeof entry.addr !== 'string') return null;
    const match = entry.addr.match(/:(\d+)$/);
    if (!match) return null;
    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const healthy = resp.ok;
      await resp.body?.cancel();
      if (healthy) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Parser failed to start within ${timeoutMs}ms`);
}

// — Output streaming —————————————————————————————————————————————

async function streamOutput(reader: ReadableStreamDefaultReader<Uint8Array>, onLine?: (line: string) => void) {
  const decoder = new TextDecoder();
  const color = '\x1b[33m'; // yellow, same as dev.ts
  const reset = '\x1b[0m';
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          onLine?.(line);
          console.log(`${color}[parser]${reset} ${line}`);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      onLine?.(buffer);
      console.log(`${color}[parser]${reset} ${buffer}`);
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

  const cmd = new Deno.Command(binaryPath, {
    env: {
      PARSER_ADDR: '127.0.0.1:0',
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

  let resolveListenerPort: (port: number) => void;
  const listenerPort = new Promise<number>((resolve) => {
    resolveListenerPort = resolve;
  });

  // Stream output in background and capture the kernel-assigned listener.
  void streamOutput(process.stdout.getReader());
  void streamOutput(process.stderr.getReader(), (line) => {
    const port = parserListenerPort(line);
    if (port !== null) resolveListenerPort(port);
  });

  // Wait for parser to be ready
  try {
    const port = await Promise.race([
      listenerPort,
      process.status.then((status) => {
        throw new Error(`Parser exited before opening its listener (code ${status.code})`);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Parser did not report its listener within 10000ms')), 10_000)
      ),
    ]);
    // Set env vars before Config reads them.
    Deno.env.set('PARSER_HOST', '127.0.0.1');
    Deno.env.set('PARSER_PORT', String(port));
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
