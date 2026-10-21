/**
 * Trailing debounce with a `maxWait` cap: bursts collapse into one call `debounceMs` after the last
 * trigger, but a continuous stream still fires at least every `maxWaitMs` from its first trigger.
 */
export interface DebounceTimers {
  now(): number;
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

const defaultTimers: DebounceTimers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
};

export class DebounceScheduler {
  private timer: number | null = null;
  private firstAt: number | null = null;

  constructor(
    private readonly fn: () => void,
    private readonly debounceMs: number,
    private readonly maxWaitMs: number,
    private readonly timers: DebounceTimers = defaultTimers
  ) {}

  schedule(): void {
    const at = this.timers.now();
    if (this.firstAt === null) this.firstAt = at;
    if (this.timer !== null) this.timers.clear(this.timer);
    const untilMax = Math.max(0, this.firstAt + this.maxWaitMs - at);
    this.timer = this.timers.set(() => this.flush(), Math.min(this.debounceMs, untilMax));
  }

  cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.firstAt = null;
  }

  private flush(): void {
    this.timer = null;
    this.firstAt = null;
    this.fn();
  }
}
