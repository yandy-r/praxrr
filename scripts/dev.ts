/**
 * Dev script that runs parser and server concurrently with labeled output.
 * Set WITH_ARR=1 to also start Radarr/Sonarr/Lidarr (docker compose -f compose.arr.yml up -d).
 */

// Auto-detect platform from Deno.build
function getPlatform(): string {
  const os = Deno.build.os === 'darwin' ? 'darwin' : Deno.build.os;
  const arch = Deno.build.arch === 'x86_64' ? 'amd64' : Deno.build.arch === 'aarch64' ? 'arm64' : Deno.build.arch;
  return `${os}/${arch}`;
}

const colors = {
  arr: '\x1b[32m', // green
  parser: '\x1b[33m', // yellow
  server: '\x1b[34m', // blue
  reset: '\x1b[0m',
};
const APP_BASE_PATH = `${Deno.cwd()}/dist/dev`;

const PARSER_PROJECT_DIR = 'packages/praxrr-parser';

async function streamOutput(reader: ReadableStreamDefaultReader<Uint8Array>, label: string, color: string) {
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    for (const line of text.split('\n')) {
      if (line.trim()) {
        console.log(`${color}[${label}]${colors.reset} ${line}`);
      }
    }
  }
}

async function isGoAvailable(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command('go', {
      args: ['version'],
      stdout: 'null',
      stderr: 'null',
    }).output();
    return success;
  } catch {
    return false;
  }
}

async function startArr(): Promise<void> {
  console.log(`${colors.arr}[arr]${colors.reset} Starting Radarr/Sonarr/Lidarr...`);
  try {
    const cmd = new Deno.Command('docker', {
      args: ['compose', '-f', 'compose.arr.yml', 'up', '-d'],
      stdout: 'piped',
      stderr: 'piped',
    });
    const process = cmd.spawn();
    await Promise.all([
      streamOutput(process.stdout.getReader(), 'arr', colors.arr),
      streamOutput(process.stderr.getReader(), 'arr', colors.arr),
    ]);
    const status = await process.status;
    if (status.success) {
      console.log(`${colors.arr}[arr]${colors.reset} Containers started. Stop with: deno task arr:down`);
    } else {
      console.log(`${colors.arr}[arr]${colors.reset} docker compose exited with code ${status.code}`);
    }
  } catch (err) {
    console.log(`${colors.arr}[arr]${colors.reset} Skipped (docker not available or failed). ${err}`);
  }
}

function runParser(): Deno.ChildProcess {
  const cmd = new Deno.Command('go', {
    args: ['run', './cmd/praxrr-parser'],
    cwd: PARSER_PROJECT_DIR,
    env: {
      ...Deno.env.toObject(),
      PARSER_ADDR: '127.0.0.1:5000',
    },
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = cmd.spawn();

  void Promise.all([
    streamOutput(process.stdout.getReader(), 'parser', colors.parser),
    streamOutput(process.stderr.getReader(), 'parser', colors.parser),
  ]).catch((error: unknown) => {
    console.error(`${colors.parser}[parser]${colors.reset} Output stream failed: ${String(error)}`);
  });

  return process;
}

function runServer(): Deno.ChildProcess {
  const cmd = new Deno.Command('deno', {
    args: ['run', '-A', 'npm:vite', 'dev'],
    cwd: 'packages/praxrr-app',
    env: {
      ...Deno.env.toObject(),
      DENO_ENV: 'development',
      PORT: '6969',
      HOST: '0.0.0.0',
      APP_BASE_PATH,
      PARSER_HOST: Deno.env.get('PARSER_HOST') || 'localhost',
      PARSER_PORT: Deno.env.get('PARSER_PORT') || '5000',
      VITE_PLATFORM: getPlatform(),
      VITE_CHANNEL: 'dev',
    },
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = cmd.spawn();

  void Promise.all([
    streamOutput(process.stdout.getReader(), 'server', colors.server),
    streamOutput(process.stderr.getReader(), 'server', colors.server),
  ]).catch((error: unknown) => {
    console.error(`${colors.server}[server]${colors.reset} Output stream failed: ${String(error)}`);
  });

  return process;
}

function terminateProcess(process: Deno.ChildProcess): void {
  try {
    process.kill('SIGTERM');
  } catch {
    // Already stopped
  }
}

async function runUntilExit(processes: Deno.ChildProcess[]): Promise<void> {
  let stopping = false;

  const stopChildren = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    for (const process of processes) terminateProcess(process);
    await Promise.all(processes.map((process) => process.status));
  };

  const removeSignalListeners = () => {
    Deno.removeSignalListener('SIGINT', onSignal);
    if (Deno.build.os !== 'windows') Deno.removeSignalListener('SIGTERM', onSignal);
  };
  const onSignal = () => {
    removeSignalListeners();
    void stopChildren().finally(() => Deno.exit(0));
  };
  Deno.addSignalListener('SIGINT', onSignal);
  if (Deno.build.os !== 'windows') Deno.addSignalListener('SIGTERM', onSignal);

  try {
    await Promise.race(processes.map((process) => process.status));
    await stopChildren();
  } finally {
    removeSignalListeners();
  }
}

if (Deno.env.get('WITH_ARR') === '1') {
  await startArr();
  console.log('');
}

const usesExternalParser = Boolean(Deno.env.get('PARSER_HOST'));
if (usesExternalParser) {
  console.log(`${colors.parser}[parser]${colors.reset} Using external parser service.`);
  console.log(`${colors.server}[server]${colors.reset} Starting Vite dev server...`);
  console.log('');
  await runUntilExit([runServer()]);
} else if (await isGoAvailable()) {
  console.log(`${colors.parser}[parser]${colors.reset} Starting Go parser service...`);
  console.log(`${colors.server}[server]${colors.reset} Starting Vite dev server...`);
  console.log('');
  await runUntilExit([runParser(), runServer()]);
} else {
  console.log(`${colors.parser}[parser]${colors.reset} Skipped (Go not found). Server only.`);
  console.log(`${colors.server}[server]${colors.reset} Starting Vite dev server...`);
  console.log('');
  await runUntilExit([runServer()]);
}
