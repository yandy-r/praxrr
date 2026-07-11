const DEFAULT_VERSION = '2.0.0-go.1';
const DEFAULT_TIMEOUT_MS = 15_000;

interface Options {
  binary: string;
  expectedVersion: string;
  expectedSha256?: string;
  checksumFile?: string;
  timeoutMs: number;
}

const USAGE = `Smoke a native Praxrr parser artifact.

Usage:
  deno run -A scripts/smoke-parser-artifact.ts --binary PATH [options]

Options:
  --binary PATH              Native praxrr-parser[.exe] artifact (required)
  --expected-version VALUE   Expected health behavior version (default: ${DEFAULT_VERSION})
  --expected-sha256 VALUE    Expected lowercase or uppercase SHA-256 digest
  --checksum-file PATH       sha256sum-compatible file containing the artifact checksum
  --timeout-ms VALUE         Per-phase deadline (default: ${DEFAULT_TIMEOUT_MS})
  --help                     Show this help
`;

function fail(message: string): never {
  throw new Error(message);
}

function optionValue(args: string[], index: number, name: string): [string, number] {
  const equals = args[index].indexOf('=');
  if (equals >= 0) return [args[index].slice(equals + 1), index];
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return [value, index + 1];
}

function parseOptions(args: string[]): Options {
  let binary = '';
  let expectedVersion = Deno.env.get('PARSER_BEHAVIOR_VERSION') ?? DEFAULT_VERSION;
  let expectedSha256: string | undefined;
  let checksumFile: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') {
      console.log(USAGE);
      Deno.exit(0);
    }
    const name = argument.split('=', 1)[0];
    if (!['--binary', '--expected-version', '--expected-sha256', '--checksum-file', '--timeout-ms'].includes(name)) {
      fail(`unknown argument: ${argument}`);
    }
    const [value, nextIndex] = optionValue(args, index, name);
    index = nextIndex;
    if (name === '--binary') binary = value;
    if (name === '--expected-version') expectedVersion = value;
    if (name === '--expected-sha256') expectedSha256 = value;
    if (name === '--checksum-file') checksumFile = value;
    if (name === '--timeout-ms') {
      timeoutMs = Number(value);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
        fail('--timeout-ms must be an integer from 1000 through 120000');
      }
    }
  }
  if (!binary) fail('--binary is required');
  if (!expectedVersion.trim()) fail('--expected-version cannot be empty');
  return { binary, expectedVersion, expectedSha256, checksumFile, timeoutMs };
}

async function sha256(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function artifactName(path: string): string {
  return path.replaceAll('\\', '/').split('/').at(-1) ?? '';
}

async function expectedChecksum(options: Options, name: string): Promise<string | undefined> {
  if (options.expectedSha256 && options.checksumFile) {
    fail('--expected-sha256 and --checksum-file are mutually exclusive');
  }
  if (options.expectedSha256) return options.expectedSha256.toLowerCase();
  if (!options.checksumFile) return undefined;

  const entries = (await Deno.readTextFile(options.checksumFile)).split(/\r?\n/);
  for (const entry of entries) {
    const match = entry.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  fail(`checksum file does not contain an exact entry for ${name}`);
}

function reserveLoopbackPort(): number {
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function fetchWithDeadline(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function postJSON(baseUrl: string, path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const response = await fetchWithDeadline(
    `${baseUrl}${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  if (response.status !== 200) {
    fail(`${path} returned HTTP ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function waitForHealth(baseUrl: string, expectedVersion: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'listener did not respond';
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithDeadline(`${baseUrl}/health`, {}, Math.min(1_000, timeoutMs));
      const body = record(await response.json(), '/health response');
      if (response.status === 200 && body.status === 'healthy' && body.version === expectedVersion) return;
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`/health did not report healthy version ${expectedVersion}: ${lastError}`);
}

async function verifyAPI(baseUrl: string, timeoutMs: number): Promise<void> {
  const parsed = record(
    await postJSON(
      baseUrl,
      '/parse',
      {
        title: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
        type: 'movie',
      },
      timeoutMs
    ),
    '/parse response'
  );
  if (
    parsed.title !== 'The.Matrix.1999.1080p.BluRay.x264-GROUP' ||
    parsed.source !== 'Bluray' ||
    parsed.resolution !== 1080 ||
    parsed.releaseGroup !== 'GROUP'
  ) {
    fail(`/parse returned unexpected semantics: ${JSON.stringify(parsed)}`);
  }

  const matched = record(
    await postJSON(
      baseUrl,
      '/match',
      {
        text: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
        patterns: ['(?i)bluray', '(?i)web[ ._-]?dl'],
      },
      timeoutMs
    ),
    '/match response'
  );
  const matchResults = record(matched.results, '/match response.results');
  if (matchResults['(?i)bluray'] !== true || matchResults['(?i)web[ ._-]?dl'] !== false) {
    fail(`/match returned unexpected semantics: ${JSON.stringify(matched)}`);
  }

  const batch = record(
    await postJSON(
      baseUrl,
      '/match/batch',
      {
        texts: ['Film.2020.1080p.WEB-DL-GROUP', 'Film.2020.1080p.BluRay-GROUP'],
        patterns: ['(?i)web[ ._-]?dl', '(?i)bluray'],
      },
      timeoutMs
    ),
    '/match/batch response'
  );
  const batchResults = record(batch.results, '/match/batch response.results');
  const web = record(batchResults['Film.2020.1080p.WEB-DL-GROUP'], '/match/batch web result');
  const bluray = record(batchResults['Film.2020.1080p.BluRay-GROUP'], '/match/batch bluray result');
  if (
    web['(?i)web[ ._-]?dl'] !== true ||
    web['(?i)bluray'] !== false ||
    bluray['(?i)web[ ._-]?dl'] !== false ||
    bluray['(?i)bluray'] !== true
  ) {
    fail(`/match/batch returned unexpected semantics: ${JSON.stringify(batch)}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(Deno.args);
  const name = artifactName(options.binary);
  if (name !== 'praxrr-parser' && name !== 'praxrr-parser.exe') {
    fail(`artifact name must be exactly praxrr-parser or praxrr-parser.exe, got ${name || '<empty>'}`);
  }
  const info = await Deno.stat(options.binary);
  if (!info.isFile) fail(`${options.binary} is not a file`);

  const digest = await sha256(options.binary);
  const expected = await expectedChecksum(options, name);
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) {
    fail('expected SHA-256 must contain exactly 64 hexadecimal characters');
  }
  if (expected && digest !== expected) {
    fail(`SHA-256 mismatch: got ${digest}, expected ${expected}`);
  }

  const port = reserveLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = new Deno.Command(options.binary, {
    env: { PARSER_ADDR: `127.0.0.1:${port}` },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();

  try {
    await waitForHealth(baseUrl, options.expectedVersion, options.timeoutMs);
    await verifyAPI(baseUrl, options.timeoutMs);
    child.kill('SIGTERM');
    const status = await Promise.race([
      child.status,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`parser did not terminate within ${options.timeoutMs}ms`)), options.timeoutMs)
      ),
    ]);
    if (!status.success || status.code !== 0) {
      fail(`parser exited after SIGTERM with code ${status.code}`);
    }
    console.log(
      JSON.stringify({
        kind: 'parser-artifact-smoke',
        artifact: name,
        version: options.expectedVersion,
        sha256: digest,
        checksumVerified: expected !== undefined,
        listener: 'loopback',
        gracefulExitCode: status.code,
      })
    );
  } finally {
    try {
      child.kill('SIGKILL');
    } catch {
      // The successful graceful-shutdown path has already reaped the process.
    }
    await child.status.catch(() => undefined);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}
