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

async function isDotnetAvailable(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command('dotnet', {
      args: ['--version'],
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

async function runParser() {
  const cmd = new Deno.Command('dotnet', {
    args: ['watch', 'run', '--urls', 'http://localhost:5000'],
    cwd: 'src/services/parser',
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = cmd.spawn();

  await Promise.all([
    streamOutput(process.stdout.getReader(), 'parser', colors.parser),
    streamOutput(process.stderr.getReader(), 'parser', colors.parser),
  ]);

  return process.status;
}

async function runServer() {
  const cmd = new Deno.Command('deno', {
    args: ['run', '-A', 'npm:vite', 'dev'],
    env: {
      ...Deno.env.toObject(),
      DENO_ENV: 'development',
      PORT: '6969',
      HOST: '0.0.0.0',
      APP_BASE_PATH: './dist/dev',
      PARSER_HOST: 'localhost',
      PARSER_PORT: '5000',
      VITE_PLATFORM: getPlatform(),
      VITE_CHANNEL: 'dev',
    },
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = cmd.spawn();

  await Promise.all([
    streamOutput(process.stdout.getReader(), 'server', colors.server),
    streamOutput(process.stderr.getReader(), 'server', colors.server),
  ]);

  return process.status;
}

if (Deno.env.get('WITH_ARR') === '1') {
  await startArr();
  console.log('');
}

const hasDotnet = await isDotnetAvailable();
if (hasDotnet) {
  console.log(`${colors.parser}[parser]${colors.reset} Starting .NET parser service...`);
  console.log(`${colors.server}[server]${colors.reset} Starting Vite dev server...`);
  console.log('');
  await Promise.all([runParser(), runServer()]);
} else {
  console.log(`${colors.parser}[parser]${colors.reset} Skipped (dotnet not found). Server only.`);
  console.log(`${colors.server}[server]${colors.reset} Starting Vite dev server...`);
  console.log('');
  await runServer();
}
