import { parse as parseYaml } from '@std/yaml';

type MeasurementStatus = 'measured' | 'pending';

interface Options {
  baseUrl: string;
  image: string;
  limitsPath: string;
  baselinePath: string;
  repeat: number;
  validate: boolean;
}

interface SourceEvidence {
  path: string;
  kind: 'repository-fixture' | 'ui-route' | 'app-route' | 'runtime-oracle';
  detail: string;
}

interface Environment {
  capturedAt: string;
  sourceCommit: string;
  host: {
    os: string;
    architecture: string;
    logicalCpuCount: number;
    totalMemoryBytes: number;
  };
  oracle: {
    baseUrl: string;
    image: string;
    imageDigest: string;
    os: string;
    architecture: string;
    dotnetRuntime: string;
    parserVersion: string;
  };
}

interface Samples {
  count: number;
  values: number[];
  p50: number;
  p95: number;
  p99: number;
}

interface LimitDimension {
  id:
    | 'request_body_bytes'
    | 'text_characters'
    | 'pattern_characters'
    | 'text_count'
    | 'pattern_count'
    | 'unique_key_count'
    | 'text_pattern_work_product';
  unit: 'bytes' | 'characters' | 'items' | 'match-cells';
  status: MeasurementStatus;
  sources: SourceEvidence[];
  observedMaximum: number | null;
  samples: Samples | null;
  margin: {
    formula: 'max(observed * 2, observed + fixed_headroom)';
    fixedHeadroom: number;
    computedLimit: number | null;
  };
  chosenLimit: number | null;
  clientDeadlineRelation: {
    clientDeadlineMs: 30000;
    relation: string;
  };
  overflowCase: {
    value: number | null;
    expected: 'reject-before-work';
  };
  approval: {
    state: 'approved' | 'pending';
    approvedBy: string | null;
    reason: string;
  };
  pendingReason: string | null;
}

interface BaselineMetric {
  id:
    | 'startup_health_ms'
    | 'idle_rss_bytes'
    | 'image_size_bytes'
    | 'binary_size_bytes'
    | 'application_payload_bytes'
    | 'cold_parse_1_ms'
    | 'cold_parse_10_ms'
    | 'cold_parse_50_ms'
    | 'warm_parse_1_ms'
    | 'warm_parse_10_ms'
    | 'warm_parse_50_ms'
    | 'health_under_load_ms'
    | 'graceful_shutdown_ms';
  unit: 'bytes' | 'milliseconds';
  status: MeasurementStatus;
  sources: SourceEvidence[];
  samples: Samples | null;
  acceptance: {
    relation: string;
    threshold: number | null;
    state: 'legacy-baseline' | 'pass' | 'fail' | 'pending';
    reason: string;
  };
  pendingReason: string | null;
}

const DEFAULT_BASE_URL = 'http://172.19.0.6:5000';
const DEFAULT_IMAGE = 'sha256:9f150cfe1a0d14bcf5d0ed089b11dffca3015672736d95733014b13e6b2c4392';
const DEFAULT_LIMITS = 'packages/praxrr-parser/testdata/golden/limits.json';
const DEFAULT_BASELINE = 'packages/praxrr-parser/testdata/golden/baseline.json';
const CLIENT_DEADLINE_MS = 30000 as const;
const UI_MAX_TITLES = 50;
const UI_MAX_TITLE_CHARACTERS = 500;
const encoder = new TextEncoder();

const USAGE = `Measure the pinned legacy parser and derive finite parser limits.

Usage:
  deno run -A scripts/measure-parser-baseline.ts --repeat=2 --validate

Options:
  --base-url URL       Running legacy oracle (default: ${DEFAULT_BASE_URL})
  --image IMAGE        Pinned Docker image ID (default: ${DEFAULT_IMAGE})
  --repeat N           Independent measurement rounds (default: 1)
  --limits PATH        limits output (default: ${DEFAULT_LIMITS})
  --baseline PATH      baseline output (default: ${DEFAULT_BASELINE})
  --validate           Validate schema, finite limits, approvals, and measured metrics
  --help               Show this help
`;

function fail(message: string): never {
  console.error(`error: ${message}`);
  Deno.exit(1);
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    baseUrl: DEFAULT_BASE_URL,
    image: DEFAULT_IMAGE,
    limitsPath: DEFAULT_LIMITS,
    baselinePath: DEFAULT_BASELINE,
    repeat: 1,
    validate: false,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') {
      console.log(USAGE);
      Deno.exit(0);
    }
    if (argument === '--validate') {
      options.validate = true;
      continue;
    }
    const [name, inlineValue] = argument.split('=', 2);
    if (!['--base-url', '--image', '--repeat', '--limits', '--baseline'].includes(name)) {
      fail(`unknown argument: ${argument}`);
    }
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) fail(`${name} requires a value`);
    if (name === '--base-url') options.baseUrl = value.replace(/\/$/, '');
    if (name === '--image') options.image = value;
    if (name === '--limits') options.limitsPath = value;
    if (name === '--baseline') options.baselinePath = value;
    if (name === '--repeat') {
      options.repeat = Number(value);
      if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 20) {
        fail('--repeat must be an integer from 1 through 20');
      }
    }
  }
  return options;
}

async function command(command: string, args: string[], allowFailure = false): Promise<string> {
  const output = await new Deno.Command(command, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();
  if (!output.success && !allowFailure) {
    fail(`${command} ${args.join(' ')} failed: ${stderr || stdout}`);
  }
  return stdout;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    fail('cannot calculate a percentile without samples');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return Number(sorted[Math.max(0, rank)].toFixed(3));
}

function samples(values: number[]): Samples {
  const normalized = values.map((value) => Number(value.toFixed(3)));
  return {
    count: normalized.length,
    values: normalized,
    p50: percentile(normalized, 50),
    p95: percentile(normalized, 95),
    p99: percentile(normalized, 99),
  };
}

function source(path: string, kind: SourceEvidence['kind'], detail: string): SourceEvidence {
  return { path, kind, detail };
}

async function walkYaml(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) paths.push(...(await walkYaml(path)));
    else if (entry.isFile && entry.name.endsWith('.yaml')) paths.push(path);
  }
  return paths.sort();
}

function collectNamedStrings(value: unknown, key: string, found: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNamedStrings(item, key, found);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [name, child] of Object.entries(value)) {
    if (name === key && typeof child === 'string') found.push(child);
    collectNamedStrings(child, key, found);
  }
}

async function repositoryEnvelope(): Promise<{
  titles: string[];
  patterns: string[];
  requestBodyBytes: number;
}> {
  const titleSources = [
    'packages/praxrr-app/src/routes/score-simulator/[databaseId]/presetSamples.json',
    ...(await walkYaml('packages/praxrr-db/entities/custom-formats')),
  ];
  const titles: string[] = [];
  const patterns: string[] = [];
  for (const path of titleSources) {
    const raw = await Deno.readTextFile(path);
    const parsed = path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
    collectNamedStrings(parsed, 'title', titles);
    if (path.endsWith('.yaml')) {
      collectNamedStrings(parsed, 'pattern', patterns);
    }
  }

  // The UI explicitly accepts 50 titles of 500 characters. This is a real
  // supported client workload even when checked-in examples are shorter.
  const maximumTitles = Array.from({ length: UI_MAX_TITLES }, (_, index) => {
    const prefix = `baseline-${index.toString().padStart(2, '0')}-`;
    return `${prefix}${'x'.repeat(UI_MAX_TITLE_CHARACTERS - prefix.length)}`;
  });
  const uniquePatterns = [...new Set(patterns)];
  const requestBodyBytes = encoder.encode(JSON.stringify({ texts: maximumTitles, patterns: uniquePatterns })).length;
  return { titles, patterns: uniquePatterns, requestBodyBytes };
}

async function fetchJson(baseUrl: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.text();
  if (!response.ok) {
    fail(`${path} returned ${response.status}: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    fail(`${path} did not return JSON`);
  }
}

async function timedRequest(baseUrl: string, path: string, init?: RequestInit): Promise<number> {
  const started = performance.now();
  await fetchJson(baseUrl, path, init);
  return performance.now() - started;
}

function parseBody(title: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, type: 'movie' }),
  };
}

function benchmarkTitles(count: number, round: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `Baseline.cold.${round}.${count}.${index}.2026.2160p.WEB-DL.DDP5.1.H.265-GROUP`
  );
}

async function measureParseBatch(baseUrl: string, titles: string[]): Promise<number> {
  const started = performance.now();
  await Promise.all(titles.map((title) => fetchJson(baseUrl, '/parse', parseBody(title))));
  return performance.now() - started;
}

function parseByteSize(value: string): number {
  const match = value.trim().match(/^([0-9.]+)\s*([KMGT]?i?B)$/i);
  if (!match) fail(`unrecognized byte size: ${value}`);
  const units: Record<string, number> = {
    B: 1,
    KB: 1000,
    KIB: 1024,
    MB: 1000 ** 2,
    MIB: 1024 ** 2,
    GB: 1000 ** 3,
    GIB: 1024 ** 3,
    TB: 1000 ** 4,
    TIB: 1024 ** 4,
  };
  return Math.round(Number(match[1]) * units[match[2].toUpperCase()]);
}

async function startOracle(
  image: string,
  round: number
): Promise<{ name: string; baseUrl: string; startupMs: number }> {
  const name = `praxrr-parser-baseline-${Deno.pid}-${round}`;
  const started = performance.now();
  await command('docker', ['run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::5000', image]);
  const portOutput = await command('docker', ['port', name, '5000/tcp']);
  const port = portOutput.match(/:(\d+)$/)?.[1];
  if (!port) fail(`could not determine mapped port from: ${portOutput}`);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return { name, baseUrl, startupMs: performance.now() - started };
      }
    } catch {
      // Listener has not bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await command('docker', ['rm', '--force', name], true);
  fail(`oracle ${name} did not become healthy within 30 seconds`);
}

async function measureHealthUnderLoad(baseUrl: string, patterns: string[]): Promise<number[]> {
  const texts = Array.from(
    { length: UI_MAX_TITLES },
    (_, index) => `Health.Load.${index}.2026.2160p.WEB-DL.DDP5.1.H.265-GROUP`
  );
  const load = fetchJson(baseUrl, '/match/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts, patterns }),
  });
  const health: number[] = [];
  for (let index = 0; index < 10; index++) {
    health.push(await timedRequest(baseUrl, '/health'));
  }
  await load;
  return health;
}

async function measureRuntime(
  options: Options,
  patterns: string[]
): Promise<{ values: Map<BaselineMetric['id'], number[]>; oracle: Environment['oracle'] }> {
  const values = new Map<BaselineMetric['id'], number[]>();
  const add = (id: BaselineMetric['id'], value: number) => values.set(id, [...(values.get(id) ?? []), value]);

  const health = (await fetchJson(options.baseUrl, '/health')) as {
    version?: unknown;
  };
  const imageInspect = JSON.parse(await command('docker', ['image', 'inspect', options.image]))[0] as Record<
    string,
    unknown
  >;
  const dotnetInfo = await command('docker', ['run', '--rm', '--entrypoint', 'dotnet', options.image, '--info']);
  const dotnetRuntime = dotnetInfo.match(/Microsoft\.NETCore\.App\s+([0-9.]+)/)?.[1] ?? 'unknown';
  const os = String(imageInspect.Os ?? 'unknown');
  const architecture = String(imageInspect.Architecture ?? 'unknown');
  const imageDigest = String(imageInspect.Id ?? options.image);
  add('image_size_bytes', Number(imageInspect.Size));
  add(
    'binary_size_bytes',
    Number(await command('docker', ['run', '--rm', '--entrypoint', 'stat', options.image, '-c', '%s', '/app/Parser']))
  );
  const payload = await command('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    options.image,
    '-c',
    "find /app -maxdepth 1 -type f -exec stat -c '%s' {} + | awk '{ total += $1 } END { print total }'",
  ]);
  add('application_payload_bytes', Number(payload));

  for (let round = 0; round < options.repeat; round++) {
    // Each cold size gets a fresh process. Sharing the process would silently
    // turn the 10/50-title cases into warm JIT measurements.
    for (const count of [1, 10, 50] as const) {
      const oracle = await startOracle(options.image, round * 100 + count);
      try {
        if (count === 1) {
          add('startup_health_ms', oracle.startupMs);
          const memory = await command('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', oracle.name]);
          add('idle_rss_bytes', parseByteSize(memory.split('/')[0]));
        }

        const titles = benchmarkTitles(count, round);
        add(`cold_parse_${count}_ms`, await measureParseBatch(oracle.baseUrl, titles));
        add(`warm_parse_${count}_ms`, await measureParseBatch(oracle.baseUrl, titles));
        if (count === 50) {
          for (const duration of await measureHealthUnderLoad(oracle.baseUrl, patterns)) {
            add('health_under_load_ms', duration);
          }
        }

        const shutdownStarted = performance.now();
        await command('docker', ['stop', '--time', '10', oracle.name]);
        if (count === 50) {
          add('graceful_shutdown_ms', performance.now() - shutdownStarted);
        }
      } finally {
        await command('docker', ['rm', '--force', oracle.name], true);
      }
    }
  }

  return {
    values,
    oracle: {
      baseUrl: options.baseUrl,
      image: options.image,
      imageDigest,
      os,
      architecture,
      dotnetRuntime,
      parserVersion: typeof health.version === 'string' ? health.version : 'unknown',
    },
  };
}

function limitDimension(
  id: LimitDimension['id'],
  unit: LimitDimension['unit'],
  observedMaximum: number,
  fixedHeadroom: number,
  sources: SourceEvidence[],
  relation: string,
  observationValues: number[] = [observedMaximum]
): LimitDimension {
  const computedLimit = Math.max(observedMaximum * 2, observedMaximum + fixedHeadroom);
  return {
    id,
    unit,
    status: 'measured',
    sources,
    observedMaximum,
    samples: samples(observationValues),
    margin: {
      formula: 'max(observed * 2, observed + fixed_headroom)',
      fixedHeadroom,
      computedLimit,
    },
    chosenLimit: computedLimit,
    clientDeadlineRelation: { clientDeadlineMs: CLIENT_DEADLINE_MS, relation },
    overflowCase: { value: computedLimit + 1, expected: 'reject-before-work' },
    approval: {
      state: 'approved',
      approvedBy: 'phase-0-measured-envelope-policy',
      reason:
        'Chosen limit exactly follows the reviewed margin formula and admits every measured fixture and UI maximum.',
    },
    pendingReason: null,
  };
}

function baselineMetric(
  id: BaselineMetric['id'],
  unit: BaselineMetric['unit'],
  values: number[] | undefined,
  relation: string,
  threshold: number | null
): BaselineMetric {
  if (!values || values.length === 0) {
    return {
      id,
      unit,
      status: 'pending',
      sources: [source('praxrr-parser:latest', 'runtime-oracle', 'Pinned legacy Docker image')],
      samples: null,
      acceptance: {
        relation,
        threshold,
        state: 'pending',
        reason: 'Metric could not be accessed; the pending reason must be cleared by a reproducible capture.',
      },
      pendingReason: 'No numeric samples were available from the pinned runtime oracle.',
    };
  }
  return {
    id,
    unit,
    status: 'measured',
    sources: [source('praxrr-parser:latest', 'runtime-oracle', 'Pinned legacy Docker image')],
    samples: samples(values),
    acceptance: {
      relation,
      threshold,
      state: 'legacy-baseline',
      reason: 'This is the measured legacy comparator; pass/fail is evaluated when the Go candidate is captured.',
    },
    pendingReason: null,
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateOutputs(limits: { dimensions: LimitDimension[] }, baseline: { metrics: BaselineMetric[] }): void {
  const expectedDimensions: LimitDimension['id'][] = [
    'request_body_bytes',
    'text_characters',
    'pattern_characters',
    'text_count',
    'pattern_count',
    'unique_key_count',
    'text_pattern_work_product',
  ];
  for (const id of expectedDimensions) {
    const dimension = limits.dimensions.find((candidate) => candidate.id === id);
    if (!dimension) fail(`limits: missing dimension ${id}`);
    if (dimension.status !== 'measured') {
      fail(`limits: ${id} is pending: ${dimension.pendingReason}`);
    }
    if (!dimension.samples || dimension.samples.count < 1) {
      fail(`limits: ${id} has no samples`);
    }
    if (!dimension.observedMaximum || !dimension.chosenLimit) {
      fail(`limits: ${id} must be positive and finite`);
    }
    const expectedLimit = Math.max(
      dimension.observedMaximum * 2,
      dimension.observedMaximum + dimension.margin.fixedHeadroom
    );
    if (dimension.chosenLimit !== expectedLimit || dimension.margin.computedLimit !== expectedLimit) {
      fail(`limits: ${id} does not follow the required margin formula`);
    }
    if (dimension.overflowCase.value !== dimension.chosenLimit + 1) {
      fail(`limits: ${id} overflow is not one-over`);
    }
    if (dimension.approval.state !== 'approved') {
      fail(`limits: ${id} is not approved`);
    }
  }
  for (const metric of baseline.metrics) {
    if (metric.status !== 'measured') {
      fail(`baseline: ${metric.id} is pending: ${metric.pendingReason}`);
    }
    if (!metric.samples || metric.samples.count < 1) {
      fail(`baseline: ${metric.id} has no samples`);
    }
    if (metric.samples.values.some((value) => !Number.isFinite(value) || value < 0)) {
      fail(`baseline: ${metric.id} contains an invalid sample`);
    }
  }
  const health = baseline.metrics.find((metric) => metric.id === 'health_under_load_ms');
  if (!health?.samples || health.samples.p95 >= 250) {
    fail(`baseline: legacy health-under-load p95 must be below 250ms (observed ${health?.samples?.p95 ?? 'pending'})`);
  }
  const shutdown = baseline.metrics.find((metric) => metric.id === 'graceful_shutdown_ms');
  if (!shutdown?.samples || shutdown.samples.p99 >= 10000) {
    fail(`baseline: legacy shutdown must complete within 10 seconds (observed ${shutdown?.samples?.p99 ?? 'pending'})`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(Deno.args);
  const envelope = await repositoryEnvelope();
  const runtime = await measureRuntime(options, envelope.patterns);
  const sourceCommit = await command('git', ['rev-parse', 'HEAD']);
  const os = await command('uname', ['-sr']);
  const environment: Environment = {
    capturedAt: new Date().toISOString(),
    sourceCommit,
    host: {
      os,
      architecture: Deno.build.arch,
      logicalCpuCount: navigator.hardwareConcurrency,
      totalMemoryBytes: Deno.systemMemoryInfo().total,
    },
    oracle: runtime.oracle,
  };

  const maximumRepositoryTitle = Math.max(0, ...envelope.titles.map((title) => title.length));
  const maximumPattern = Math.max(...envelope.patterns.map((pattern) => pattern.length));
  const textMaximum = Math.max(maximumRepositoryTitle, UI_MAX_TITLE_CHARACTERS);
  const patternCount = envelope.patterns.length;
  const uniqueKeyCount = UI_MAX_TITLES + patternCount;
  const workProduct = UI_MAX_TITLES * patternCount;
  const uiSource = source(
    'packages/praxrr-app/src/routes/score-simulator/[databaseId]/components/BatchInput.svelte',
    'ui-route',
    'UI accepts at most 50 titles and at most 500 characters per title.'
  );
  const pcdSource = source(
    'packages/praxrr-db/entities/custom-formats/*.yaml',
    'repository-fixture',
    'All pattern-bearing conditions in the repository PCD.'
  );
  const presetSource = source(
    'packages/praxrr-app/src/routes/score-simulator/[databaseId]/presetSamples.json',
    'repository-fixture',
    `Checked-in score-simulator titles; longest observed title is ${maximumRepositoryTitle} characters.`
  );
  const routeSources = [
    source(
      'packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts',
      'app-route',
      'Batch parse and unique-pattern matching consumer.'
    ),
    source(
      'packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts',
      'app-route',
      'Explicit 50-release and 10-profile ceiling.'
    ),
    source(
      'packages/praxrr-app/src/routes/api/v1/simulate/impact/+server.ts',
      'app-route',
      'Explicit 50-release, 10-profile, and 100-change ceiling.'
    ),
  ];

  const limits = {
    schemaVersion: 1,
    sources: [presetSource, uiSource, pcdSource, ...routeSources],
    environment,
    dimensions: [
      limitDimension(
        'request_body_bytes',
        'bytes',
        envelope.requestBodyBytes,
        65536,
        [uiSource, pcdSource],
        'The full request must be admitted and completed inside the 30s app-client deadline.'
      ),
      limitDimension(
        'text_characters',
        'characters',
        textMaximum,
        500,
        [presetSource, uiSource],
        'Text validation occurs before parsing and therefore before the 30s app-client deadline.',
        [...envelope.titles.map((title) => title.length), UI_MAX_TITLE_CHARACTERS]
      ),
      limitDimension(
        'pattern_characters',
        'characters',
        maximumPattern,
        1024,
        [pcdSource],
        'Pattern validation occurs before compilation and therefore before the 30s app-client deadline.',
        envelope.patterns.map((pattern) => pattern.length)
      ),
      limitDimension(
        'text_count',
        'items',
        UI_MAX_TITLES,
        50,
        [uiSource, ...routeSources],
        'Count validation occurs before fan-out and therefore before the 30s app-client deadline.'
      ),
      limitDimension(
        'pattern_count',
        'items',
        patternCount,
        256,
        [pcdSource, ...routeSources],
        'Count validation occurs before regex compilation and therefore before the 30s app-client deadline.'
      ),
      limitDimension(
        'unique_key_count',
        'items',
        uniqueKeyCount,
        256,
        [uiSource, pcdSource],
        'Unique dictionary keys are bounded before response allocation within the 30s app-client deadline.'
      ),
      limitDimension(
        'text_pattern_work_product',
        'match-cells',
        workProduct,
        10000,
        [uiSource, pcdSource, ...routeSources],
        'The complete work product must finish inside the 30s app-client deadline; each regex cell also retains its 100ms engine timeout.'
      ),
    ],
  };

  const metric = (id: BaselineMetric['id'], unit: BaselineMetric['unit'], relation: string, threshold: number | null) =>
    baselineMetric(id, unit, runtime.values.get(id), relation, threshold);
  const baseline = {
    schemaVersion: 1,
    sources: [
      source(options.image, 'runtime-oracle', 'Pinned .NET legacy parser image measured with fresh containers.'),
    ],
    environment,
    metrics: [
      metric(
        'startup_health_ms',
        'milliseconds',
        'Go startup-to-health p95 must be no slower than this legacy p95.',
        null
      ),
      metric('idle_rss_bytes', 'bytes', 'Go idle RSS must be lower than this legacy p50.', null),
      metric('image_size_bytes', 'bytes', 'Go image size must be lower than this legacy image size.', null),
      metric('binary_size_bytes', 'bytes', 'Go adjacent binary must be lower than this legacy launcher binary.', null),
      metric(
        'application_payload_bytes',
        'bytes',
        'Go application payload must be lower than this legacy /app payload.',
        null
      ),
      metric('cold_parse_1_ms', 'milliseconds', 'Go cold p95 and p99 must be within 10% of legacy.', 1.1),
      metric('cold_parse_10_ms', 'milliseconds', 'Go cold p95 and p99 must be within 10% of legacy.', 1.1),
      metric('cold_parse_50_ms', 'milliseconds', 'Go cold-50 p95 and p99 must be within 10% of legacy.', 1.1),
      metric('warm_parse_1_ms', 'milliseconds', 'Go warm p95 and p99 must be within 10% of legacy.', 1.1),
      metric('warm_parse_10_ms', 'milliseconds', 'Go warm p95 and p99 must be within 10% of legacy.', 1.1),
      metric('warm_parse_50_ms', 'milliseconds', 'Go warm p95 and p99 must be within 10% of legacy.', 1.1),
      metric('health_under_load_ms', 'milliseconds', 'Go health-under-load p95 must remain below 250ms.', 250),
      metric('graceful_shutdown_ms', 'milliseconds', 'Go graceful shutdown must complete within 10 seconds.', 10000),
    ],
  };

  if (options.validate) validateOutputs(limits, baseline);
  await Deno.mkdir(options.limitsPath.slice(0, options.limitsPath.lastIndexOf('/')), { recursive: true });
  await Deno.writeTextFile(options.limitsPath, canonicalJson(limits));
  await Deno.writeTextFile(options.baselinePath, canonicalJson(baseline));
  console.log(
    `Measured ${limits.dimensions.length} limit dimensions and ${baseline.metrics.length} legacy metrics (${options.repeat} repeat(s)).`
  );
  if (options.validate) {
    console.log(
      'Validation passed: finite envelope approved; all legacy metrics measured and lifecycle thresholds satisfied.'
    );
  }
}

await main();
