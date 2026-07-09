/**
 * Typed HTTP errors for the timeline feature (issue #27). A thrown {@link TimelineHttpError}
 * carries the status a route should return; anything else that escapes a handler is an internal
 * 500. Keeps route handlers thin: `catch (e) { if (e instanceof TimelineHttpError) ...; else 500 }`.
 */

export class TimelineHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'TimelineHttpError';
  }
}
