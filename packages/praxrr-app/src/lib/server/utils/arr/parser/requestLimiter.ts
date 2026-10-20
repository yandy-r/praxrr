/**
 * FIFO concurrency limiter for parser requests.
 *
 * The parser admits a fixed number of non-health requests and answers `503`
 * (no queue) beyond that, so the app queues locally instead of fanning out.
 */
export class RequestLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('RequestLimiter limit must be a positive integer');
    }
  }

  /** Run `task` once a slot is free; the slot is released even when `task` throws. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      // The releasing caller hands its slot over directly, so `active` stays counted.
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiters.shift();
      if (next) {
        next();
      } else {
        this.active -= 1;
      }
    }
  }
}
