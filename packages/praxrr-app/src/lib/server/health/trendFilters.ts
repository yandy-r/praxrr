import { parseDateBound } from '$sync/syncHistory/filters.ts';

const MIN_DAYS = 1;
const MAX_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/;

export interface ConfigHealthTrendFilters {
  readonly from: string | undefined;
  readonly to: string;
  readonly profile: string | undefined;
}

export type ConfigHealthTrendClock = () => Date | number;

/** A client-supplied trend filter is invalid. Routes map this error to HTTP 400. */
export class ConfigHealthTrendQueryError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = 'ConfigHealthTrendQueryError';
  }
}

function captureNow(clock: ConfigHealthTrendClock): Date {
  const value = clock();
  const captured = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(captured.getTime())) {
    throw new Error('Config Health trend clock returned an invalid time');
  }
  return captured;
}

function parseDays(raw: string | null): number | undefined {
  if (raw === null) return undefined;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigHealthTrendQueryError('Invalid days');
  }

  const days = Number(trimmed);
  if (!Number.isSafeInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new ConfigHealthTrendQueryError('Invalid days');
  }
  return days;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** `Date.parse` normalizes some impossible calendar values, so reject them before using it. */
function validateCalendarParts(raw: string): void {
  const match = DATE_PARTS.exec(raw);
  if (!match) return;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new Error('Invalid calendar date');
  }

  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    if (hour > 23 || minute > 59 || second > 59) {
      throw new Error('Invalid clock time');
    }
  }
}

function parseBound(raw: string | null, name: 'from' | 'to', bound: 'lower' | 'upper'): string | undefined {
  try {
    if (raw !== null && raw.trim()) validateCalendarParts(raw.trim());
    return parseDateBound(raw, name, bound);
  } catch {
    throw new ConfigHealthTrendQueryError(`Invalid ${name}`);
  }
}

/**
 * Parse and normalize the selection shared by Config Health trend JSON and export routes.
 * The request clock is captured once so relative and open-ended selections have a stable upper
 * bound that can be reused by a later export.
 */
export function parseConfigHealthTrendFilters(
  url: URL,
  clock: ConfigHealthTrendClock = Date.now
): ConfigHealthTrendFilters {
  const capturedNow = captureNow(clock);
  const capturedNowIso = capturedNow.toISOString();
  const params = url.searchParams;
  const days = parseDays(params.get('days'));

  if (days !== undefined && (params.has('from') || params.has('to'))) {
    throw new ConfigHealthTrendQueryError('days cannot be combined with from or to');
  }

  const profile = params.get('profile');
  if (profile === '') {
    throw new ConfigHealthTrendQueryError('Invalid profile');
  }

  let from: string | undefined;
  let to: string;
  if (days !== undefined) {
    from = new Date(capturedNow.getTime() - days * DAY_MS).toISOString();
    to = capturedNowIso;
  } else {
    from = parseBound(params.get('from'), 'from', 'lower');
    to = parseBound(params.get('to'), 'to', 'upper') ?? capturedNowIso;
  }

  if (from !== undefined && from > to) {
    throw new ConfigHealthTrendQueryError('from cannot be after to');
  }

  return { from, to, profile: profile ?? undefined };
}
