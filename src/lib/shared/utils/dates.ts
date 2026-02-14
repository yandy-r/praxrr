/**
 * Date utilities for handling SQLite timestamps
 *
 * SQLite stores timestamps from CURRENT_TIMESTAMP as UTC in the format
 * "YYYY-MM-DD HH:MM:SS" (no timezone indicator). JavaScript's Date constructor
 * interprets strings without timezone info as local time, causing incorrect
 * display.
 *
 * These utilities normalize SQLite timestamps to proper ISO 8601 format
 * so JavaScript correctly interprets them as UTC.
 */

/**
 * Normalizes a SQLite timestamp to ISO 8601 format with UTC indicator.
 * Handles both SQLite format ("YYYY-MM-DD HH:MM:SS") and ISO format.
 *
 * @param timestamp - SQLite or ISO timestamp string
 * @returns ISO 8601 formatted string with Z suffix, or null if input is null/undefined
 *
 * @example
 * toUTC("2026-01-17 03:21:52")     // "2026-01-17T03:21:52Z"
 * toUTC("2026-01-17T03:21:52")     // "2026-01-17T03:21:52Z"
 * toUTC("2026-01-17T03:21:52Z")    // "2026-01-17T03:21:52Z" (unchanged)
 * toUTC(null)                      // null
 */
export function toUTC(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;

  const trimmed = timestamp.trim();
  // Already has timezone info - return as-is
  if (/[+-]\d{2}:\d{2}$/.test(trimmed) || trimmed.endsWith('Z')) return trimmed;

  // Replace space with T (SQLite format) and add Z
  return trimmed.replace(' ', 'T') + 'Z';
}

/**
 * Parses a SQLite timestamp into a JavaScript Date object.
 * Normalizes the timestamp to UTC before parsing.
 *
 * @param timestamp - SQLite or ISO timestamp string
 * @returns Date object, or null if input is null/undefined
 *
 * @example
 * parseUTC("2026-01-17 03:21:52")  // Date object in UTC
 * parseUTC(null)                   // null
 */
export function parseUTC(timestamp: string | null | undefined): Date | null {
  const normalized = toUTC(timestamp);
  if (!normalized) return null;
  return new Date(normalized);
}
