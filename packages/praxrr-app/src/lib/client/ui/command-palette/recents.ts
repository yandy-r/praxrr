/**
 * Command palette recents: pure list helpers, the API/localStorage client and the sync controller.
 *
 * The backend is chosen by the root layout (`recentsBackend`): `api` for a real signed-in user,
 * `local` (`localStorage`) for auth-bypass sessions. The two never mix: with `api`, a 401 means the
 * session expired and the write is dropped; network and server errors never fall back to storage.
 */
import {
  COMMAND_PALETTE_RECENT_LIMITS,
  COMMAND_PALETTE_RECENTS_MAX,
  COMMAND_PALETTE_RECENTS_STORAGE_KEY,
  isStorableRecentHref,
  sanitizeCommandPaletteRecents,
  type CommandPaletteRecent,
} from '$shared/search/recents.ts';

export const COMMAND_PALETTE_RECENTS_ENDPOINT = '/api/v1/ui-preferences/command-palette-recents';

export interface RecentInput {
  key: string;
  label: string;
  href: string;
  kind: string;
}

// Intentionally matches C0/C1 control characters.
// deno-lint-ignore no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g; // eslint-disable-line no-control-regex

/**
 * Returns a new list with `entry` first, any earlier entry with the same key removed, capped at
 * {@link COMMAND_PALETTE_RECENTS_MAX}. Labels/kinds are truncated to the contract limits; entries
 * with an unsafe or over-long href, or an oversized key, are not recorded.
 */
export function addRecent(
  recents: readonly CommandPaletteRecent[],
  entry: RecentInput,
  now: Date = new Date()
): CommandPaletteRecent[] {
  if (
    !isStorableRecentHref(entry.href) ||
    entry.key.length === 0 ||
    entry.key.length > COMMAND_PALETTE_RECENT_LIMITS.key
  ) {
    return [...recents];
  }
  // Control characters would make the server reject the whole PUT; drop them from display text.
  const label =
    entry.label.replace(CONTROL_CHARS, ' ').trim().slice(0, COMMAND_PALETTE_RECENT_LIMITS.label) || entry.href;
  const kind = entry.kind.slice(0, COMMAND_PALETTE_RECENT_LIMITS.kind) || 'nav';
  const next: CommandPaletteRecent = { key: entry.key, label, href: entry.href, kind, usedAt: now.toISOString() };
  return [next, ...recents.filter((recent) => recent.key !== entry.key)].slice(0, COMMAND_PALETTE_RECENTS_MAX);
}

export type RecentsBackend = 'api' | 'local';

/**
 * - `loaded`: recents read successfully.
 * - `unauthorized`: API 401 (expired session); nothing may be written.
 * - `unavailable`: server or network error; retry the read later, skip writes until then.
 */
export type RecentsLoadResult =
  { status: 'loaded'; recents: CommandPaletteRecent[] } | { status: 'unauthorized' } | { status: 'unavailable' };

/**
 * - `saved`: persisted.
 * - `retry`: 429, 5xx or network error; the same list may be retried later.
 * - `unauthorized`: API 401 (expired session); drop the write.
 * - `rejected`: any other refusal (e.g. 400); retrying the same list cannot succeed.
 */
export type RecentsSaveResult = 'saved' | 'retry' | 'unauthorized' | 'rejected';

function readLocal(): CommandPaletteRecent[] {
  try {
    const raw = localStorage.getItem(COMMAND_PALETTE_RECENTS_STORAGE_KEY);
    return raw ? sanitizeCommandPaletteRecents(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeLocal(recents: readonly CommandPaletteRecent[]): void {
  try {
    localStorage.setItem(COMMAND_PALETTE_RECENTS_STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // Storage full or disabled: recents simply do not persist.
  }
}

/** Removes `localStorage` recents so the next person on this browser does not inherit them. */
export function clearLocalRecents(): void {
  try {
    localStorage.removeItem(COMMAND_PALETTE_RECENTS_STORAGE_KEY);
  } catch {
    // Storage disabled: nothing stored.
  }
}

/** Loads recents from the given backend. Never throws. */
export async function loadRecents(backend: RecentsBackend, fetchFn: typeof fetch = fetch): Promise<RecentsLoadResult> {
  if (backend === 'local') return { status: 'loaded', recents: readLocal() };
  try {
    const response = await fetchFn(COMMAND_PALETTE_RECENTS_ENDPOINT, { headers: { Accept: 'application/json' } });
    if (response.status === 401) return { status: 'unauthorized' };
    if (!response.ok) return { status: 'unavailable' };
    const body: unknown = await response.json();
    const recents = typeof body === 'object' && body !== null && 'recents' in body ? body.recents : undefined;
    return { status: 'loaded', recents: sanitizeCommandPaletteRecents(recents) };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Persists recents to the given backend. `keepalive` lets the request outlive the page. Never throws. */
export async function saveRecents(
  recents: readonly CommandPaletteRecent[],
  backend: RecentsBackend,
  fetchFn: typeof fetch = fetch,
  { keepalive = false }: { keepalive?: boolean } = {}
): Promise<RecentsSaveResult> {
  if (backend === 'local') {
    writeLocal(recents);
    return 'saved';
  }
  try {
    const response = await fetchFn(COMMAND_PALETTE_RECENTS_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recents }),
      keepalive,
    });
    if (response.ok) return 'saved';
    if (response.status === 401) return 'unauthorized';
    if (response.status === 429 || response.status >= 500) return 'retry';
    return 'rejected';
  } catch {
    return 'retry';
  }
}

export type RecentsLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/** Platform timer handle (`number` in browsers and Deno). */
export type TimerHandle = ReturnType<typeof setTimeout>;

export interface RecentsSyncOptions {
  backend: RecentsBackend;
  /** Called with the new list whenever it changes. */
  onChange: (recents: CommandPaletteRecent[]) => void;
  fetchFn?: typeof fetch;
  /** Coalescing delay before a save; the API rate-limits writes. */
  saveDelayMs?: number;
  /** First retry delay after a 429/5xx/network failure; doubles per attempt. */
  retryBaseMs?: number;
  /** Total save attempts for one change set before giving up until the next change. */
  maxSaveAttempts?: number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export interface RecentsSync {
  /** Loads once; after a failed load, the next call retries. No-op while loading or loaded. */
  ensureLoaded(): Promise<void>;
  /** Records an activation and schedules a save (only once the stored list has loaded). */
  record(entry: RecentInput): void;
  /** Sends any pending change immediately with `keepalive` (component teardown). */
  flushOnDestroy(): void;
  readonly state: RecentsLoadState;
  readonly recents: CommandPaletteRecent[];
}

/**
 * Owns the in-memory recents list and its persistence. Writes wait until the stored list has
 * loaded, so a save can never overwrite recents it has not read; activations made while loading
 * (or while the backend is unavailable) are merged ahead of the loaded list and saved once.
 */
export function createRecentsSync(options: RecentsSyncOptions): RecentsSync {
  const {
    backend,
    onChange,
    fetchFn = fetch,
    saveDelayMs = 400,
    retryBaseMs = 2000,
    maxSaveAttempts = 4,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle),
  } = options;

  let state: RecentsLoadState = 'idle';
  let recents: CommandPaletteRecent[] = [];
  let dirty = false;
  let saving = false;
  let failedAttempts = 0;
  let timer: TimerHandle | null = null;

  const setRecents = (next: CommandPaletteRecent[]) => {
    recents = next;
    onChange(next);
  };

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const scheduleSave = (ms: number) => {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, ms);
  };

  async function flush(): Promise<void> {
    if (!dirty || saving || state !== 'loaded') return;
    saving = true;
    dirty = false;
    const outcome = await saveRecents(recents, backend, fetchFn);
    saving = false;
    if (outcome === 'retry') {
      dirty = true;
      failedAttempts += 1;
      if (failedAttempts < maxSaveAttempts) {
        scheduleSave(retryBaseMs * 2 ** (failedAttempts - 1));
        return;
      }
      // Give up for now; the next activation tries again.
      failedAttempts = 0;
      return;
    }
    failedAttempts = 0;
    // `unauthorized`/`rejected` drop this change set; a change made during the request still saves.
    if (dirty) scheduleSave(saveDelayMs);
  }

  return {
    async ensureLoaded() {
      if (state === 'loading' || state === 'loaded') return;
      state = 'loading';
      const result = await loadRecents(backend, fetchFn);
      if (result.status !== 'loaded') {
        state = 'failed';
        // An expired session cannot save anything recorded so far; keep it only for display.
        if (result.status === 'unauthorized') dirty = false;
        return;
      }
      state = 'loaded';
      // Activations recorded before the load completed stay first; the sanitizer dedupes and caps.
      setRecents(sanitizeCommandPaletteRecents([...recents, ...result.recents]));
      if (dirty) scheduleSave(saveDelayMs);
    },
    record(entry) {
      const next = addRecent(recents, entry);
      if (next.length === recents.length && next.every((recent, index) => recent === recents[index])) return;
      dirty = true;
      failedAttempts = 0;
      setRecents(next);
      if (state === 'loaded') scheduleSave(saveDelayMs);
    },
    flushOnDestroy() {
      cancelTimer();
      if (!dirty || state !== 'loaded') return;
      dirty = false;
      void saveRecents(recents, backend, fetchFn, { keepalive: true });
    },
    get state() {
      return state;
    },
    get recents() {
      return recents;
    },
  };
}
