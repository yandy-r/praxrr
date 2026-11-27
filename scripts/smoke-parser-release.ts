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
  adjacent: boolean;
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
  --adjacent VALUE         Run the adjacent app lifecycle and HTTP smoke: true or false (default: true)
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
  let adjacent = true;
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
        '--adjacent',
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
    if (name === '--adjacent') adjacent = parseBoolean(value, name);
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
    adjacent,
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
  // The adapter-node build embeds its client assets in the app binary.
  for (const path of [app, parser]) {
    const info = await Deno.stat(path);
    if (!info.isFile) fail(`${path} must be a regular file`);
  }
  await validateMagic(app, expectedFiles.magic);
  await validateMagic(parser, expectedFiles.magic);
  return { app, parser, digest };
}

function reserveLoopbackPort(): number {
  for (let attempt = 0; attempt < 100; attempt++) {
    const random = crypto.getRandomValues(new Uint16Array(1))[0];
    const port = 20_000 + (random % 10_000);
    try {
      const listener = Deno.listen({ hostname: '127.0.0.1', port });
      listener.close();
      return port;
    } catch (error: unknown) {
      if (!(error instanceof Deno.errors.AddrInUse)) throw error;
    }
  }
  fail('could not reserve a parent application port below the OS ephemeral range');
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      child.status,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`process ${child.pid} did not exit`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function terminateProcess(child: Deno.ChildProcess, includeTree: boolean): Promise<void> {
  if (Deno.build.os !== 'windows') {
    try {
      child.kill('SIGTERM');
    } catch (error: unknown) {
      if (includeTree && error instanceof Error && error.message === 'Child process has already terminated') {
        return;
      }
      throw error;
    }
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

// Variables passed through to the app. Everything else is dropped so a runner's TRUSTED_PROXY,
// ORIGIN, *_HEADER or AUTH settings cannot change what the HTTP smoke proves.
const PASSTHROUGH_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'windir', 'USERPROFILE', 'LANG'];
const APP_SHUTDOWN_DEADLINE_MS = 10_000;
// A documentation-range (TEST-NET-3) address: never local, never routable.
const SPOOFED_FORWARDED_FOR = '203.0.113.7';
// Protected by the auth middleware (not a public path, not a prerendered page) and answers 200
// for a request the middleware lets through, so 200 vs 401 shows how the request was classified.
const PROTECTED_API_PATH = '/api/v1/security-posture/summary';

interface AppHTTPSmoke {
  appPort: number;
  immutableAsset: string;
  shutdownMs: number;
}

function appEnvironment(dataDirectory: string, appPort: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH_ENV) {
    const value = Deno.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    APP_BASE_PATH: dataDirectory,
    AUTH: 'local',
    HOST: '127.0.0.1',
    PORT: String(appPort),
    PARSER_HOST: '',
    PARSER_PORT: '',
    // No first-run auto-link: the smoke must not clone anything from the network.
    PRAXRR_DEFAULT_DB_URL: '',
    // Startup requires a credential key; a fresh random one per run, discarded with the data dir.
    ARR_CREDENTIAL_MASTER_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    ARR_CREDENTIAL_MASTER_KEY_VERSION: 'v1',
  };
}

async function appRequest(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return await fetch(url, {
    redirect: 'manual',
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function expectStatus(response: Response, expected: number, label: string): Promise<string> {
  const body = await response.text();
  if (response.status !== expected) {
    const location = response.headers.get('location');
    fail(
      `${label} returned HTTP ${response.status}${location ? ` (location ${location})` : ''}, ` +
        `expected ${expected}: ${body.slice(0, 500)}`
    );
  }
  return body;
}

async function waitForAppListener(baseURL: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'listener did not respond';
  while (Date.now() < deadline) {
    try {
      const response = await appRequest(`${baseURL}/auth/setup`, {}, Math.min(2_000, timeoutMs));
      if (response.status === 200) return await response.text();
      await response.body?.cancel();
      lastError = `HTTP ${response.status}`;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`app did not serve /auth/setup: ${lastError}`);
}

async function verifyImmutableAsset(baseURL: string, html: string, timeoutMs: number): Promise<string> {
  const match = html.match(/\/_app\/immutable\/[A-Za-z0-9._\-/]+\.(?:js|css)/);
  if (!match) fail('/auth/setup does not reference a hashed /_app/immutable asset');
  const asset = match[0];
  const response = await appRequest(`${baseURL}${asset}`, {}, timeoutMs);
  const body = await expectStatus(response, 200, asset);
  if (body.length === 0) fail(`${asset} returned an empty body`);
  return asset;
}

async function createSmokeUser(baseURL: string, timeoutMs: number): Promise<void> {
  // A throwaway account in a temporary data directory, so the local-bypass check below runs
  // against a configured instance instead of the first-run setup redirect.
  const password = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const response = await appRequest(
    `${baseURL}/auth/setup`,
    {
      method: 'POST',
      // A browser form post: without Accept: text/html, SvelteKit answers with a JSON redirect.
      headers: { accept: 'text/html', origin: baseURL },
      body: new URLSearchParams({ username: 'release-smoke', password, confirmPassword: password }),
    },
    timeoutMs
  );
  await expectStatus(response, 303, 'POST /auth/setup');
}

async function verifyAppHealth(baseURL: string, timeoutMs: number): Promise<void> {
  const response = await appRequest(`${baseURL}/api/v1/health`, {}, timeoutMs);
  const body = await expectStatus(response, 200, '/api/v1/health');
  const health = JSON.parse(body) as { status?: unknown };
  if (health.status !== 'healthy' && health.status !== 'degraded') {
    fail(`/api/v1/health reported status ${JSON.stringify(health.status)}`);
  }
}

async function verifyLocalBypassUsesSocketPeer(baseURL: string, timeoutMs: number): Promise<void> {
  // ITC-1952: under AUTH=local the client address must come from the socket, not from headers.
  const plain = await appRequest(`${baseURL}${PROTECTED_API_PATH}`, {}, timeoutMs);
  await expectStatus(plain, 200, `${PROTECTED_API_PATH} from loopback`);
  const spoofed = await appRequest(
    `${baseURL}${PROTECTED_API_PATH}`,
    { headers: { 'x-forwarded-for': SPOOFED_FORWARDED_FOR } },
    timeoutMs
  );
  await expectStatus(spoofed, 200, `${PROTECTED_API_PATH} from loopback with X-Forwarded-For`);
}

async function smokeAdjacentApp(
  app: string,
  directory: string,
  timeoutMs: number
): Promise<
  AppHTTPSmoke & {
    parserPort: number;
  }
> {
  const output: string[] = [];
  const dataDirectory = await Deno.makeTempDir({
    prefix: 'praxrr-release-smoke-',
  });
  const appPort = reserveLoopbackPort();
  const baseURL = `http://127.0.0.1:${appPort}`;
  const child = new Deno.Command(app, {
    cwd: directory,
    clearEnv: true,
    env: appEnvironment(dataDirectory, appPort),
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  const pumps = [pump(child.stdout.getReader(), output), pump(child.stderr.getReader(), output)];
  const withOutput = (message: string): never => fail(`${message}; app output: ${output.join('').slice(-4_000)}`);
  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  let exited = false;
  child.status.then(
    () => (exited = true),
    () => (exited = true)
  );
  let discoveredParserPort = 0;
  try {
    // Any exit before SIGTERM is a failure; surface it at once instead of at the next deadline.
    const earlyExit = child.status.then((status) => {
      throw new Error(`app exited before SIGTERM with code ${status.code} (signal ${status.signal})`);
    });
    earlyExit.catch(() => undefined);
    const { parserPort, immutableAsset } = await Promise.race([
      (async () => {
        // The app emits Ready only after its own parser health probe succeeds.
        const port = await waitForAdjacentParser(output, timeoutMs);
        discoveredParserPort = port;
        const setupHTML = await waitForAppListener(baseURL, timeoutMs);
        const asset = await verifyImmutableAsset(baseURL, setupHTML, timeoutMs);
        await createSmokeUser(baseURL, timeoutMs);
        await verifyAppHealth(baseURL, timeoutMs);
        await verifyLocalBypassUsesSocketPeer(baseURL, timeoutMs);
        return { parserPort: port, immutableAsset: asset };
      })(),
      earlyExit,
    ]).catch((error: unknown) => withOutput(messageOf(error)));

    const stopStarted = performance.now();
    await terminateProcess(child, true);
    const status = await waitForExit(child, APP_SHUTDOWN_DEADLINE_MS).catch(() =>
      withOutput(`app did not exit within ${APP_SHUTDOWN_DEADLINE_MS}ms of SIGTERM`)
    );
    // Windows has no SIGTERM: terminateProcess force-kills the tree, so the exit code is not graceful.
    if (Deno.build.os !== 'windows' && (!status.success || status.signal !== null)) {
      withOutput(`app exited after SIGTERM with code ${status.code} (signal ${status.signal})`);
    }
    const shutdownMs = Math.round(performance.now() - stopStarted);
    await waitForParserStop(parserPort, timeoutMs);
    return { appPort, immutableAsset, parserPort, shutdownMs };
  } finally {
    // A failed check skips the graceful stop above. SIGKILL alone would bypass the app's own
    // handlers that stop its adjacent parser, so try a bounded SIGTERM first.
    if (!exited) {
      await terminateProcess(child, true).catch(() => undefined);
      await waitForExit(child, APP_SHUTDOWN_DEADLINE_MS).catch(() => undefined);
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // The parent has already exited.
    }
    await child.status.catch(() => undefined);
    if (discoveredParserPort) {
      await waitForParserStop(discoveredParserPort, Math.min(timeoutMs, 5_000)).catch((error: unknown) =>
        console.error(`warning: ${messageOf(error)}; stop it by its listener on 127.0.0.1:${discoveredParserPort}`)
      );
    }
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
  let adjacent: (AppHTTPSmoke & { parserPort: number }) | undefined;
  if (options.native) {
    await smokeParser(layout.parser, options.expectedVersion, options.timeoutMs);
  }
  if (options.adjacent) {
    adjacent = await smokeAdjacentApp(layout.app, await Deno.realPath(options.directory), options.timeoutMs);
  }
  console.log(
    JSON.stringify({
      kind: 'parser-release-smoke',
      platform: options.platform,
      archive: basename(options.archive),
      sha256: layout.digest,
      layout: options.adjacent ? 'adjacent' : 'archive',
      nativeSmoke: options.native,
      adjacentSmoke: options.adjacent,
      version: options.expectedVersion,
      adjacentParserPort: adjacent?.parserPort,
      parentChildTermination: options.adjacent,
      appHTTPSmoke: adjacent
        ? {
            health: 200,
            immutableAsset: adjacent.immutableAsset,
            localBypassIgnoresForwardedFor: true,
            sigtermExit: 0,
            shutdownMs: adjacent.shutdownMs,
          }
        : undefined,
    })
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}
