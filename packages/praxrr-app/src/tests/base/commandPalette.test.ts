import { assertEquals } from '@std/assert';
import {
  buildPaletteGroups,
  createOptionIdMap,
  currentResults,
  flattenNavItems,
  isApplePlatform,
  isEditableTarget,
  isPaletteShortcut,
  matchesQuery,
  parseSearchResults,
  recentKindLabel,
  resolveNewCustomFormatHref,
} from '../../lib/client/ui/command-palette/sources.ts';
import {
  COMMAND_PALETTE_RECENTS_ENDPOINT,
  addRecent,
  createRecentsSync,
  loadRecents,
  saveRecents,
  type TimerHandle,
} from '../../lib/client/ui/command-palette/recents.ts';
import {
  COMMAND_PALETTE_RECENT_LIMITS,
  COMMAND_PALETTE_RECENTS_MAX,
  isSafeRelativeHref,
  isStorableRecentHref,
  validateCommandPaletteRecents,
  type CommandPaletteRecent,
} from '../../lib/shared/search/recents.ts';
import type { SearchResult } from '../../lib/shared/search/types.ts';
import type { NavShell, ResolvedNavItem } from '../../lib/shared/navigation/types.ts';

function navItem(
  id: string,
  label: string,
  href: string,
  extra: Partial<ResolvedNavItem> & { requiredFeature?: string } = {}
) {
  return {
    id,
    label,
    href,
    mobilePriority: 'secondary',
    hasChildren: (extra.children?.length ?? 0) > 0,
    children: [],
    iconKey: id,
    ...extra,
  } as ResolvedNavItem;
}

const shell: NavShell = {
  variant: 'nav_v2',
  arrScopeOptions: ['all', 'radarr', 'sonarr', 'lidarr'],
  groups: [
    {
      id: 'overview',
      label: 'Overview',
      items: [navItem('overview.databases', 'Databases', '/databases')],
    },
    {
      id: 'policies',
      label: 'Policies',
      items: [
        navItem('policies.custom_formats', 'Custom Formats', '/custom-formats', { requiredFeature: 'custom_formats' }),
        navItem('policies.metadata_profiles', 'Metadata Profiles', '/metadata-profiles', {
          requiredFeature: 'metadata_profiles',
        }),
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [
        navItem('settings', 'Settings', '/settings', {
          children: [
            { id: 'settings.general', label: 'General', href: '/settings/general' },
            { id: 'settings.logout', label: 'Log Out', href: '/auth/logout' },
          ],
        }),
      ],
    },
  ],
};

function result(type: SearchResult['type'], id: string, name: string, href: string, extra: Partial<SearchResult> = {}) {
  return { type, id, name, href, source: null, ...extra } satisfies SearchResult;
}

Deno.test('flattenNavItems includes children and skips Log Out', () => {
  const hrefs = flattenNavItems(shell, 'all').map((item) => item.href);
  assertEquals(hrefs, ['/databases', '/custom-formats', '/metadata-profiles', '/settings', '/settings/general']);
  const general = flattenNavItems(shell, 'all').find((item) => item.href === '/settings/general');
  assertEquals(general?.description, 'Settings');
  assertEquals(general?.key, 'nav:/settings/general');
});

Deno.test('flattenNavItems respects the Arr scope like pageNav', () => {
  const radarr = flattenNavItems(shell, 'radarr').map((item) => item.href);
  assertEquals(radarr.includes('/metadata-profiles'), false);
  assertEquals(radarr.includes('/custom-formats'), true);
  assertEquals(
    flattenNavItems(shell, 'lidarr').some((item) => item.href === '/metadata-profiles'),
    true
  );
  assertEquals(flattenNavItems(undefined, 'all'), []);
});

Deno.test('matchesQuery is case-insensitive and token based', () => {
  assertEquals(matchesQuery('Custom Formats', 'custom'), true);
  assertEquals(matchesQuery('Custom Formats', 'FORM cust'), true);
  assertEquals(matchesQuery('Custom Formats', 'profiles'), false);
  assertEquals(matchesQuery('Anything', '   '), true);
});

Deno.test('buildPaletteGroups orders Recent, Pages, Actions, then entity types', () => {
  const recents: CommandPaletteRecent[] = [
    { key: 'nav:/databases', label: 'Databases', href: '/databases', kind: 'nav', usedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const results = [
    result('database', 'database:3', 'Main DB', '/databases/3'),
    result('arr_instance', 'arr:2', 'Radarr 4K', '/arr/2', { arrType: 'radarr' }),
    result('custom_format', 'pcd:3:custom_format:12', 'Remux Tier', '/custom-formats/3/12', {
      source: { type: 'pcd', id: 3, name: 'Main DB' },
    }),
  ];
  const groups = buildPaletteGroups({ query: 'a', recents, navItems: flattenNavItems(shell, 'all'), results });
  assertEquals(
    groups.map((group) => group.id),
    ['recent', 'nav', 'action', 'custom_format', 'arr_instance', 'database']
  );
  // Recent items are not repeated in later groups.
  assertEquals(
    groups.find((group) => group.id === 'nav')?.items.some((item) => item.href === '/databases'),
    false
  );
  const actions = groups.find((group) => group.id === 'action')?.items ?? [];
  assertEquals(
    actions.some((item) => item.label === 'Sync instance Radarr 4K' && item.href === '/arr/2/sync'),
    true
  );
});

Deno.test('buildPaletteGroups with an empty query shows recents, pages and static actions only', () => {
  const groups = buildPaletteGroups({
    query: '',
    recents: [],
    navItems: flattenNavItems(shell, 'all'),
    results: [result('custom_format', 'pcd:1:custom_format:1', 'Stale', '/custom-formats/1/1')],
  });
  assertEquals(
    groups.map((group) => group.id),
    ['nav', 'action']
  );
  assertEquals(
    groups[1].items.map((item) => item.label),
    ['New custom format', 'Open score simulator']
  );
});

Deno.test('buildPaletteGroups drops recents with unsafe hrefs', () => {
  const recents: CommandPaletteRecent[] = [
    { key: 'x', label: 'Evil', href: '//evil.example', kind: 'nav', usedAt: '2026-01-01T00:00:00.000Z' },
  ];
  assertEquals(buildPaletteGroups({ query: '', recents, navItems: [], results: [] }).length, 1);
});

Deno.test('resolveNewCustomFormatHref uses the current database when known', () => {
  assertEquals(resolveNewCustomFormatHref('/custom-formats/4/12/general'), '/custom-formats/4/new');
  assertEquals(resolveNewCustomFormatHref('/quality-profiles/2'), '/custom-formats/2/new');
  assertEquals(resolveNewCustomFormatHref('/arr/1/sync'), '/custom-formats');
});

Deno.test('parseSearchResults keeps only well-formed results with safe hrefs', () => {
  const parsed = parseSearchResults({
    query: 'x',
    truncated: false,
    results: [
      {
        type: 'custom_format',
        id: 'a',
        name: 'A',
        href: '/custom-formats/1/1',
        source: { type: 'pcd', id: 1, name: 'DB' },
      },
      { type: 'custom_format', id: 'b', name: 'B', href: 'https://evil.example', source: null },
      { type: 'unknown', id: 'c', name: 'C', href: '/x', source: null },
      { type: 'arr_instance', id: 'arr:1', name: 'R', href: '/arr/1', source: null, arrType: 'radarr' },
      { type: 'database', id: 'd', name: 'D', href: '/databases/1', source: { type: 'bogus', id: 1, name: 'x' } },
    ],
  });
  assertEquals(
    parsed.map((entry) => entry.id),
    ['a', 'arr:1']
  );
  assertEquals(parsed[1].arrType, 'radarr');
  assertEquals(parseSearchResults(null), []);
  assertEquals(parseSearchResults({ results: 'nope' }), []);
});

Deno.test('addRecent dedupes by key, puts newest first and caps the list', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');
  let recents: CommandPaletteRecent[] = [];
  for (let i = 0; i < COMMAND_PALETTE_RECENTS_MAX + 3; i++) {
    recents = addRecent(recents, { key: `k${i}`, label: `L${i}`, href: `/p/${i}`, kind: 'nav' }, now);
  }
  assertEquals(recents.length, COMMAND_PALETTE_RECENTS_MAX);
  assertEquals(recents[0].key, `k${COMMAND_PALETTE_RECENTS_MAX + 2}`);

  recents = addRecent(recents, { key: 'k5', label: 'L5 again', href: '/p/5', kind: 'nav' }, now);
  assertEquals(recents[0].label, 'L5 again');
  assertEquals(recents.filter((entry) => entry.key === 'k5').length, 1);
  assertEquals(recents[0].usedAt, now.toISOString());
});

Deno.test('addRecent ignores unsafe hrefs and strips control characters from labels', () => {
  assertEquals(addRecent([], { key: 'k', label: 'L', href: '//evil.example', kind: 'nav' }), []);
  const [entry] = addRecent([], { key: 'k', label: 'Bad\nName', href: '/ok', kind: 'nav' });
  assertEquals(entry.label, 'Bad Name');
});

Deno.test('addRecent only records entries the shared PUT validator accepts', () => {
  const existing = addRecent([], { key: 'k0', label: 'Kept', href: '/kept', kind: 'nav' });
  // Control characters in key or kind would make the server reject the whole list.
  assertEquals(addRecent(existing, { key: 'bad\u0000key', label: 'L', href: '/ok', kind: 'nav' }), existing);
  assertEquals(addRecent(existing, { key: 'k1', label: 'L', href: '/ok', kind: 'n\u0085v' }), existing);
  assertEquals(addRecent(existing, { key: '', label: 'L', href: '/ok', kind: 'nav' }), existing);
  // An empty label falls back to the href, truncated to the label limit.
  const longHref = `/${'p'.repeat(COMMAND_PALETTE_RECENT_LIMITS.label + 50)}`;
  const [fallback] = addRecent([], { key: 'k2', label: ' \n ', href: longHref, kind: 'nav' });
  assertEquals(fallback.label, longHref.slice(0, COMMAND_PALETTE_RECENT_LIMITS.label));
  assertEquals(validateCommandPaletteRecents([fallback]).ok, true);
});

Deno.test('recentKindLabel and isEditableTarget', () => {
  assertEquals(recentKindLabel('custom_format'), 'Custom format');
  assertEquals(recentKindLabel('toString'), null);
  assertEquals(isEditableTarget({ tagName: 'input' } as unknown as EventTarget), true);
  assertEquals(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assertEquals(isEditableTarget({ tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget), false);
  assertEquals(isEditableTarget(null), false);
});

const RECENT: CommandPaletteRecent = {
  key: 'nav:/databases',
  label: 'Databases',
  href: '/databases',
  kind: 'nav',
  usedAt: '2026-01-01T00:00:00.000Z',
};

type FetchCall = { url: string; init: RequestInit | undefined };

/** Fake fetch: answers each call from `respond`, recording method/url/body. */
function fakeFetch(respond: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return Promise.resolve(respond(call));
  }) as typeof fetch;
  return { fetchFn, calls, puts: () => calls.filter((call) => call.init?.method === 'PUT') };
}

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Manual timers so scheduling (debounce, backoff) is deterministic. */
function manualTimers() {
  let next = 1;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  return {
    setTimer: (callback: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { callback, ms });
      return id as unknown as TimerHandle;
    },
    clearTimer: (handle: TimerHandle) => void pending.delete(handle as unknown as number),
    delays: () => [...pending.values()].map((timer) => timer.ms),
    /** Runs every pending timer once (timers they schedule stay pending). */
    async runAll() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, timer] of due) timer.callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

function putBody(call: FetchCall): CommandPaletteRecent[] {
  return (JSON.parse(String(call.init?.body)) as { recents: CommandPaletteRecent[] }).recents;
}

Deno.test('loadRecents distinguishes loaded, expired session and unavailable API', async () => {
  const ok = fakeFetch(() => json(200, { recents: [RECENT, { bogus: true }], updatedAt: 'tok-1' }));
  assertEquals(await loadRecents('api', ok.fetchFn), { status: 'loaded', recents: [RECENT], updatedAt: 'tok-1' });
  assertEquals(ok.calls[0].url, COMMAND_PALETTE_RECENTS_ENDPOINT);

  assertEquals(await loadRecents('api', fakeFetch(() => json(401)).fetchFn), { status: 'unauthorized' });
  assertEquals(await loadRecents('api', fakeFetch(() => json(503)).fetchFn), { status: 'unavailable' });
  const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
  assertEquals(await loadRecents('api', offline), { status: 'unavailable' });
});

Deno.test('saveRecents classifies 401, 409, 429, 5xx, 400 and network errors', async () => {
  const cases: Array<[Response | Error, string]> = [
    [json(200, { recents: [], updatedAt: 'tok' }), 'saved'],
    [json(401), 'unauthorized'],
    [json(409), 'conflict'],
    [json(429), 'retry'],
    [json(502), 'retry'],
    [json(400), 'rejected'],
    [new TypeError('Failed to fetch'), 'retry'],
  ];
  for (const [answer, expected] of cases) {
    const fetchFn = (() =>
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)) as typeof fetch;
    assertEquals((await saveRecents([RECENT], 'api', fetchFn)).status, expected);
  }
  const saved = fakeFetch(() => json(200, { recents: [RECENT], updatedAt: 'tok-2' }));
  assertEquals(await saveRecents([RECENT], 'api', saved.fetchFn, { expectedUpdatedAt: 'tok-1' }), {
    status: 'saved',
    updatedAt: 'tok-2',
  });
  assertEquals(JSON.parse(String(saved.calls[0].init?.body)).expectedUpdatedAt, 'tok-1');
  const keepalive = fakeFetch(() => json(200));
  await saveRecents([RECENT], 'api', keepalive.fetchFn, { keepalive: true });
  assertEquals(keepalive.calls[0].init?.keepalive, true);
  assertEquals(putBody(keepalive.calls[0]), [RECENT]);
  assertEquals('expectedUpdatedAt' in JSON.parse(String(keepalive.calls[0].init?.body)), false);
});

Deno.test('recents sync: activation while loading is merged and saved once after load', async () => {
  let resolveGet: (response: Response) => void = () => {};
  const api = fakeFetch((call) =>
    call.init?.method === 'PUT' ? json(200) : new Promise<Response>((resolve) => (resolveGet = resolve))
  );
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });

  const loading = sync.ensureLoaded();
  assertEquals(sync.state, 'loading');
  sync.record({ key: 'nav:/settings', label: 'Settings', href: '/settings', kind: 'nav' });
  await timers.runAll();
  assertEquals(api.puts().length, 0, 'no write before the stored list is read');

  resolveGet(json(200, { recents: [RECENT] }));
  await loading;
  assertEquals(sync.state, 'loaded');
  await timers.runAll();

  assertEquals(api.puts().length, 1);
  assertEquals(
    putBody(api.puts()[0]).map((recent) => recent.key),
    ['nav:/settings', 'nav:/databases']
  );
});

Deno.test('recents sync: unavailable API skips writes and retries the load on next open', async () => {
  let getStatus = 503;
  const api = fakeFetch((call) => (call.init?.method === 'PUT' ? json(200) : json(getStatus, { recents: [RECENT] })));
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });

  await sync.ensureLoaded();
  assertEquals(sync.state, 'failed');
  sync.record({ key: 'nav:/settings', label: 'Settings', href: '/settings', kind: 'nav' });
  await timers.runAll();
  assertEquals(api.puts().length, 0);

  getStatus = 200;
  await sync.ensureLoaded();
  await timers.runAll();
  assertEquals(
    putBody(api.puts()[0]).map((recent) => recent.key),
    ['nav:/settings', 'nav:/databases']
  );
});

Deno.test('recents sync: expired session (401) drops writes', async () => {
  const api = fakeFetch(() => json(401));
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });
  await sync.ensureLoaded();
  sync.record({ key: 'nav:/settings', label: 'Settings', href: '/settings', kind: 'nav' });
  await timers.runAll();
  sync.flushOnDestroy();
  await flushMicrotasks();
  assertEquals(api.puts().length, 0);
});

Deno.test('recents sync: 429/5xx saves retry with backoff, bounded attempts', async () => {
  const api = fakeFetch((call) => (call.init?.method === 'PUT' ? json(429) : json(200, { recents: [] })));
  const timers = manualTimers();
  const sync = createRecentsSync({
    backend: 'api',
    onChange: () => {},
    fetchFn: api.fetchFn,
    saveDelayMs: 10,
    retryBaseMs: 100,
    maxSaveAttempts: 3,
    ...timers,
  });
  await sync.ensureLoaded();
  sync.record({ key: 'nav:/settings', label: 'Settings', href: '/settings', kind: 'nav' });
  assertEquals(timers.delays(), [10]);
  await timers.runAll();
  assertEquals(timers.delays(), [100]);
  await timers.runAll();
  assertEquals(timers.delays(), [200]);
  await timers.runAll();
  assertEquals(api.puts().length, 3);
  assertEquals(timers.delays(), [], 'gives up after maxSaveAttempts');
});

Deno.test('recents sync: teardown flushes a pending save with keepalive', async () => {
  const api = fakeFetch((call) => (call.init?.method === 'PUT' ? json(200) : json(200, { recents: [] })));
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });
  await sync.ensureLoaded();
  sync.record({ key: 'nav:/settings', label: 'Settings', href: '/settings', kind: 'nav' });
  sync.flushOnDestroy();
  await flushMicrotasks();
  assertEquals(api.puts().length, 1);
  assertEquals(api.puts()[0].init?.keepalive, true);
  assertEquals(timers.delays(), []);
});

/** Deferred response so a test can hold a request in flight. */
function deferred() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

const SETTINGS = { key: 'nav:/settings', label: 'Settings', href: '/settings', kind: 'nav' };
const ARR = { key: 'nav:/arr', label: 'Arr', href: '/arr', kind: 'nav' };

/** In-memory recents API with an `updatedAt` token, enforcing `expectedUpdatedAt` like the route. */
function fakeRecentsServer(initial: CommandPaletteRecent[] = [], token: string | null = null) {
  const store = { recents: initial, updatedAt: token, version: 0 };
  const api = fakeFetch((call) => {
    if (call.init?.method !== 'PUT') return json(200, { recents: store.recents, updatedAt: store.updatedAt });
    const body = JSON.parse(String(call.init.body)) as {
      recents: CommandPaletteRecent[];
      expectedUpdatedAt?: string | null;
    };
    if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== store.updatedAt) {
      return json(409, { error: 'Concurrency conflict: expected_updated_at does not match' });
    }
    store.recents = body.recents;
    store.updatedAt = `tok-${++store.version}`;
    return json(200, { recents: store.recents, updatedAt: store.updatedAt });
  });
  return { store, ...api };
}

Deno.test('recents sync: sends the loaded token and the token from each save', async () => {
  const server = fakeRecentsServer([RECENT], 'tok-0');
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: server.fetchFn, ...timers });
  await sync.ensureLoaded();

  sync.record(SETTINGS);
  await timers.runAll();
  sync.record(ARR);
  await timers.runAll();

  const tokens = server.puts().map((call) => JSON.parse(String(call.init?.body)).expectedUpdatedAt);
  assertEquals(tokens, ['tok-0', 'tok-1']);
  assertEquals(
    server.store.recents.map((recent) => recent.key),
    ['nav:/arr', 'nav:/settings', 'nav:/databases']
  );
});

Deno.test("recents sync: 409 re-reads, merges only this page's activations, and saves once", async () => {
  const server = fakeRecentsServer([RECENT], 'tok-0');
  const timers = manualTimers();
  let shown: CommandPaletteRecent[] = [];
  const sync = createRecentsSync({
    backend: 'api',
    onChange: (next) => (shown = next),
    fetchFn: server.fetchFn,
    ...timers,
  });
  await sync.ensureLoaded();
  sync.record(SETTINGS);

  // Another tab writes before this page's debounced save fires.
  const otherTab = { ...RECENT, key: 'nav:/other', label: 'Other', href: '/other' };
  server.store.recents = [otherTab, RECENT];
  server.store.updatedAt = 'tok-other';

  await timers.runAll(); // PUT -> 409 -> state idle, re-read starts
  assertEquals(server.puts().length, 1);
  await flushMicrotasks(); // re-read settles, merge schedules one save
  assertEquals(sync.state, 'loaded');
  await timers.runAll();

  const puts = server.puts();
  assertEquals(puts.length, 2, 'one resave after the conflict');
  assertEquals(JSON.parse(String(puts[1].init?.body)).expectedUpdatedAt, 'tok-other');
  assertEquals(
    server.store.recents.map((recent) => recent.key),
    ['nav:/settings', 'nav:/other', 'nav:/databases']
  );
  assertEquals(shown, server.store.recents);
  assertEquals(timers.delays(), []);
});

Deno.test('recents sync: repeated 409s stop after a bounded number of rounds', async () => {
  const api = fakeFetch((call) =>
    call.init?.method === 'PUT' ? json(409) : json(200, { recents: [], updatedAt: 'tok' })
  );
  const timers = manualTimers();
  const sync = createRecentsSync({
    backend: 'api',
    onChange: () => {},
    fetchFn: api.fetchFn,
    maxConflictRetries: 2,
    ...timers,
  });
  await sync.ensureLoaded();
  sync.record(SETTINGS);
  for (let round = 0; round < 5; round++) {
    await timers.runAll();
    await flushMicrotasks();
  }
  assertEquals(api.puts().length, 3, 'initial save plus two conflict retries');
  assertEquals(timers.delays(), []);
});

Deno.test('recents sync: activation during an in-flight save is saved after it', async () => {
  const pending = deferred();
  let putCount = 0;
  const api = fakeFetch((call) => {
    if (call.init?.method !== 'PUT') return json(200, { recents: [], updatedAt: null });
    putCount += 1;
    return putCount === 1 ? pending.promise : json(200, { recents: [], updatedAt: 'tok-2' });
  });
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });
  await sync.ensureLoaded();
  sync.record(SETTINGS);
  await timers.runAll(); // first PUT in flight

  sync.record(ARR);
  await timers.runAll(); // flush skipped while saving
  assertEquals(api.puts().length, 1);

  pending.resolve(json(200, { recents: [], updatedAt: 'tok-1' }));
  await flushMicrotasks();
  await timers.runAll();

  const puts = api.puts();
  assertEquals(puts.length, 2);
  assertEquals(
    putBody(puts[1]).map((recent) => recent.key),
    ['nav:/arr', 'nav:/settings']
  );
  assertEquals(JSON.parse(String(puts[1].init?.body)).expectedUpdatedAt, 'tok-1');
});

Deno.test('recents sync: a rejected save is dropped but a later change still saves', async () => {
  let putStatus = 400;
  const api = fakeFetch((call) =>
    call.init?.method === 'PUT' ? json(putStatus, { recents: [], updatedAt: 'tok-1' }) : json(200, { recents: [] })
  );
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });
  await sync.ensureLoaded();
  sync.record(SETTINGS);
  await timers.runAll();
  assertEquals(api.puts().length, 1);
  assertEquals(timers.delays(), [], 'a rejected list is not retried');

  putStatus = 200;
  sync.record(ARR);
  await timers.runAll();
  assertEquals(api.puts().length, 2);
});

Deno.test('recents sync: after giving up, the next open resumes the pending save', async () => {
  let putStatus = 503;
  const api = fakeFetch((call) =>
    call.init?.method === 'PUT' ? json(putStatus, { recents: [], updatedAt: 'tok' }) : json(200, { recents: [] })
  );
  const timers = manualTimers();
  const sync = createRecentsSync({
    backend: 'api',
    onChange: () => {},
    fetchFn: api.fetchFn,
    maxSaveAttempts: 2,
    ...timers,
  });
  await sync.ensureLoaded();
  sync.record(SETTINGS);
  await timers.runAll();
  await timers.runAll();
  assertEquals(api.puts().length, 2);
  assertEquals(timers.delays(), [], 'gave up');

  putStatus = 200;
  await sync.ensureLoaded(); // palette opened again
  assertEquals(timers.delays().length, 1);
  await timers.runAll();
  assertEquals(api.puts().length, 3);
  assertEquals(putBody(api.puts()[2])[0].key, 'nav:/settings');
});

Deno.test('recents sync: flushOnDestroy during an in-flight save flushes after it, in order', async () => {
  const pending = deferred();
  let putCount = 0;
  const api = fakeFetch((call) => {
    if (call.init?.method !== 'PUT') return json(200, { recents: [], updatedAt: null });
    putCount += 1;
    return putCount === 1 ? pending.promise : json(200, { recents: [], updatedAt: 'tok-2' });
  });
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });
  await sync.ensureLoaded();
  sync.record(SETTINGS);
  await timers.runAll(); // first PUT in flight
  sync.record(ARR);

  sync.flushOnDestroy();
  await flushMicrotasks();
  assertEquals(api.puts().length, 1, 'no concurrent write while a save is in flight');

  pending.resolve(json(200, { recents: [], updatedAt: 'tok-1' }));
  await flushMicrotasks();
  const puts = api.puts();
  assertEquals(puts.length, 2);
  assertEquals(puts[1].init?.keepalive, true);
  assertEquals(JSON.parse(String(puts[1].init?.body)).expectedUpdatedAt, 'tok-1');
  assertEquals(
    putBody(puts[1]).map((recent) => recent.key),
    ['nav:/arr', 'nav:/settings']
  );
  assertEquals(timers.delays(), []);
});

Deno.test('recents sync: flushOnDestroy during an in-flight save with nothing new sends nothing more', async () => {
  const pending = deferred();
  const api = fakeFetch((call) => (call.init?.method === 'PUT' ? pending.promise : json(200, { recents: [] })));
  const timers = manualTimers();
  const sync = createRecentsSync({ backend: 'api', onChange: () => {}, fetchFn: api.fetchFn, ...timers });
  await sync.ensureLoaded();
  sync.record(SETTINGS);
  await timers.runAll();
  sync.flushOnDestroy();
  pending.resolve(json(200, { recents: [], updatedAt: 'tok-1' }));
  await flushMicrotasks();
  assertEquals(api.puts().length, 1);
  assertEquals(timers.delays(), []);
});

Deno.test('href checks: navigation has no length cap, stored recents do', () => {
  const longHref = `/delay-profiles/1/${'x'.repeat(COMMAND_PALETTE_RECENT_LIMITS.href)}`;
  assertEquals(isSafeRelativeHref(longHref), true);
  assertEquals(isStorableRecentHref(longHref), false);
  assertEquals(addRecent([], { key: 'k', label: 'L', href: longHref, kind: 'delay_profile' }), []);
  assertEquals(
    parseSearchResults({
      results: [{ type: 'delay_profile', id: 'd', name: 'D', href: longHref, source: null }],
    }).length,
    1
  );
});

Deno.test('recent actions re-resolve their context-aware href', () => {
  const recents: CommandPaletteRecent[] = [
    { ...RECENT, key: 'action:new-custom-format', label: 'New custom format', href: '/custom-formats', kind: 'action' },
  ];
  const [group] = buildPaletteGroups({
    query: '',
    recents,
    navItems: [],
    results: [],
    pathname: '/custom-formats/7/3',
  });
  assertEquals(group.items[0].href, '/custom-formats/7/new');
});

Deno.test('currentResults only shows entity results for the current query', () => {
  const results = [result('database', 'database:1', 'Main', '/databases/1')];
  assertEquals(currentResults(results, 'main', '  main '), results);
  assertEquals(currentResults(results, 'mai', 'main'), []);
  assertEquals(currentResults(results, null, 'main'), []);
  assertEquals(currentResults(results, '', ''), []);
});

Deno.test('createOptionIdMap gives each key a stable, valid id', () => {
  const idFor = createOptionIdMap('palette');
  const first = idFor('pcd:3:custom_format:12');
  idFor('nav:/settings');
  assertEquals(idFor('pcd:3:custom_format:12'), first);
  assertEquals(/^[A-Za-z][\w-]*$/.test(first), true);
  assertEquals(idFor('nav:/settings') !== first, true);
});

Deno.test('isPaletteShortcut: Cmd+K on Apple, Ctrl+K elsewhere, no Shift/Alt', () => {
  const key = (overrides: Partial<KeyboardEvent>) =>
    ({
      key: 'k',
      code: 'KeyK',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    }) as KeyboardEvent;
  assertEquals(isPaletteShortcut(key({ ctrlKey: true }), false), true);
  assertEquals(isPaletteShortcut(key({ metaKey: true }), false), false);
  assertEquals(isPaletteShortcut(key({ metaKey: true }), true), true);
  assertEquals(isPaletteShortcut(key({ ctrlKey: true }), true), false);
  assertEquals(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }), false), false);
  assertEquals(isPaletteShortcut(key({ ctrlKey: true, altKey: true }), false), false);
  // Non-Latin layouts still report the physical key via `code`.
  assertEquals(isPaletteShortcut(key({ ctrlKey: true, key: 'л' }), false), true);
  assertEquals(isPaletteShortcut(key({ ctrlKey: true, key: 'K', code: '' }), false), true);
  assertEquals(isPaletteShortcut(key({ ctrlKey: true, key: 'j', code: 'KeyJ' }), false), false);
  // A remapped Latin layout (Dvorak types `e` on the physical K key) is not the shortcut.
  assertEquals(isPaletteShortcut(key({ ctrlKey: true, key: 'e', code: 'KeyK' }), false), false);
  // Typed `k` on another physical key (Dvorak) is.
  assertEquals(isPaletteShortcut(key({ ctrlKey: true, key: 'k', code: 'KeyV' }), false), true);
  assertEquals(isPaletteShortcut(key({ metaKey: true, key: 'л', code: 'KeyK' }), true), true);
  assertEquals(isApplePlatform('MacIntel'), true);
  assertEquals(isApplePlatform('Win32'), false);
});
