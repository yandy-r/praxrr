type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

interface OracleProvenance {
  sourceCommit: string;
  dotnetRuntime: string;
  container: string;
  os: string;
  culture: string;
  globalizationMode: string;
  timeZone: string;
  configuration: string;
  invocation: string;
}

interface GoldenRequest {
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface GoldenResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  decodedBody?: JsonValue;
}

interface GoldenFixture {
  id: string;
  category: string;
  notes: string;
  request: GoldenRequest;
  response: GoldenResponse | null;
}

interface GoldenManifest {
  schemaVersion: 1;
  oracle: OracleProvenance | null;
  selectedResponseHeaders: string[];
  excludedResponseHeaders: string[];
  fixtures: GoldenFixture[];
}

interface Options {
  baseUrl?: string;
  categories?: Set<string>;
  manifestPath: string;
  validate: boolean;
  verifyRecapture: boolean;
}

const DEFAULT_MANIFEST = 'packages/praxrr-parser/testdata/golden/manifest.json';
const USAGE = `Capture parser responses from a pinned legacy C# HTTP listener.

Usage:
  deno run --allow-net --allow-read --allow-write scripts/capture-parser-goldens.ts \\
    --base-url http://127.0.0.1:5000 [--categories parse,match]
  deno run --allow-read scripts/capture-parser-goldens.ts --validate
  deno run --allow-net --allow-read scripts/capture-parser-goldens.ts \\
    --base-url http://127.0.0.1:5000 --verify-recapture [--categories parse]

Options:
  --base-url URL          Explicit legacy listener URL. Required for capture.
  --categories LIST      Comma-separated fixture categories to capture.
  --manifest PATH        Manifest path (default: ${DEFAULT_MANIFEST}).
  --validate             Validate schema and canonical formatting; do not use network.
  --verify-recapture     Recapture and compare without modifying the manifest.
  --help                 Show this help.
`;

function fail(message: string): never {
  console.error(`error: ${message}`);
  Deno.exit(1);
}

function optionValue(args: string[], index: number, name: string): [string, number] {
  const arg = args[index];
  const equals = arg.indexOf('=');
  if (equals >= 0) return [arg.slice(equals + 1), index];
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return [value, index + 1];
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    manifestPath: DEFAULT_MANIFEST,
    validate: false,
    verifyRecapture: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') {
      console.log(USAGE);
      Deno.exit(0);
    } else if (arg === '--validate') {
      options.validate = true;
    } else if (arg === '--verify-recapture') {
      options.verifyRecapture = true;
    } else if (arg === '--base-url' || arg.startsWith('--base-url=')) {
      [options.baseUrl, index] = optionValue(args, index, '--base-url');
    } else if (arg === '--categories' || arg.startsWith('--categories=')) {
      const [value, nextIndex] = optionValue(args, index, '--categories');
      const categories = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (categories.length === 0) {
        fail('--categories must name at least one category');
      }
      options.categories = new Set(categories);
      index = nextIndex;
    } else if (arg === '--manifest' || arg.startsWith('--manifest=')) {
      [options.manifestPath, index] = optionValue(args, index, '--manifest');
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (options.validate && options.verifyRecapture) {
    fail('--validate and --verify-recapture are mutually exclusive');
  }
  if (options.validate && options.baseUrl) {
    fail('--validate does not accept --base-url');
  }
  if (options.validate && options.categories) {
    fail('--validate does not accept --categories');
  }
  if (!options.validate && !options.baseUrl) {
    fail('--base-url is required for capture');
  }
  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, location: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${location}.${key} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, location: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(`${location} must be an array of strings`);
  }
  return value;
}

function validateHeaders(value: unknown, location: string): Record<string, string> {
  if (!isRecord(value)) fail(`${location} must be an object`);
  for (const [name, headerValue] of Object.entries(value)) {
    if (name !== name.toLowerCase()) {
      fail(`${location}.${name} must use a lowercase header name`);
    }
    if (typeof headerValue !== 'string') {
      fail(`${location}.${name} must be a string`);
    }
  }
  return value as Record<string, string>;
}

function validateProvenance(value: unknown): OracleProvenance | null {
  if (value === null) return null;
  if (!isRecord(value)) fail('oracle must be an object or null');
  return {
    sourceCommit: requireString(value, 'sourceCommit', 'oracle'),
    dotnetRuntime: requireString(value, 'dotnetRuntime', 'oracle'),
    container: requireString(value, 'container', 'oracle'),
    os: requireString(value, 'os', 'oracle'),
    culture: requireString(value, 'culture', 'oracle'),
    globalizationMode: requireString(value, 'globalizationMode', 'oracle'),
    timeZone: requireString(value, 'timeZone', 'oracle'),
    configuration: requireString(value, 'configuration', 'oracle'),
    invocation: requireString(value, 'invocation', 'oracle'),
  };
}

function validateResponse(value: unknown, location: string): GoldenResponse | null {
  if (value === null) return null;
  if (!isRecord(value)) fail(`${location} must be an object or null`);
  if (!Number.isInteger(value.status) || (value.status as number) < 100 || (value.status as number) > 599) {
    fail(`${location}.status must be an HTTP status integer`);
  }
  const response: GoldenResponse = {
    status: value.status as number,
    headers: validateHeaders(value.headers, `${location}.headers`),
    body: requireStringOrEmpty(value, 'body', location),
  };
  if ('decodedBody' in value) {
    response.decodedBody = value.decodedBody as JsonValue;
  }
  return response;
}

function requireStringOrEmpty(record: Record<string, unknown>, key: string, location: string): string {
  const value = record[key];
  if (typeof value !== 'string') fail(`${location}.${key} must be a string`);
  return value;
}

function validateManifest(value: unknown, allowPendingResponses: boolean): GoldenManifest {
  if (!isRecord(value)) fail('manifest root must be an object');
  if (value.schemaVersion !== 1) fail('schemaVersion must be 1');
  const oracle = validateProvenance(value.oracle);
  const selectedResponseHeaders = requireStringArray(value.selectedResponseHeaders, 'selectedResponseHeaders');
  const excludedResponseHeaders = requireStringArray(value.excludedResponseHeaders, 'excludedResponseHeaders');
  if (!Array.isArray(value.fixtures)) fail('fixtures must be an array');

  const ids = new Set<string>();
  const fixtures = value.fixtures.map((rawFixture, index): GoldenFixture => {
    const location = `fixtures[${index}]`;
    if (!isRecord(rawFixture)) fail(`${location} must be an object`);
    const id = requireString(rawFixture, 'id', location);
    if (ids.has(id)) fail(`duplicate fixture id: ${id}`);
    ids.add(id);
    if (!isRecord(rawFixture.request)) {
      fail(`${location}.request must be an object`);
    }
    const method = requireString(rawFixture.request, 'method', `${location}.request`);
    if (method !== 'GET' && method !== 'POST') {
      fail(`${location}.request.method must be GET or POST`);
    }
    const path = requireString(rawFixture.request, 'path', `${location}.request`);
    if (!path.startsWith('/') || path.startsWith('//')) {
      fail(`${location}.request.path must be an origin-relative path`);
    }
    const response = validateResponse(rawFixture.response, `${location}.response`);
    if (response === null && !allowPendingResponses) {
      fail(`${location}.response is not captured`);
    }
    return {
      id,
      category: requireString(rawFixture, 'category', location),
      notes: requireStringOrEmpty(rawFixture, 'notes', location),
      request: {
        method,
        path,
        headers: validateHeaders(rawFixture.request.headers, `${location}.request.headers`),
        body: requireStringOrEmpty(rawFixture.request, 'body', `${location}.request`),
      },
      response,
    };
  });

  if (fixtures.length > 0 && oracle === null) {
    fail('oracle provenance is required when fixtures exist');
  }
  return {
    schemaVersion: 1,
    oracle,
    selectedResponseHeaders,
    excludedResponseHeaders,
    fixtures,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalText(manifest: GoldenManifest): string {
  const stable = {
    ...manifest,
    selectedResponseHeaders: [...manifest.selectedResponseHeaders].sort(),
    excludedResponseHeaders: [...manifest.excludedResponseHeaders].sort(),
    fixtures: [...manifest.fixtures].sort((left, right) => left.id.localeCompare(right.id)),
  };
  return `${JSON.stringify(canonicalize(stable), null, 2)}\n`;
}

function selectFixtures(manifest: GoldenManifest, categories?: Set<string>): GoldenFixture[] {
  if (!categories) return manifest.fixtures;
  const known = new Set(manifest.fixtures.map((fixture) => fixture.category));
  for (const category of categories) {
    if (!known.has(category)) fail(`unknown fixture category: ${category}`);
  }
  return manifest.fixtures.filter((fixture) => categories.has(fixture.category));
}

function listenerUrl(baseUrl: string, path: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    fail(`invalid --base-url: ${baseUrl}`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    fail('--base-url must use http or https');
  }
  if (base.username || base.password || base.search || base.hash) {
    fail('--base-url must not contain credentials, query, or fragment');
  }
  if (base.pathname !== '/') {
    fail('--base-url must identify the listener origin without a path');
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    fail('fixture path escaped the configured listener');
  }
  return url;
}

async function captureFixture(
  fixture: GoldenFixture,
  baseUrl: string,
  selectedHeaders: string[]
): Promise<GoldenFixture> {
  const url = listenerUrl(baseUrl, fixture.request.path);
  const response = await fetch(url, {
    method: fixture.request.method,
    headers: fixture.request.headers,
    body: fixture.request.method === 'GET' ? undefined : fixture.request.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  const headers: Record<string, string> = {};
  for (const name of selectedHeaders) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const captured: GoldenResponse = { status: response.status, headers, body };
  try {
    captured.decodedBody = JSON.parse(body) as JsonValue;
  } catch {
    // Raw body remains the oracle evidence for non-JSON framework responses.
  }
  return { ...fixture, response: captured };
}

async function main(): Promise<void> {
  const options = parseOptions(Deno.args);
  let raw: string;
  try {
    raw = await Deno.readTextFile(options.manifestPath);
  } catch (error) {
    fail(`cannot read ${options.manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`invalid JSON in ${options.manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const manifest = validateManifest(parsed, !options.validate);
  if (options.validate) {
    if (raw !== canonicalText(manifest)) {
      fail(`${options.manifestPath} is not canonical; run capture`);
    }
    console.log(`Validated ${manifest.fixtures.length} golden fixture(s).`);
    return;
  }

  if (manifest.oracle === null) {
    fail('oracle provenance must be completed before capture');
  }
  const selected = selectFixtures(manifest, options.categories);
  if (selected.length === 0) fail('no fixtures selected for capture');
  if (options.verifyRecapture) {
    const pending = selected.find((fixture) => fixture.response === null);
    if (pending) fail(`${pending.id} has no committed response to verify`);
  }
  const capturedById = new Map<string, GoldenFixture>();
  for (const fixture of selected) {
    capturedById.set(fixture.id, await captureFixture(fixture, options.baseUrl!, manifest.selectedResponseHeaders));
  }
  const recaptured: GoldenManifest = {
    ...manifest,
    fixtures: manifest.fixtures.map((fixture) => capturedById.get(fixture.id) ?? fixture),
  };

  if (options.verifyRecapture) {
    for (const fixture of selected) {
      const actual = capturedById.get(fixture.id)!;
      if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(fixture))) {
        fail(`recapture differs for fixture ${fixture.id}`);
      }
    }
    console.log(`Verified deterministic recapture of ${selected.length} fixture(s).`);
    return;
  }

  await Deno.writeTextFile(options.manifestPath, canonicalText(recaptured));
  console.log(`Captured ${selected.length} fixture(s) from ${options.baseUrl}.`);
}

await main();
