const DEFAULT_VERSION = '2.0.0-go.1';
const DEFAULT_TIMEOUT_MS = 30_000;

const PLATFORMS = {
  'linux-x64': { app: 'praxrr', parser: 'praxrr-parser', magic: 'elf' },
  'linux-arm64': { app: 'praxrr', parser: 'praxrr-parser', magic: 'elf' },
  'macos-x64': { app: 'praxrr', parser: 'praxrr-parser', magic: 'macho' },
  'macos-arm64': { app: 'praxrr', parser: 'praxrr-parser', magic: 'macho' },
  'windows-x64': {
    app: 'praxrr.exe',
    parser: 'praxrr-parser.exe',
    magic: 'pe',
  },
} as const;

type Platform = keyof typeof PLATFORMS;

interface Options {
  directory: string;
  archive: string;
  checksumFile: string;
  platform: Platform;
  expectedVersion: string;
  native: boolean;
  timeoutMs: number;
}

const USAGE = `Validate and smoke a Praxrr standalone release archive.

Usage:
  deno run -A scripts/smoke-parser-release.ts --directory DIR --archive FILE \\
    --checksum-file FILE --platform PLATFORM [options]

Options:
  --directory DIR          Extracted archive root (required)
  --archive FILE           Original .tar.gz or .zip archive (required)
  --checksum-file FILE     sha256sum-compatible checksum sidecar (required)
  --platform VALUE         linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64
  --expected-version VALUE Parser behavior version (default: ${DEFAULT_VERSION})
  --native VALUE           Run binaries on this host: true or false (default: true)
  --timeout-ms VALUE       Per-phase deadline (default: ${DEFAULT_TIMEOUT_MS})
  --help                   Show this help
`;

function fail(message: string): never {
  throw new Error(message);
}

function optionValue(args: readonly string[], index: number, name: string): [string, number] {
  const equals = args[index].indexOf('=');
  if (equals >= 0) return [args[index].slice(equals + 1), index];
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return [value, index + 1];
}

function parseBoolean(value: string, name: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fail(`${name} must be true or false`);
}

function isPlatform(value: string): value is Platform {
  return Object.hasOwn(PLATFORMS, value);
}

function parseOptions(args: readonly string[]): Options {
  let directory = '';
  let archive = '';
  let checksumFile = '';
  let platform: Platform | undefined;
  let expectedVersion = Deno.env.get('PARSER_BEHAVIOR_VERSION') ?? DEFAULT_VERSION;
  let native = true;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') {
      console.log(USAGE);
      Deno.exit(0);
    }
    const name = argument.split('=', 1)[0];
    if (
      ![
        '--directory',
        '--archive',
        '--checksum-file',
        '--platform',
        '--expected-version',
        '--native',
        '--timeout-ms',
      ].includes(name)
    ) {
      fail(`unknown argument: ${argument}`);
    }
    const [value, nextIndex] = optionValue(args, index, name);
    index = nextIndex;
    if (name === '--directory') directory = value;
    if (name === '--archive') archive = value;
    if (name === '--checksum-file') checksumFile = value;
    if (name === '--platform') {
      if (!isPlatform(value)) fail(`unsupported platform: ${value}`);
      platform = value;
    }
    if (name === '--expected-version') expectedVersion = value;
    if (name === '--native') native = parseBoolean(value, name);
    if (name === '--timeout-ms') {
      timeoutMs = Number(value);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
        fail('--timeout-ms must be an integer from 1000 through 120000');
      }
    }
  }
  if (!directory) fail('--directory is required');
  if (!archive) fail('--archive is required');
  if (!checksumFile) fail('--checksum-file is required');
  if (!platform) fail('--platform is required');
  if (!expectedVersion.trim()) fail('--expected-version cannot be empty');
  return {
    directory,
    archive,
    checksumFile,
    platform,
    expectedVersion,
    native,
    timeoutMs,
  };
}

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').at(-1) ?? '';
}

function join(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
  return `${directory.replace(/[\\/]$/, '')}${separator}${name}`;
}

async function sha256(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await Deno.readFile(path));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function expectedChecksum(path: string, archiveName: string): Promise<string> {
  for (const line of (await Deno.readTextFile(path)).split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === archiveName) return match[1].toLowerCase();
  }
  return fail(`checksum file does not contain an exact entry for ${archiveName}`);
}

async function validateMagic(path: string, kind: (typeof PLATFORMS)[Platform]['magic']): Promise<void> {
  const file = await Deno.open(path, { read: true });
  try {
    const bytes = new Uint8Array(4);
    if ((await file.read(bytes)) !== bytes.length) {
      fail(`${path} is too short to be an executable`);
    }
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (kind === 'elf' && hex !== '7f454c46') {
      fail(`${path} is not an ELF executable`);
    }
    if (kind === 'pe' && !hex.startsWith('4d5a')) {
      fail(`${path} is not a PE executable`);
    }
    if (kind === 'macho' && !['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'].includes(hex)) {
      fail(`${path} is not a Mach-O executable`);
    }
  } finally {
    file.close();
  }
}

async function validateLayout(options: Options): Promise<{ app: string; parser: string; digest: string }> {
  const archiveName = basename(options.archive);
  const expectedExtension = options.platform === 'windows-x64' ? '.zip' : '.tar.gz';
  if (!archiveName.endsWith(`-${options.platform}${expectedExtension}`)) {
    fail(`archive name does not end in -${options.platform}${expectedExtension}: ${archiveName}`);
  }
  const digest = await sha256(options.archive);
  const expected = await expectedChecksum(options.checksumFile, archiveName);
  if (digest !== expected) {
    fail(`archive SHA-256 mismatch: got ${digest}, expected ${expected}`);
  }

  const expectedFiles = PLATFORMS[options.platform];
  const directory = await Deno.realPath(options.directory);
  const app = join(directory, expectedFiles.app);
  const parser = join(directory, expectedFiles.parser);
  for (const path of [app, parser, join(directory, 'server.js')]) {
    const info = await Deno.stat(path);
    if (!info.isFile) fail(`${path} must be a regular file`);
  }
  if (!(await Deno.stat(join(directory, 'static'))).isDirectory) {
    fail('archive static entry must be a directory');
  }
  await validateMagic(app, expectedFiles.magic);
  await validateMagic(parser, expectedFiles.magic);
  return { app, parser, digest };
}

function reserveLoopbackPort(): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function fetchJSON(url: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) {
    fail(`${new URL(url).pathname} returned HTTP ${response.status}: ${await response.text()}`);
  }
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail(`${new URL(url).pathname} must return an object`);
  }
  return body as Record<string, unknown>;
}

async function waitForHealth(baseURL: string, expectedVersion: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'listener did not respond';
  while (Date.now() < deadline) {
    try {
      const health = await fetchJSON(`${baseURL}/health`, {}, Math.min(1_000, timeoutMs));
      if (health.status === 'healthy' && health.version === expectedVersion) {
        return;
      }
      lastError = JSON.stringify(health);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`/health did not report healthy version ${expectedVersion}: ${lastError}`);
}

async function postJSON(
  baseURL: string,
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  return await fetchJSON(
    `${baseURL}${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
}

async function verifyParserAPI(baseURL: string, timeoutMs: number): Promise<void> {
  const parsed = await postJSON(
    baseURL,
    '/parse',
    {
      title: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
      type: 'movie',
    },
    timeoutMs
  );
  if (parsed.source !== 'Bluray' || parsed.resolution !== 1080 || parsed.releaseGroup !== 'GROUP') {
    fail(`/parse returned unexpected semantics: ${JSON.stringify(parsed)}`);
  }
  const matched = await postJSON(
    baseURL,
    '/match',
    {
      text: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
      patterns: ['(?i)bluray', '(?i)web[ ._-]?dl'],
    },
    timeoutMs
  );
  const matchResults = matched.results as Record<string, unknown> | undefined;
  if (!matchResults || matchResults['(?i)bluray'] !== true || matchResults['(?i)web[ ._-]?dl'] !== false) {
    fail(`/match returned unexpected semantics: ${JSON.stringify(matched)}`);
  }
  const batch = await postJSON(
    baseURL,
    '/match/batch',
    {
      texts: ['Film.2020.1080p.WEB-DL-GROUP', 'Film.2020.1080p.BluRay-GROUP'],
      patterns: ['(?i)web[ ._-]?dl', '(?i)bluray'],
    },
    timeoutMs
  );
  const results = batch.results as Record<string, Record<string, unknown>> | undefined;
  if (
    !results ||
    results['Film.2020.1080p.WEB-DL-GROUP']?.['(?i)web[ ._-]?dl'] !== true ||
    results['Film.2020.1080p.BluRay-GROUP']?.['(?i)bluray'] !== true
  ) {
    fail(`/match/batch returned unexpected semantics: ${JSON.stringify(batch)}`);
  }
}

async function waitForExit(child: Deno.ChildProcess, timeoutMs: number): Promise<Deno.CommandStatus> {
  return await Promise.race([
    child.status,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`process ${child.pid} did not exit`)), timeoutMs)
    ),
  ]);
}

async function terminateProcess(child: Deno.ChildProcess, includeTree: boolean): Promise<void> {
  if (Deno.build.os !== 'windows') {
    child.kill('SIGTERM');
    return;
  }
  const args = ['/PID', String(child.pid), '/F'];
  if (includeTree) args.push('/T');
  const output = await new Deno.Command('taskkill.exe', {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (!output.success) {
    const message = new TextDecoder().decode(output.stderr).trim();
    if (/process .* not found/i.test(message)) return;
    fail(`taskkill failed for process ${child.pid}: ${message || `exit ${output.code}`}`);
  }
}

async function smokeParser(binary: string, expectedVersion: string, timeoutMs: number): Promise<void> {
  const output: string[] = [];
  const child = new Deno.Command(binary, {
    env: { PARSER_ADDR: '127.0.0.1:0' },
    stdout: 'null',
    stderr: 'piped',
  }).spawn();
  const stderrPump = pump(child.stderr.getReader(), output);
  try {
    const port = await Promise.race([
      waitForParserListener(output, timeoutMs),
      child.status.then(async (status) => {
        await stderrPump;
        fail(`parser exited before opening its listener with code ${status.code}: ${output.join('').slice(-4_000)}`);
      }),
    ]);
    const baseURL = `http://127.0.0.1:${port}`;
    try {
      await waitForHealth(baseURL, expectedVersion, timeoutMs);
    } catch (error: unknown) {
      fail(
        `${error instanceof Error ? error.message : String(error)}; parser output: ${output.join('').slice(-4_000)}`
      );
    }
    await verifyParserAPI(baseURL, timeoutMs);
    await terminateProcess(child, false);
    const status = await waitForExit(child, timeoutMs);
    if (Deno.build.os !== 'windows' && !status.success) {
      fail(`parser exited after shutdown with code ${status.code}`);
    }
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {
      // The expected graceful path has already reaped the process.
    }
    await child.status.catch(() => undefined);
    await Promise.race([stderrPump, new Promise<void>((resolve) => setTimeout(resolve, Math.min(timeoutMs, 2_000)))]);
  }
}

async function pump(reader: ReadableStreamDefaultReader<Uint8Array>, output: string[]): Promise<void> {
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    output.push(decoder.decode());
    reader.releaseLock();
  }
}

async function waitForParserListener(output: readonly string[], timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const line of output.join('').split(/\r?\n/)) {
      try {
        const entry = JSON.parse(line) as { msg?: unknown; addr?: unknown };
        if (entry.msg !== 'parser server listening' || typeof entry.addr !== 'string') continue;
        const match = entry.addr.match(/:(\d+)$/);
        if (match) return Number(match[1]);
      } catch {
        // The final log line may still be arriving in another stream chunk.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  fail(`parser did not report its listener address: ${output.join('').slice(-4_000)}`);
}

async function waitForAdjacentParser(output: readonly string[], timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = output.join('').match(/\[parser\].*Ready on port (\d+)/);
    if (match) return Number(match[1]);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`app did not discover its adjacent parser: ${output.join('').slice(-4_000)}`);
}

async function waitForParserStop(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(300),
      });
      await response.body?.cancel();
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`adjacent parser on port ${port} survived parent termination`);
}

async function smokeAdjacentDiscovery(
  app: string,
  directory: string,
  expectedVersion: string,
  timeoutMs: number
): Promise<number> {
  const output: string[] = [];
  const dataDirectory = await Deno.makeTempDir({
    prefix: 'praxrr-release-smoke-',
  });
  const child = new Deno.Command(app, {
    cwd: directory,
    env: {
      APP_BASE_PATH: dataDirectory,
      AUTH: 'off',
      HOST: '127.0.0.1',
      PORT: String(reserveLoopbackPort()),
      PARSER_HOST: '',
      PARSER_PORT: '',
    },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  const pumps = [pump(child.stdout.getReader(), output), pump(child.stderr.getReader(), output)];
  let parserPort = 0;
  try {
    parserPort = await waitForAdjacentParser(output, timeoutMs);
    await waitForHealth(`http://127.0.0.1:${parserPort}`, expectedVersion, timeoutMs);
    await terminateProcess(child, true);
    await waitForExit(child, timeoutMs);
    await waitForParserStop(parserPort, timeoutMs);
    return parserPort;
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {
      // The parent has already exited.
    }
    await child.status.catch(() => undefined);
    await Promise.race([
      Promise.allSettled(pumps),
      new Promise<void>((resolve) => setTimeout(resolve, Math.min(timeoutMs, 2_000))),
    ]);
    await Deno.remove(dataDirectory, { recursive: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(Deno.args);
  const layout = await validateLayout(options);
  let adjacentParserPort: number | undefined;
  if (options.native) {
    await smokeParser(layout.parser, options.expectedVersion, options.timeoutMs);
    adjacentParserPort = await smokeAdjacentDiscovery(
      layout.app,
      await Deno.realPath(options.directory),
      options.expectedVersion,
      options.timeoutMs
    );
  }
  console.log(
    JSON.stringify({
      kind: 'parser-release-smoke',
      platform: options.platform,
      archive: basename(options.archive),
      sha256: layout.digest,
      layout: 'adjacent',
      nativeSmoke: options.native,
      version: options.expectedVersion,
      adjacentParserPort,
      parentChildTermination: options.native,
    })
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}
