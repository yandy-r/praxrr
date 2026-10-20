/**
 * One `EventSource` per tab for `GET /api/v1/events`, with its own backoff, replay cursor and
 * auth-aware stop. The browser authenticates through the session cookie; tokens never go in the URL.
 */
import { browser } from '$app/environment';
import { base } from '$app/paths';
import { writable } from 'svelte/store';
import {
  classifyProbeStatus,
  cursorAfterHello,
  helloCursor,
  nextBackoffMs,
  parseLiveEvent,
  retryAfterMs,
} from '$lib/client/events/reconnect.ts';
import { LIVE_EVENTS_PATH, type LiveEvent, type LiveEventOf, type LiveEventType } from '$shared/events/types.ts';

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped';
export type LiveStopReason = 'auth' | 'expired';

type LiveHandler = (e: LiveEvent) => void;

const RESYNC_KEY = 'resync';
const WILDCARD_KEY = '*';
/** Close the stream after the tab stays hidden this long; replay on return covers the gap. */
const HIDDEN_DISCONNECT_MS = 30_000;

function createEventsStore() {
  const status = writable<LiveStatus>('idle');
  const downSince = writable<number | null>(null);
  const stopReason = writable<LiveStopReason | null>(null);
  const handlers = new Map<string, Set<LiveHandler>>();

  let currentStatus: LiveStatus = 'idle';
  let currentDownSince: number | null = null;
  let lastEventId: string | null = null;
  /** Boot/head of the latest `hello`, so a `resync` can move the cursor onto the current boot. */
  let lastHello: { bootId: string; headId: string } | null = null;
  let attempt = 0;
  let source: EventSource | null = null;
  let timer: number | null = null;
  let hiddenTimer: number | null = null;
  let started = false;
  /** Bumped on every connect/stop so stale `onerror` probes cannot schedule a reconnect. */
  let generation = 0;

  const streamUrl = `${base}${LIVE_EVENTS_PATH}`;

  function setStatus(next: LiveStatus): void {
    currentStatus = next;
    status.set(next);
  }

  function setDownSince(next: number | null): void {
    currentDownSince = next;
    downSince.set(next);
  }

  function emit(key: string, e: LiveEvent): void {
    const set = handlers.get(key);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(e);
      } catch (err) {
        console.error('[live-events] handler failed', err);
      }
    }
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function closeSource(): void {
    if (source) {
      source.onmessage = null;
      source.onerror = null;
      source.close();
      source = null;
    }
  }

  function connect(): void {
    if (!started) return;
    clearTimer();
    closeSource();
    const gen = ++generation;
    setStatus(attempt > 0 ? 'reconnecting' : 'connecting');

    const url = streamUrl + (lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : '');
    const es = new EventSource(url);
    source = es;

    es.onmessage = (m: MessageEvent<string>) => {
      const e = parseLiveEvent(m.data);
      if (!e) return;
      if (m.lastEventId) lastEventId = m.lastEventId;

      switch (e.type) {
        case 'hello':
          setStatus('open');
          attempt = 0;
          setDownSince(null);
          lastHello = { bootId: e.bootId, headId: e.headId };
          lastEventId = cursorAfterHello(lastEventId, lastHello);
          return;
        case 'resync':
          // The server sends `resync` right after `hello`; move the cursor to that head so the next
          // reconnect replays from here instead of resyncing again.
          if (lastHello) lastEventId = helloCursor(lastHello);
          emit(RESYNC_KEY, e);
          return;
        case 'session.expired':
          stop('expired');
          return;
        default:
          emit(e.type, e);
          emit(WILDCARD_KEY, e);
      }
    };

    // EventSource hides the HTTP status and stops retrying after a non-200, so probe and retry ourselves.
    es.onerror = () => {
      if (source !== es) return;
      closeSource();
      void handleFailure(gen);
    };
  }

  async function handleFailure(gen: number): Promise<void> {
    if (currentDownSince === null) setDownSince(Date.now());
    setStatus('reconnecting');

    let r: Response | null = null;
    try {
      // HEAD takes no stream slot, so probing cannot trip the connection cap.
      r = await fetch(streamUrl, { method: 'HEAD', credentials: 'same-origin' });
    } catch {
      r = null;
    }
    if (!started || gen !== generation) return;

    const verdict = r ? classifyProbeStatus(r.status) : 'backoff';
    if (verdict === 'stop') {
      stop('auth');
      return;
    }
    const delay = retryAfterMs(r?.headers.get('Retry-After') ?? null) ?? nextBackoffMs(attempt++);
    clearTimer();
    timer = window.setTimeout(connect, delay);
  }

  function clearHiddenTimer(): void {
    if (hiddenTimer !== null) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
  }

  // Hidden tabs release their stream after a grace period so many background tabs cannot exhaust the
  // HTTP/1.1 per-origin connection cap; the `lastEventId` cursor replays the gap on return.
  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') {
      if (hiddenTimer === null && currentStatus !== 'stopped') {
        hiddenTimer = window.setTimeout(() => {
          hiddenTimer = null;
          if (started && document.visibilityState !== 'visible') disconnect();
        }, HIDDEN_DISCONNECT_MS);
      }
      return;
    }
    clearHiddenTimer();
    if (currentStatus === 'open' || currentStatus === 'stopped') return;
    connect();
  }

  /** `pagehide` or a long-hidden tab: close the stream but keep `stopReason`; `visibilitychange` reconnects. */
  function disconnect(): void {
    ++generation;
    clearTimer();
    closeSource();
    if (currentStatus !== 'stopped') setStatus('idle');
  }

  function addListeners(): void {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', disconnect);
  }

  function removeListeners(): void {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', disconnect);
    clearHiddenTimer();
  }

  function start(): void {
    if (!browser || started) return;
    started = true;
    attempt = 0;
    stopReason.set(null);
    setDownSince(null);
    addListeners();
    connect();
  }

  function stop(reason?: LiveStopReason): void {
    ++generation;
    setStatus('stopped');
    stopReason.set(reason ?? null);
    closeSource();
    clearTimer();
    if (browser) removeListeners();
    started = false;
  }

  function addHandler(key: string, fn: LiveHandler): () => void {
    let set = handlers.get(key);
    if (!set) {
      set = new Set();
      handlers.set(key, set);
    }
    set.add(fn);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = handlers.get(key);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) handlers.delete(key);
    };
  }

  function on<T extends LiveEventType>(type: T, fn: (e: LiveEventOf<T>) => void): () => void;
  function on(type: '*', fn: (e: LiveEvent) => void): () => void;
  function on(type: LiveEventType | '*', fn: (e: never) => void): () => void {
    return addHandler(type, fn as LiveHandler);
  }

  function onResync(fn: (e: LiveEventOf<'resync'>) => void): () => void {
    return addHandler(RESYNC_KEY, fn as LiveHandler);
  }

  return {
    status: { subscribe: status.subscribe },
    downSince: { subscribe: downSince.subscribe },
    stopReason: { subscribe: stopReason.subscribe },
    start,
    stop,
    on,
    onResync,
  };
}

export const eventsStore = createEventsStore();
