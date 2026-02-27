/**
 * Check whether a value is a non-array object.
 *
 * @param value - Unknown value.
 * @returns True when value is a plain object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
