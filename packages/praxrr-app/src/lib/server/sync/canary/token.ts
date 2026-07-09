/**
 * Canary state-token seam
 * Single injectable source of `state_token` values so guard tests can stub
 * generation and assert token inequality / round-trip rather than a fixed value.
 */

/** Generate a fresh, unique canary rollout state token. */
export function newStateToken(): string {
  return crypto.randomUUID();
}
