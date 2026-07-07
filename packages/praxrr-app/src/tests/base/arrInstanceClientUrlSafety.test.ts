import { assertEquals, assertRejects } from '@std/assert';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';

/**
 * Task 1.5 (W1): getArrInstanceClient() must call assertSafeArrUrl(url) before
 * any credential resolution — this is the single choke point that guards
 * every existing Arr-fetch path (sync preview, arr/library, releases,
 * upgrades) against SSRF via cloud-metadata / link-local URLs.
 *
 * These tests patch-and-restore arrInstanceCredentialsQueries.getByInstanceId
 * with a sentinel-throwing stub so no real DB is needed: reaching the stub
 * (sentinel error surfaces) proves the guard passed; the stub never being
 * called proves the guard rejected before any credential lookup.
 */

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

const SENTINEL_MESSAGE = 'sentinel-credential-lookup-reached';

function patchCredentialLookupSentinel(restores: Restore[]): { callCount: () => number } {
  let calls = 0;
  patchTarget(
    arrInstanceCredentialsQueries,
    'getByInstanceId',
    ((..._args: unknown[]) => {
      calls += 1;
      throw new Error(SENTINEL_MESSAGE);
    }) as typeof arrInstanceCredentialsQueries.getByInstanceId,
    restores
  );
  return { callCount: () => calls };
}

Deno.test('getArrInstanceClient rejects a cloud-metadata URL before any credential lookup', async () => {
  const restores: Restore[] = [];
  const { callCount } = patchCredentialLookupSentinel(restores);

  try {
    await assertRejects(
      () => getArrInstanceClient('radarr', 1, 'http://169.254.169.254:80', undefined, undefined),
      Error,
      'Refusing to connect to metadata address'
    );
    assertEquals(callCount(), 0, 'credential lookup must not run when assertSafeArrUrl rejects the URL');
  } finally {
    for (const restore of restores) restore();
  }
});

Deno.test('getArrInstanceClient allows an RFC1918 LAN URL past the guard', async () => {
  const restores: Restore[] = [];
  const { callCount } = patchCredentialLookupSentinel(restores);

  try {
    await assertRejects(
      () => getArrInstanceClient('radarr', 1, 'http://192.168.1.10:7878', undefined, undefined),
      Error,
      SENTINEL_MESSAGE
    );
    assertEquals(callCount(), 1, 'credential lookup must run once the URL passes assertSafeArrUrl');
  } finally {
    for (const restore of restores) restore();
  }
});

Deno.test('getArrInstanceClient allows a localhost URL past the guard', async () => {
  const restores: Restore[] = [];
  const { callCount } = patchCredentialLookupSentinel(restores);

  try {
    await assertRejects(
      () => getArrInstanceClient('sonarr', 2, 'http://localhost:8989', undefined, undefined),
      Error,
      SENTINEL_MESSAGE
    );
    assertEquals(callCount(), 1, 'credential lookup must run once the URL passes assertSafeArrUrl');
  } finally {
    for (const restore of restores) restore();
  }
});
