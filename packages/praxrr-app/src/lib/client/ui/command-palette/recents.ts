/**
 * Command palette recents: pure list helpers, the API/localStorage client and the sync controller.
 *
 * The backend is chosen by the root layout (`recentsBackend`): `api` for a real signed-in user,
 * `local` (`localStorage`) for auth-bypass sessions. The two never mix: with `api`, a 401 means the
 * session expired and the write is dropped; network and server errors never fall back to storage.
 * API writes carry the `updatedAt` token from the last read/write (`expectedUpdatedAt`), so a write
 * based on a list another tab (or another user of this browser) has since changed fails with 409.
 */
import {
  COMMAND_PALETTE_RECENT_LIMITS,
  COMMAND_PALETTE_RECENTS_MAX,
  COMMAND_PALETTE_RECENTS_STORAGE_KEY,
  sanitizeCommandPaletteRecents,
  validateCommandPaletteRecents,
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

/** Returns `entries` with `entry` first, any earlier entry with the same key removed, capped. */
function prependRecent(entries: readonly CommandPaletteRecent[], entry: CommandPaletteRecent): CommandPaletteRecent[] {
  return [entry, ...entries.filter((recent) => recent.key !== entry.key)].slice(0, COMMAND_PALETTE_RECENTS_MAX);
}

/**
 * Returns a new list with `entry` first, any earlier entry with the same key removed, capped at
 * {@link COMMAND_PALETTE_RECENTS_MAX}. Labels/kinds are truncated to the contract limits and label
 * control characters replaced; an entry the shared PUT validator would still reject (unsafe or
 * over-long href, empty/oversized key, control characters in key or kind) is not recorded.
 */
export function addRecent(
  recents: readonly CommandPaletteRecent[],
  entry: RecentInput,
  now: Date = new Date()
): CommandPaletteRecent[] {
  const label =
    entry.label.replace(CONTROL_CHARS, ' ').trim().slice(0, COMMAND_PALETTE_RECENT_LIMITS.label) ||
    entry.href.slice(0, COMMAND_PALETTE_RECENT_LIMITS.label);
  const kind = entry.kind.slice(0, COMMAND_PALETTE_RECENT_LIMITS.kind) || 'nav';
  const next: CommandPaletteRecent = { key: entry.key, label, href: entry.href, kind, usedAt: now.toISOString() };
  // One invalid entry would make the server reject the whole list; never store it.
  if (!validateCommandPaletteRecents([next]).ok) return [...recents];
  return prependRecent(recents, next);
}

export type RecentsBackend = 'api' | 'local';

/**
 * - `loaded`: recents read successfully, with the concurrency token (`null` when nothing is stored
 *   or for `localStorage`).
 * - `unauthorized`: API 401 (expired session); nothing may be written.
 * - `unavailable`: server or network error; retry the read later, skip writes until then.
 */
export type RecentsLoadResult =
  | { status: 'loaded'; recents: CommandPaletteRecent[]; updatedAt: string | null }
  | { status: 'unauthorized' }
  | { status: 'unavailable' };

/**
 * - `saved`: persisted; `updatedAt` is the new concurrency token.
 * - `conflict`: 409, the stored list changed since it was read; re-read and merge before retrying.
 * - `retry`: 429, 5xx or network error; the same list may be retried later.
 * - `unauthorized`: API 401 (expired session); drop the write.
 * - `rejected`: any other refusal (e.g. 400); retrying the same list cannot succeed.
 */
export type RecentsSaveResult =
  { status: 'saved'; updatedAt: string | null } | { status: 'conflict' | 'retry' | 'unauthorized' | 'rejected' };

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

/** Reads `updatedAt` from a recents response body; anything but a string means "no token". */
function readUpdatedAt(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('updatedAt' in body)) return null;
  return typeof body.updatedAt === 'string' ? body.updatedAt : null;
}

/** Loads recents from the given backend. Never throws. */
export async function loadRecents(backend: RecentsBackend, fetchFn: typeof fetch = fetch): Promise<RecentsLoadResult> {
  if (backend === 'local') return { status: 'loaded', recents: readLocal(), updatedAt: null };
  try {
    const response = await fetchFn(COMMAND_PALETTE_RECENTS_ENDPOINT, { headers: { Accept: 'application/json' } });
    if (response.status === 401) return { status: 'unauthorized' };
    if (!response.ok) return { status: 'unavailable' };
    const body: unknown = await response.json();
    const recents = typeof body === 'object' && body !== null && 'recents' in body ? body.recents : undefined;
    return { status: 'loaded', recents: sanitizeCommandPaletteRecents(recents), updatedAt: readUpdatedAt(body) };
  } catch {
    return { status: 'unavailable' };
  }
}

export interface SaveRecentsOptions {
  /** Lets the request outlive the page (teardown). */
  keepalive?: boolean;
  /** API concurrency token; omitted makes the write unconditional. Ignored for `localStorage`. */
  expectedUpdatedAt?: string | null;
}

/** Persists recents to the given backend. Never throws. */
export async function saveRecents(
  recents: readonly CommandPaletteRecent[],
  backend: RecentsBackend,
  fetchFn: typeof fetch = fetch,
  { keepalive = false, expectedUpdatedAt }: SaveRecentsOptions = {}
): Promise<RecentsSaveResult> {
  if (backend === 'local') {
    writeLocal(recents);
    return { status: 'saved', updatedAt: null };
  }
  let response: Response;
  try {
    response = await fetchFn(COMMAND_PALETTE_RECENTS_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(expectedUpdatedAt === undefined ? { recents } : { recents, expectedUpdatedAt }),
      keepalive,
    });
  } catch {
    return { status: 'retry' };
  }
  if (response.ok) {
    // An unreadable body only loses the token; the next write then 409s and re-reads.
    const body: unknown = await response.json().catch(() => null);
    return { status: 'saved', updatedAt: readUpdatedAt(body) };
  }
  if (response.status === 401) return { status: 'unauthorized' };
  if (response.status === 409) return { status: 'conflict' };
  if (response.status === 429 || response.status >= 500) return { status: 'retry' };
  return { status: 'rejected' };
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
  /** Total save attempts for one change set before giving up until the next change or open. */
  maxSaveAttempts?: number;
  /** Re-read/merge/re-save rounds after 409 conflicts before giving up until the next open. */
  maxConflictRetries?: number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export interface RecentsSync {
  /**
   * Loads once; after a failed load (or a 409 conflict), the next call re-reads. When already
   * loaded, resumes a pending save that gave up after its retries.
   */
  ensureLoaded(): Promise<void>;
  /** Records an activation and schedules a save (only once the stored list has loaded). */
  record(entry: RecentInput): void;
  /**
   * Sends any pending change immediately with `keepalive` (teardown, `pagehide`, hidden tab). While
   * a save is in flight, the flush runs right after it completes so writes stay ordered.
   */
  flushOnDestroy(): void;
  readonly state: RecentsLoadState;
  readonly recents: CommandPaletteRecent[];
}

/**
 * Owns the in-memory recents list and its persistence. Writes wait until the stored list has
 * loaded, so a save can never overwrite recents it has not read; activations made while loading
 * (or while the backend is unavailable) are merged ahead of the loaded list and saved once. A 409
 * (the stored list changed elsewhere) re-reads and merges only this page's unsaved activations.
 */
export function createRecentsSync(options: RecentsSyncOptions): RecentsSync {
  const {
    backend,
    onChange,
    fetchFn = fetch,
    saveDelayMs = 400,
    retryBaseMs = 2000,
    maxSaveAttempts = 4,
    maxConflictRetries = 2,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle),
  } = options;

  let state: RecentsLoadState = 'idle';
  let recents: CommandPaletteRecent[] = [];
  /** Activations recorded on this page and not yet persisted, newest first. */
  let activations: CommandPaletteRecent[] = [];
  /** Concurrency token of the stored list this page last read or wrote. */
  let updatedAt: string | null = null;
  let dirty = false;
  let saving = false;
  /** A keepalive flush was requested while a save was in flight. */
  let flushAfterSave = false;
  let failedAttempts = 0;
  let conflictRounds = 0;
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

  async function load(): Promise<void> {
    if (state === 'loading') return;
    if (state === 'loaded') {
      // A change set that exhausted its retries resumes on the next open.
      if (dirty && timer === null && !saving) scheduleSave(saveDelayMs);
      return;
    }
    state = 'loading';
    const result = await loadRecents(backend, fetchFn);
    if (result.status !== 'loaded') {
      state = 'failed';
      // An expired session cannot save anything recorded so far; keep it only for display.
      if (result.status === 'unauthorized') {
        dirty = false;
        activations = [];
      }
      return;
    }
    state = 'loaded';
    updatedAt = result.updatedAt;
    // This page's unsaved activations stay first; the sanitizer dedupes and caps.
    setRecents(sanitizeCommandPaletteRecents([...activations, ...result.recents]));
    if (dirty) scheduleSave(saveDelayMs);
  }

  function handleConflict(): void {
    cancelTimer();
    failedAttempts = 0;
    state = 'idle';
    conflictRounds += 1;
    if (conflictRounds > maxConflictRetries) {
      // Give up for now; the next open re-reads, merges and saves.
      conflictRounds = 0;
      return;
    }
    void load();
  }

  async function flush(keepalive = false): Promise<void> {
    if (!dirty || saving || state !== 'loaded') return;
    saving = true;
    dirty = false;
    const sent = new Set(activations);
    const outcome = await saveRecents(recents, backend, fetchFn, {
      keepalive,
      expectedUpdatedAt: backend === 'api' ? updatedAt : undefined,
    });
    saving = false;
    const flushNow = flushAfterSave;
    flushAfterSave = false;

    switch (outcome.status) {
      case 'saved':
        updatedAt = outcome.updatedAt;
        activations = activations.filter((entry) => !sent.has(entry));
        failedAttempts = 0;
        conflictRounds = 0;
        break;
      case 'conflict':
        dirty = true;
        handleConflict();
        return;
      case 'retry':
        dirty = true;
        failedAttempts += 1;
        // A requested teardown flush goes out now instead of waiting for the backoff.
        if (flushNow) break;
        if (failedAttempts < maxSaveAttempts) {
          scheduleSave(retryBaseMs * 2 ** (failedAttempts - 1));
          return;
        }
        // Give up for now; the next activation or open tries again.
        failedAttempts = 0;
        return;
      case 'unauthorized':
      case 'rejected':
        // Drop this change set (never re-merged after a conflict); a change made during the
        // request still saves below.
        activations = activations.filter((entry) => !sent.has(entry));
        failedAttempts = 0;
        break;
    }

    if (!dirty) return;
    if (flushNow) {
      cancelTimer();
      void flush(true);
      return;
    }
    scheduleSave(saveDelayMs);
  }

  return {
    ensureLoaded: load,
    record(entry) {
      const next = addRecent(recents, entry);
      if (next.length === recents.length && next.every((recent, index) => recent === recents[index])) return;
      dirty = true;
      failedAttempts = 0;
      activations = prependRecent(activations, next[0]);
      setRecents(next);
      if (state === 'loaded') scheduleSave(saveDelayMs);
    },
    flushOnDestroy() {
      cancelTimer();
      if (saving) {
        flushAfterSave = true;
        return;
      }
      if (!dirty || state !== 'loaded') return;
      void flush(true);
    },
    get state() {
      return state;
    },
    get recents() {
      return recents;
    },
  };
}
