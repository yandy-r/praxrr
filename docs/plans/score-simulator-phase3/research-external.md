# External API Research: score-simulator-phase3

## Executive Summary

Phase 3 requires no new external libraries. SvelteKit's built-in `goto()` with `replaceState`,
`$page.url.searchParams`, and `pushState`/`replaceState` from `$app/navigation` cover all URL state
management needs. Deno's `@std/testing` (spy, stub, mock) plus Playwright handle unit and e2e
testing respectively. For what-if scoring, an in-memory overlay pattern using a
`Map<cfName, overriddenScore>` merged at computation time avoids PCD writes entirely, with URL
serialization via native `URLSearchParams` keeping state shareable.

## Primary APIs

### URL State Management in SvelteKit

- **Documentation**: https://svelte.dev/docs/kit/$app-navigation
- **Shallow Routing**: https://svelte.dev/docs/kit/shallow-routing
- **State Management Guide**: https://svelte.dev/docs/kit/state-management

**Confidence**: High (official SvelteKit documentation, multiple community confirmations)

#### `goto()` Function

Primary navigation function for programmatic URL updates:

```typescript
import { goto } from '$app/navigation';

function goto(
  url: string | URL,
  opts?: {
    replaceState?: boolean;
    noScroll?: boolean;
    keepFocus?: boolean;
    invalidateAll?: boolean;
    state?: App.PageState;
  }
): Promise<void>;
```

Key options for Phase 3:

- **`replaceState: true`** -- Updates URL without adding history entries. Use for frequent state
  changes (score overrides, filter adjustments).
- **`keepFocus: true`** -- Maintains focus on active element during navigation. Essential when
  updating URL from input fields.
- **`invalidateAll: true`** -- Re-runs all load functions. Use when the server needs to re-fetch
  data based on new URL params.
- **`state`** -- Attaches custom page state to history entry. Available via `page.state` on client
  only.

#### `pushState()` / `replaceState()`

For shallow routing (URL changes without full navigation):

```typescript
import { pushState, replaceState } from '$app/navigation';

// Add new history entry without navigation
pushState('/score-simulator/1?profile=HD', { showModal: true });

// Update current entry silently
replaceState('/score-simulator/1?profile=HD&arrType=radarr', {});
```

**Critical caveat**: `page.state` is always an empty object during SSR. URL search params work on
both server and client.

#### Reading URL Params

In `+page.server.ts` load functions:

```typescript
export const load: ServerLoad = async ({ url }) => {
  const profile = url.searchParams.get('profile');
  const arrType = url.searchParams.get('arrType');
  // ...
};
```

In components (Svelte 5, no runes -- matching project conventions):

```svelte
<script>
  import { page } from '$app/stores';
  $: profile = $page.url.searchParams.get('profile');
  $: arrType = $page.url.searchParams.get('arrType');
</script>
```

#### Constraints

- **`$page` store reactivity**: `$page.url.searchParams` is reactive for reads but cannot be written
  to directly. Must use `goto()` or `replaceState()` to trigger updates.
- **History API conflict**: Do NOT use native `history.pushState`/`replaceState` -- these conflict
  with SvelteKit's router. Always use imports from `$app/navigation`.
- **SSR**: `page.state` is empty during SSR; rely on `url.searchParams` for server-accessible state.

**Confidence**: High (official docs, verified behavior)

### Deno Testing Framework

- **Documentation**: https://docs.deno.com/runtime/fundamentals/testing/
- **Mocking Tutorial**: https://docs.deno.com/examples/mocking_tutorial/
- **Mock Module (JSR)**: https://jsr.io/@std/testing/doc/mock

**Confidence**: High (official Deno documentation)

#### Test Definition

```typescript
import { assertEquals, assertNotEquals } from '@std/assert';

Deno.test('test name', () => {
  assertEquals(1 + 2, 3);
});

// With steps for organization
Deno.test('score override computation', async (t) => {
  await t.step('applies single override', () => {
    /* ... */
  });
  await t.step('applies multiple overrides', () => {
    /* ... */
  });
});
```

#### Mocking and Stubbing

```typescript
import { spy, stub, assertSpyCalls } from 'jsr:@std/testing/mock';

// Spy -- track calls without changing behavior
Deno.test('spy example', () => {
  const calculator = { add: (a: number, b: number) => a + b };
  using addSpy = spy(calculator, 'add');

  calculator.add(3, 4);
  assertSpyCalls(addSpy, 1);
  assertEquals(addSpy.calls[0].args, [3, 4]);
});

// Stub -- replace implementation
Deno.test('stub example', () => {
  using envStub = stub(Deno.env, 'get', (key: string) => {
    if (key === 'AUTH') return 'off';
    return undefined;
  });

  assertEquals(Deno.env.get('AUTH'), 'off');
});
// envStub automatically restored when `using` block exits
```

The `using` keyword (TypeScript 5.2+ disposable pattern) is the recommended approach for automatic
cleanup, matching the project's existing test patterns.

#### BDD Style

```typescript
import { describe, it } from '@std/testing/bdd';

describe('URL state serialization', () => {
  it('encodes score overrides', () => {
    /* ... */
  });
  it('decodes score overrides', () => {
    /* ... */
  });
});
```

#### Test Hooks

```typescript
import { beforeEach, afterEach } from '@std/testing/bdd';

beforeEach(() => {
  /* setup */
});
afterEach(() => {
  /* teardown */
});
```

#### Existing Project Pattern

The project uses `Deno.test()` with `@std/assert` (see `scoreSimulatorHelpers.test.ts` and
`scoreSimulatorPhase2Helpers.test.ts`). Follow this convention -- flat `Deno.test()` calls with
descriptive names, `assertEquals`/`assertNotEquals` assertions.

### Playwright for SvelteKit E2E

- **Documentation**: https://playwright.dev/docs/intro
- **SvelteKit Guide**: https://www.okupter.com/blog/e2e-testing-with-sveltekit-and-playwright

**Confidence**: High (official Playwright docs, established project configuration)

#### Existing Project Configuration

```typescript
// playwright.config.ts (already exists)
export default defineConfig({
  testDir: './packages/praxrr-app/src/tests/e2e/specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // Sequential execution for DB state isolation
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:6969',
    headless: process.env.HEADED !== '1',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
```

Key observations:

- `workers: 1` -- sequential execution, prevents state conflicts
- `fullyParallel: false` -- tests run in order within files
- Base URL matches dev server port (6969)

#### Test Pattern for Score Simulator E2E

```typescript
import { test, expect } from '@playwright/test';

test('score simulator deep-link from quality profile', async ({ page }) => {
  // Navigate to quality profile scoring page
  await page.goto('/quality-profiles/1/some-profile-id/scoring');

  // Click "Simulate" button
  await page.getByRole('button', { name: 'Simulate' }).click();

  // Verify navigation to score simulator with pre-filled params
  await expect(page).toHaveURL(/\/score-simulator\/1\?profile=/);

  // Verify profile is pre-selected
  const profileSelect = page.getByRole('combobox', { name: /profile/i });
  await expect(profileSelect).toHaveValue(/expected-profile/);
});

test('URL state is shareable', async ({ page }) => {
  // Navigate directly with URL params
  await page.goto('/score-simulator/1?arrType=radarr&profile=pcd:HD&titles=Movie.2024.1080p');

  // Verify state is restored from URL
  await expect(page.getByText('radarr')).toBeVisible();
});
```

## Libraries and SDKs

### Recommended: No External Libraries Needed

**Confidence**: High

For this project's requirements, native browser/SvelteKit APIs are sufficient and preferred:

| Need                 | Solution                                 | Why Not a Library                                                                                                        |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| URL param read/write | `$page.url.searchParams` + `goto()`      | Project uses Svelte 5 without runes; `sveltekit-search-params` relies on deprecated `$page` store and is not runes-ready |
| URL encoding         | Native `URLSearchParams`                 | Built-in, handles encoding automatically                                                                                 |
| Deep linking         | `goto('/score-simulator/{dbId}?params')` | Standard SvelteKit navigation                                                                                            |
| State compression    | Not needed (see analysis below)          | State fits well within URL limits                                                                                        |
| Test mocking         | `@std/testing/mock` (Deno stdlib)        | Already used in project                                                                                                  |
| E2E testing          | Playwright                               | Already configured in project                                                                                            |

### Evaluated and Rejected Libraries

#### sveltekit-search-params

- **URL**: https://github.com/paoloricciuti/sveltekit-search-params
- **Status**: Not recommended
- **Reason**: Not yet updated for Svelte 5 runes; relies on deprecated `$page` store. The project
  convention is Svelte 5 without runes, so using `$page` from `$app/stores` is still valid, but
  adding a dependency for functionality achievable with `goto()` + `replaceState` is unnecessary
  overhead.

**Confidence**: Medium (library works but adds unnecessary dependency)

#### kit-query-params

- **URL**: https://github.com/beynar/kit-query-params
- **Status**: Not recommended
- **Reason**: Svelte 5 runes-based library. Project explicitly uses Svelte 5 without runes.

**Confidence**: Medium

#### pako (zlib compression)

- **URL**: https://www.npmjs.com/package/pako
- **Status**: Not needed for Phase 3
- **Analysis**: Pako achieves ~40-50% compression on JSON state. However, the score simulator state
  is small enough to fit in URL without compression (see Constraints section). Could be reconsidered
  if full Config Impact Simulator (#30) Phase 4 requires encoding complex sandbox state.

**Confidence**: High (verified compression ratios, but not needed for current scope)

## Integration Patterns

### Deep-Linking Between Routes

**Confidence**: High

The "Simulate" button on `/quality-profiles/[databaseId]/[id]/scoring` should navigate to the score
simulator with pre-filled context.

#### Implementation Pattern

```svelte
<!-- In quality profile scoring page component -->
<script>
  import { goto } from '$app/navigation';

  export let data;

  function openSimulator() {
    const params = new URLSearchParams();
    params.set('profile', `pcd:${encodeURIComponent(data.profileName)}`);
    params.set('arrType', data.arrType);

    goto(`/score-simulator/${data.databaseId}?${params.toString()}`);
  }
</script>

<button onclick={openSimulator}>Simulate</button>
```

#### Receiving Deep-Link State

In the score simulator's `+page.server.ts`, read URL params in the load function:

```typescript
export const load: ServerLoad = async ({ params, url }) => {
  const { databaseId } = params;
  const preselectedProfile = url.searchParams.get('profile');
  const preselectedArrType = url.searchParams.get('arrType');
  const titlesParam = url.searchParams.get('titles');

  // ... existing database/profile loading ...

  return {
    databases,
    currentDatabase,
    qualityProfiles,
    parserAvailable,
    // Pass pre-selected values to client
    preselectedProfile,
    preselectedArrType,
    preselectedTitles: titlesParam ? titlesParam.split(',') : [],
  };
};
```

### URL State Synchronization

**Confidence**: High

Bidirectional sync between component state and URL params requires careful handling to avoid
infinite loops and unnecessary navigations.

#### Recommended Pattern: Debounced `goto()` with `replaceState`

```svelte
<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  export let data;

  // Initialize from URL params (deep-link support)
  let selectedProfile = data.preselectedProfile || '';
  let arrType = data.preselectedArrType || 'radarr';
  let titles = data.preselectedTitles || [];
  let scoreOverrides = {};

  // Debounce timer for URL updates
  let urlUpdateTimer;

  function syncToUrl() {
    clearTimeout(urlUpdateTimer);
    urlUpdateTimer = setTimeout(() => {
      const params = new URLSearchParams();

      if (selectedProfile) params.set('profile', selectedProfile);
      if (arrType !== 'radarr') params.set('arrType', arrType);
      if (titles.length > 0) params.set('titles', titles.join(','));

      // Encode score overrides as compact format: cfName:score,cfName:score
      const overrideEntries = Object.entries(scoreOverrides);
      if (overrideEntries.length > 0) {
        params.set('overrides', overrideEntries.map(([k, v]) => `${k}:${v}`).join(','));
      }

      const query = params.toString();
      const newUrl = query
        ? `/score-simulator/${data.currentDatabase.id}?${query}`
        : `/score-simulator/${data.currentDatabase.id}`;

      goto(newUrl, { replaceState: true, keepFocus: true, noScroll: true });
    }, 300); // 300ms debounce
  }

  function onProfileChange(event) {
    selectedProfile = event.target.value;
    syncToUrl();
  }
</script>
```

#### Key Design Decisions

1. **`replaceState: true`** for all URL updates from user interactions (avoids polluting browser
   history with every keystroke/toggle).
2. **`pushState` only for discrete navigation events** -- e.g., clicking "Simulate" from another
   page.
3. **Debounce at 300ms** -- Prevents excessive URL updates during rapid input changes.
4. **Omit default values** -- Keep URLs clean by not encoding default state (`arrType=radarr` is the
   default, so omit it).
5. **Read from `data` prop on mount** -- Server load function parses URL params and passes them as
   data, ensuring SSR compatibility.

### What-If / Sandbox State Pattern

**Confidence**: High

The what-if scoring feature requires temporary score overrides that affect computation without
writing to `pcd_ops`. This is a pure client-side overlay pattern.

#### Architecture: Override Map Approach

```
[PCD Base Scores] ---> [Override Map] ---> [Merged Scores] ---> [API Request]
                        (client-side)
```

The override map is a `Map<string, number>` or plain object `{ [cfName: string]: number }` that the
client maintains. When submitting to the API, the client merges overrides with base scores before
(or during) the request.

#### Two Implementation Strategies

**Strategy A: Client-Side Score Merging (Recommended for Phase 3)**

The client modifies the score values before sending to the existing `/api/v1/simulate/score`
endpoint. No server changes needed.

```typescript
type ScoreOverrides = Record<string, number>;

function applyOverrides(
  baseScores: Array<{ cfName: string; score: number }>,
  overrides: ScoreOverrides
): Array<{ cfName: string; score: number }> {
  return baseScores.map((item) => ({
    cfName: item.cfName,
    score: overrides[item.cfName] ?? item.score,
  }));
}
```

The existing API already accepts `profileNames` and computes scores from the PCD cache. For what-if,
the client would:

1. Fetch the profile's CF scores (already available from the scoring page data)
2. Let the user modify individual CF scores in the UI
3. Recompute totals client-side using the override map
4. Optionally re-submit to the API with a modified request that includes override information

**Strategy B: Server-Side Override Parameter (Phase 4 / Config Impact Simulator)**

Extend the `SimulateScoreRequest` schema with an optional `scoreOverrides` field:

```typescript
type SimulateScoreRequest = {
  databaseId: number;
  releases: SimulateReleaseInput[];
  profileNames: string[];
  arrType: 'radarr' | 'sonarr';
  scoreOverrides?: Record<string, number>; // Phase 3 addition
};
```

The server applies overrides during score computation, overriding the PCD cache values. This
approach is more accurate because it uses the server's CF matching engine, but requires API changes.

#### Recommendation

**Start with Strategy A for Phase 3** -- it requires zero API changes, works entirely client-side,
and provides immediate feedback. The existing helpers (`buildRankingFromResults`,
`buildComparisonResult`) already work with score arrays and can accept overridden values.

**Bridge to Strategy B** when integrating with Config Impact Simulator (#30), which needs
server-side sandbox compilation anyway.

#### URL Serialization of Overrides

Encode overrides compactly in URL params:

```
?overrides=DV:100,HDR10Plus:-50,Atmos:75
```

Parse function:

```typescript
function parseOverridesFromUrl(param: string | null): Record<string, number> {
  if (!param) return {};
  const overrides: Record<string, number> = {};
  for (const entry of param.split(',')) {
    const colonIndex = entry.lastIndexOf(':');
    if (colonIndex <= 0) continue;
    const name = decodeURIComponent(entry.slice(0, colonIndex));
    const score = Number.parseInt(entry.slice(colonIndex + 1), 10);
    if (Number.isFinite(score)) {
      overrides[name] = score;
    }
  }
  return overrides;
}

function serializeOverridesToUrl(overrides: Record<string, number>): string {
  return Object.entries(overrides)
    .map(([name, score]) => `${encodeURIComponent(name)}:${score}`)
    .join(',');
}
```

### Testing Patterns

**Confidence**: High

#### Unit Tests (Deno)

Follow existing patterns from `scoreSimulatorHelpers.test.ts` and
`scoreSimulatorPhase2Helpers.test.ts`:

```typescript
// tests/routes/scoreSimulatorPhase3Helpers.test.ts
import { assertEquals } from '@std/assert';

// URL state serialization
Deno.test('parseOverridesFromUrl parses valid overrides', () => {
  const result = parseOverridesFromUrl('DV:100,HDR10Plus:-50');
  assertEquals(result, { DV: 100, HDR10Plus: -50 });
});

Deno.test('parseOverridesFromUrl returns empty for null', () => {
  assertEquals(parseOverridesFromUrl(null), {});
});

Deno.test('serializeOverridesToUrl produces compact format', () => {
  const result = serializeOverridesToUrl({ DV: 100, Atmos: 75 });
  assertEquals(result, 'DV:100,Atmos:75');
});

// Score override computation
Deno.test('applyOverrides replaces matching CF scores', () => {
  const base = [
    { cfName: 'DV', score: 50 },
    { cfName: 'HDR10', score: 30 },
  ];
  const overrides = { DV: 100 };
  const result = applyOverrides(base, overrides);
  assertEquals(result[0].score, 100);
  assertEquals(result[1].score, 30);
});
```

#### Integration Tests (Deno)

Test the API endpoint with score overrides (if Strategy B is adopted):

```typescript
Deno.test('POST /api/v1/simulate/score applies scoreOverrides', async () => {
  // Uses the existing test harness pattern for route testing
  const response = await fetch('http://localhost:6969/api/v1/simulate/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      databaseId: 1,
      releases: [{ id: 'r1', title: 'Movie.2024.DV.1080p', type: 'movie' }],
      profileNames: ['pcd:HD'],
      arrType: 'radarr',
      scoreOverrides: { DV: 200 },
    }),
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  // Verify the DV contribution uses the overridden score
});
```

#### E2E Tests (Playwright)

```typescript
// tests/e2e/specs/score-simulator-phase3.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Score Simulator Phase 3', () => {
  test('deep-link from scoring page pre-fills profile', async ({ page }) => {
    // Navigate to quality profile scoring page
    await page.goto('/quality-profiles/1/profile-id/scoring');
    await page.getByRole('button', { name: /simulate/i }).click();

    // Verify URL contains profile param
    await expect(page).toHaveURL(/profile=pcd%3A/);
  });

  test('URL state survives page reload', async ({ page }) => {
    const url = '/score-simulator/1?profile=pcd:HD&arrType=radarr';
    await page.goto(url);
    await page.reload();

    // Verify state is preserved
    await expect(page.locator('[data-testid="profile-select"]')).toHaveValue('pcd:HD');
  });

  test('what-if override updates ranking in real-time', async ({ page }) => {
    await page.goto('/score-simulator/1');
    // Select profile and enter title
    // ... setup steps ...

    // Modify a CF score
    await page.getByLabel('DV score').fill('200');

    // Verify ranking table updates
    await expect(page.getByTestId('ranking-table')).toContainText('200');
  });

  test('shareable URL reproduces exact state', async ({ page, context }) => {
    // Setup state in one tab
    await page.goto('/score-simulator/1');
    // ... configure simulator ...

    // Copy URL and open in new tab
    const url = page.url();
    const newPage = await context.newPage();
    await newPage.goto(url);

    // Verify identical state
    // ... assertions ...
  });
});
```

## Constraints and Gotchas

### URL Length Limits

**Confidence**: High

| Browser/Server      | Max URL Length      |
| ------------------- | ------------------- |
| Chrome              | ~32,000 characters  |
| Firefox             | ~300,000 characters |
| Safari              | ~64,000 characters  |
| Older browsers/CDNs | ~2,000 characters   |
| Nginx (default)     | ~8,000 characters   |
| Apache              | ~8,190 characters   |

**Estimated state sizes for score simulator:**

- Profile selector: ~40-80 chars (`profile=pcd:HD%20Bluray%20Web`)
- arrType: ~15 chars (`arrType=radarr`)
- Titles (50 max, avg 60 chars each): ~3,000 chars compressed to comma-separated
- Score overrides (20 CF overrides): ~400 chars (`overrides=DV:100,HDR10:50,...`)
- **Total estimate: ~3,500-4,000 characters** -- well within all browser limits.

**Mitigation for edge cases:**

- Cap URL-encoded titles at a reasonable limit (e.g., first 10 titles in URL, rest in
  `sessionStorage`)
- If total URL > 2,000 chars, use a hybrid approach: store full state in `sessionStorage` with a
  short key in the URL (`?state=abc123`)
- For Phase 3 scope, the simple approach is sufficient

### Browser History / Popstate

**Confidence**: High

- Use `goto()` with `replaceState: true` for all frequent updates (overrides, filters) to avoid
  polluting history.
- Use `goto()` without `replaceState` (default `pushState` behavior) only for discrete navigation
  events (clicking "Simulate" button, switching databases).
- The `popstate` event (browser back/forward) is handled automatically by SvelteKit's router when
  using `goto()` and the `$app/navigation` functions.
- **Never use** native `history.pushState`/`replaceState` -- it conflicts with SvelteKit's internal
  router state.

### Test Isolation

**Confidence**: High

- **Playwright**: Already configured with `workers: 1` and `fullyParallel: false`. Score simulator
  tests should not conflict with other e2e tests since they read PCD data but do not write (what-if
  is client-side only).
- **Deno unit tests**: Score computation helpers are pure functions with no side effects. No special
  isolation needed.
- **Integration tests**: If testing the API endpoint, ensure a test database is available. The
  project's existing test helpers (`tests/e2e/helpers/db.ts`, `tests/e2e/helpers/reset.ts`) provide
  patterns for state management.

### SvelteKit-Specific Testing Caveats with Deno

**Confidence**: Medium (limited direct documentation on this intersection)

- **Import aliases**: Deno tests must resolve SvelteKit path aliases (`$lib/`, `$api/`, etc.). The
  project's `deno.json` mirrors these aliases, so existing patterns work.
- **Server-only modules**: Test files importing server modules (e.g., `$pcd/`) need Deno permissions
  (`--allow-read`, `--allow-env`). The project's `deno task test` already configures these.
- **Svelte components cannot be unit-tested with Deno alone** -- they require a browser environment.
  Use Playwright for component-level verification.
- **`$app/stores` and `$app/navigation` are not available in Deno tests**. Helper functions that
  depend on these must be isolated from pure computation logic.

### Svelte 5 Without Runes Constraint

**Confidence**: High

The project convention specifies "Svelte 5, no runes." This means:

- Use `$: reactive` declarations instead of `$state`/`$derived`
- Use `$page` from `$app/stores` (store syntax) instead of `page` from `$app/state`
- Event handlers use `onclick` attribute syntax
- Libraries that require runes (e.g., `kit-query-params`, `runed`) are incompatible

## Code Examples

### URL State Sync in SvelteKit (Complete Pattern)

```svelte
<!-- score-simulator/[databaseId]/+page.svelte (relevant additions) -->
<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  export let data;

  // ---- Initialize from URL params (deep-link / shareable URL) ----
  let selectedProfile = data.preselectedProfile || '';
  let selectedArrType = data.preselectedArrType || 'radarr';
  let scoreOverrides = data.preselectedOverrides || {};

  // ---- URL sync with debounce ----
  let syncTimer;

  function buildUrlParams() {
    const params = new URLSearchParams();
    if (selectedProfile) params.set('profile', selectedProfile);
    if (selectedArrType && selectedArrType !== 'radarr') {
      params.set('arrType', selectedArrType);
    }
    // Encode overrides
    const entries = Object.entries(scoreOverrides);
    if (entries.length > 0) {
      params.set(
        'overrides',
        entries.map(([k, v]) => `${encodeURIComponent(k)}:${v}`).join(',')
      );
    }
    return params;
  }

  function syncUrlState() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const params = buildUrlParams();
      const query = params.toString();
      const base = `/score-simulator/${data.currentDatabase.id}`;
      const url = query ? `${base}?${query}` : base;
      goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    }, 300);
  }

  // ---- Score override handlers ----
  function setScoreOverride(cfName, newScore) {
    scoreOverrides = { ...scoreOverrides, [cfName]: newScore };
    syncUrlState();
    recomputeResults(); // trigger re-ranking with overrides
  }

  function clearScoreOverride(cfName) {
    const { [cfName]: _, ...rest } = scoreOverrides;
    scoreOverrides = rest;
    syncUrlState();
    recomputeResults();
  }

  function clearAllOverrides() {
    scoreOverrides = {};
    syncUrlState();
    recomputeResults();
  }
</script>
```

### Deep-Link "Simulate" Button

```svelte
<!-- In quality profile scoring page -->
<script>
  import { goto } from '$app/navigation';

  export let data;

  function openInSimulator() {
    const params = new URLSearchParams();
    params.set('profile', `pcd:${encodeURIComponent(data.profile.name)}`);
    if (data.arrType) params.set('arrType', data.arrType);

    goto(`/score-simulator/${data.databaseId}?${params.toString()}`);
  }
</script>

<button class="btn btn-secondary" onclick={openInSimulator}>
  Simulate
</button>
```

### What-If Score Override Pattern (Client-Side)

```typescript
// score-simulator/[databaseId]/helpers.ts (additions for Phase 3)

export type ScoreOverrides = Record<string, number>;

/**
 * Applies temporary score overrides to a set of contributions.
 * Returns a new array with overridden scores -- does not mutate input.
 */
export function applyScoreOverrides(
  contributions: ReadonlyArray<{ cfName: string; score: number }>,
  overrides: ScoreOverrides
): Array<{ cfName: string; score: number }> {
  if (Object.keys(overrides).length === 0) return [...contributions];

  return contributions.map((c) => ({
    cfName: c.cfName,
    score: c.cfName in overrides ? overrides[c.cfName] : c.score,
  }));
}

/**
 * Recomputes a total score with overrides applied.
 */
export function computeOverriddenTotal(
  contributions: ReadonlyArray<{ cfName: string; score: number }>,
  overrides: ScoreOverrides
): number {
  const applied = applyScoreOverrides(contributions, overrides);
  return applied.reduce((sum, c) => sum + c.score, 0);
}

/**
 * Parses score overrides from a URL search param value.
 * Format: "cfName:score,cfName:score"
 */
export function parseOverridesParam(value: string | null): ScoreOverrides {
  if (!value) return {};
  const overrides: ScoreOverrides = {};
  for (const entry of value.split(',')) {
    const colonIdx = entry.lastIndexOf(':');
    if (colonIdx <= 0) continue;
    const name = decodeURIComponent(entry.slice(0, colonIdx));
    const score = Number.parseInt(entry.slice(colonIdx + 1), 10);
    if (name.length > 0 && Number.isFinite(score)) {
      overrides[name] = score;
    }
  }
  return overrides;
}

/**
 * Serializes score overrides to a URL search param value.
 * Format: "cfName:score,cfName:score"
 */
export function serializeOverridesParam(overrides: ScoreOverrides): string {
  return Object.entries(overrides)
    .filter(([, score]) => Number.isFinite(score))
    .map(([name, score]) => `${encodeURIComponent(name)}:${score}`)
    .join(',');
}
```

### URL State Parameter Schema

```
/score-simulator/[databaseId]
  ?profile=pcd:HD%20Bluray%20Web          # Pre-selected profile (URL-encoded)
  &arrType=sonarr                          # Arr type (omit for default radarr)
  &titles=Movie.2024.1080p,Show.S01E01     # Comma-separated release titles
  &overrides=DV:100,HDR10Plus:-50,Atmos:75 # Temporary score overrides
```

## Open Questions

1. **API extension vs. client-only for what-if**: Should the `/api/v1/simulate/score` endpoint
   accept `scoreOverrides` in the request body (Strategy B), or should Phase 3 keep what-if
   computation entirely client-side (Strategy A)? Strategy A is simpler but cannot re-evaluate CF
   matching with different scores; Strategy B provides accurate results but requires API changes.

2. **Title encoding in URL**: Should titles be comma-separated (simple but breaks if titles contain
   commas) or newline-separated (`%0A`)? Alternative: encode as base64 to handle arbitrary
   characters. For the typical score simulator use case (release filenames), commas are extremely
   rare in titles, so comma separation is likely sufficient.

3. **Config Impact Simulator bridge timing**: Phase 3 includes "bridge score simulator's what-if
   scoring into the broader config impact analysis framework." How deep should this integration go?
   Options range from shared type definitions only (minimal) to a shared sandbox state manager
   (heavy). The PCD sandbox compilation model (temporary ops compiled to separate cache) is a
   server-side concern that may be overkill for Phase 3's client-side score overrides.

4. **Quality profile scoring page route**: The deep-link source route
   (`/quality-profiles/[databaseId]/[id]/scoring`) does not appear to exist yet in the routes
   directory. Need to confirm the actual route path for the "Simulate" button placement.

5. **Test scope for e2e**: Should e2e tests require a running parser service? The existing score
   simulator already handles `parserAvailable: false` gracefully. E2e tests could either mock the
   parser or skip parser-dependent assertions.

## Sources

- [SvelteKit $app/navigation docs](https://svelte.dev/docs/kit/$app-navigation)
- [SvelteKit Shallow Routing docs](https://svelte.dev/docs/kit/shallow-routing)
- [SvelteKit State Management docs](https://svelte.dev/docs/kit/state-management)
- [State in URL: the SvelteKit approach (Okupter)](https://www.okupter.com/blog/state-in-url-the-sveltekit-approach)
- [Your URL Is Your State (Alfy, October 2025)](https://alfy.blog/2025/10/31/your-url-is-your-state.html)
- [Mutating Query Params in SvelteKit Without Page Reloads (DEV Community)](https://dev.to/mohamadharith/mutating-query-params-in-sveltekit-without-page-reloads-or-navigations-2i2b)
- [Reactive writable URL Search Params Svelte 5 runes discussion (sveltejs/kit #13746)](https://github.com/sveltejs/kit/issues/13746)
- [Deno Testing Fundamentals](https://docs.deno.com/runtime/fundamentals/testing/)
- [Deno Mocking Tutorial](https://docs.deno.com/examples/mocking_tutorial/)
- [@std/testing/mock on JSR](https://jsr.io/@std/testing/doc/mock)
- [Playwright E2E Testing with SvelteKit (Okupter)](https://www.okupter.com/blog/e2e-testing-with-sveltekit-and-playwright)
- [Storing Large Web App State in URL Using Pako](https://mfyz.com/storing-large-web-app-state-in-url-using-pako/)
- [Best Practices for URL as State (TanStack Router Discussion)](https://github.com/TanStack/router/discussions/1249)
- [Mock database in Svelte e2e tests (Mainmatter)](https://mainmatter.com/blog/2025/08/21/mock-database-in-svelte-tests/)
- [sveltekit-search-params (GitHub)](https://github.com/paoloricciuti/sveltekit-search-params)
- [kit-query-params (GitHub)](https://github.com/beynar/kit-query-params)
