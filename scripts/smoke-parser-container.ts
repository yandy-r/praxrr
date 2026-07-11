const DEFAULT_VERSION = '2.0.0-go.1';
const DEFAULT_TIMEOUT_MS = 20_000;

interface Options {
  image: string;
  expectedVersion: string;
  expectedImageId?: string;
  timeoutMs: number;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ImageInspect {
  Id?: unknown;
  RepoTags?: unknown;
  RepoDigests?: unknown;
  Config?: {
    User?: unknown;
    Entrypoint?: unknown;
    ExposedPorts?: unknown;
    Healthcheck?: unknown;
    Labels?: unknown;
  };
}

interface ContainerInspect {
  State?: { Running?: unknown; ExitCode?: unknown; OOMKilled?: unknown };
  HostConfig?: { PortBindings?: unknown };
}

const USAGE = `Smoke a Praxrr parser OCI image without publishing its private port.

Usage:
  deno run -A scripts/smoke-parser-container.ts --image IMAGE [options]

Options:
  --image IMAGE              Local image reference or digest (required)
  --expected-version VALUE   Expected health behavior version (default: ${DEFAULT_VERSION})
  --expected-image-id VALUE  Expected immutable docker image ID (sha256:...)
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
  let image = '';
  let expectedVersion = Deno.env.get('PARSER_BEHAVIOR_VERSION') ?? DEFAULT_VERSION;
  let expectedImageId: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') {
      console.log(USAGE);
      Deno.exit(0);
    }
    const name = argument.split('=', 1)[0];
    if (!['--image', '--expected-version', '--expected-image-id', '--timeout-ms'].includes(name))
      fail(`unknown argument: ${argument}`);
    const [value, nextIndex] = optionValue(args, index, name);
    index = nextIndex;
    if (name === '--image') image = value;
    if (name === '--expected-version') expectedVersion = value;
    if (name === '--expected-image-id') expectedImageId = value;
    if (name === '--timeout-ms') {
      timeoutMs = Number(value);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000)
        fail('--timeout-ms must be an integer from 1000 through 120000');
    }
  }
  if (!image) fail('--image is required');
  if (!expectedVersion.trim()) fail('--expected-version cannot be empty');
  return { image, expectedVersion, expectedImageId, timeoutMs };
}

async function docker(args: string[], allowFailure = false, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
  const output = await new Deno.Command('docker', {
    args,
    stdout: 'piped',
    stderr: 'piped',
    signal: AbortSignal.timeout(timeoutMs),
  }).output();
  const decoder = new TextDecoder();
  const result = {
    code: output.code,
    stdout: decoder.decode(output.stdout).trim(),
    stderr: decoder.decode(output.stderr).trim(),
  };
  if (result.code !== 0 && !allowFailure) {
    fail(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function first<T>(value: unknown, location: string): T {
  if (!Array.isArray(value) || value.length !== 1) {
    fail(`${location} must contain exactly one object`);
  }
  return value[0] as T;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

async function inspectImage(options: Options): Promise<{ id: string; digestVerified: boolean }> {
  const inspected = first<ImageInspect>(
    JSON.parse((await docker(['image', 'inspect', options.image])).stdout),
    'docker image inspect'
  );
  if (typeof inspected.Id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(inspected.Id))
    fail('image has no immutable sha256 image ID');
  if (options.expectedImageId && inspected.Id !== options.expectedImageId) {
    fail(`image ID mismatch: got ${inspected.Id}, expected ${options.expectedImageId}`);
  }
  const config = inspected.Config ?? {};
  const user = typeof config.User === 'string' ? config.User.trim() : '';
  if (!user || user === '0' || user === 'root' || user.startsWith('0:') || user.startsWith('root:'))
    fail(`image must configure a non-root user, got ${user || '<empty>'}`);
  if (JSON.stringify(config.Entrypoint) !== JSON.stringify(['/app/praxrr-parser'])) {
    fail(`image entrypoint must be exactly ["/app/praxrr-parser"], got ${JSON.stringify(config.Entrypoint)}`);
  }
  if (typeof config.ExposedPorts !== 'object' || config.ExposedPorts === null || !('5000/tcp' in config.ExposedPorts))
    fail('image must expose 5000/tcp');
  if (typeof config.Healthcheck !== 'object' || config.Healthcheck === null) {
    fail('image must define a health check');
  }
  const labels =
    typeof config.Labels === 'object' && config.Labels !== null ? (config.Labels as Record<string, unknown>) : {};
  if (labels['org.opencontainers.image.title'] !== 'Praxrr Parser') {
    fail('image OCI title must be exactly Praxrr Parser');
  }
  const repoNames = [...stringArray(inspected.RepoTags), ...stringArray(inspected.RepoDigests)].map(
    (entry) => entry.split(/[:@]/, 1)[0]
  );
  if (!repoNames.includes('ghcr.io/yandy-r/praxrr-parser')) {
    fail(`image must carry the ghcr.io/yandy-r/praxrr-parser identity, got ${repoNames.join(', ') || '<none>'}`);
  }
  return {
    id: inspected.Id,
    digestVerified: options.expectedImageId !== undefined,
  };
}

async function inspectContainer(name: string): Promise<ContainerInspect> {
  return first<ContainerInspect>(
    JSON.parse((await docker(['container', 'inspect', name])).stdout),
    'docker container inspect'
  );
}

async function execRequest(
  name: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const args = ['exec', name, 'wget', '-qO-', '--timeout=3'];
  if (method === 'POST') {
    args.push('--header=Content-Type: application/json', `--post-data=${JSON.stringify(body)}`);
  }
  args.push(`http://127.0.0.1:5000${path}`);
  const result = await docker(args, true);
  if (result.code !== 0) {
    fail(`${method} ${path} failed inside container: ${result.stderr || result.stdout}`);
  }
  const parsed: unknown = JSON.parse(result.stdout);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(`${path} response must be an object`);
  }
  return parsed as Record<string, unknown>;
}

async function waitForHealth(name: string, expectedVersion: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'container did not respond';
  while (Date.now() < deadline) {
    try {
      const health = await execRequest(name, 'GET', '/health');
      if (health.status === 'healthy' && health.version === expectedVersion) {
        return;
      }
      lastError = JSON.stringify(health);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail(`/health did not report healthy version ${expectedVersion}: ${lastError}`);
}

async function verifyAPI(name: string): Promise<void> {
  const parsed = await execRequest(name, 'POST', '/parse', {
    title: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
    type: 'movie',
  });
  if (parsed.source !== 'Bluray' || parsed.resolution !== 1080 || parsed.releaseGroup !== 'GROUP')
    fail(`/parse returned unexpected semantics: ${JSON.stringify(parsed)}`);
  const matched = await execRequest(name, 'POST', '/match', {
    text: 'The.Matrix.1999.1080p.BluRay.x264-GROUP',
    patterns: ['(?i)bluray', '(?i)web[ ._-]?dl'],
  });
  const matchResults = matched.results as Record<string, unknown> | undefined;
  if (!matchResults || matchResults['(?i)bluray'] !== true || matchResults['(?i)web[ ._-]?dl'] !== false) {
    fail(`/match returned unexpected semantics: ${JSON.stringify(matched)}`);
  }
  const batch = await execRequest(name, 'POST', '/match/batch', {
    texts: ['Film.2020.1080p.WEB-DL-GROUP', 'Film.2020.1080p.BluRay-GROUP'],
    patterns: ['(?i)web[ ._-]?dl', '(?i)bluray'],
  });
  const batchResults = batch.results as Record<string, unknown> | undefined;
  const web = batchResults?.['Film.2020.1080p.WEB-DL-GROUP'] as Record<string, unknown> | undefined;
  const bluray = batchResults?.['Film.2020.1080p.BluRay-GROUP'] as Record<string, unknown> | undefined;
  if (
    !web ||
    !bluray ||
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
  const image = await inspectImage(options);
  const name = `praxrr-parser-smoke-${crypto.randomUUID().slice(0, 8)}`;
  let created = false;
  try {
    await docker(['run', '--detach', '--name', name, '--network', 'none', options.image]);
    created = true;
    const running = await inspectContainer(name);
    if (running.State?.Running !== true) {
      fail('container did not enter running state');
    }
    const bindings = running.HostConfig?.PortBindings;
    if (bindings && typeof bindings === 'object' && Object.keys(bindings).length !== 0)
      fail('container published a host port; parser must remain private');
    const uid = (await docker(['exec', name, 'id', '-u'])).stdout;
    if (uid === '0' || !/^\d+$/.test(uid)) {
      fail(`container must run as a numeric non-root uid, got ${uid}`);
    }

    await waitForHealth(name, options.expectedVersion, options.timeoutMs);
    await verifyAPI(name);
    await docker(
      ['stop', '--time', String(Math.max(1, Math.ceil(options.timeoutMs / 1_000))), name],
      false,
      options.timeoutMs + 2_000
    );
    const stopped = await inspectContainer(name);
    if (stopped.State?.Running !== false || stopped.State?.ExitCode !== 0 || stopped.State?.OOMKilled !== false) {
      fail(`container did not terminate gracefully: ${JSON.stringify(stopped.State)}`);
    }
    console.log(
      JSON.stringify({
        kind: 'parser-container-smoke',
        image: options.image,
        imageId: image.id,
        imageIdVerified: image.digestVerified,
        version: options.expectedVersion,
        entrypoint: '/app/praxrr-parser',
        uid,
        network: 'none',
        publishedPorts: 0,
        gracefulExitCode: stopped.State.ExitCode,
      })
    );
  } finally {
    if (created) {
      await docker(['rm', '--force', name], true, options.timeoutMs);
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}
