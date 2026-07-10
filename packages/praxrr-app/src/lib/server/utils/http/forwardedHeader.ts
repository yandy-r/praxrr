/** First comma-separated token of a possibly-chained forwarded header. */
export function firstForwardedValue(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(',')[0]?.trim();
  return first || null;
}
