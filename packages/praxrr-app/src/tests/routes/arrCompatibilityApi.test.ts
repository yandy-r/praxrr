// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { GET } from '../../routes/api/v1/compatibility/versions/+server.ts';
import type { components } from '$api/v1.d.ts';

type GetEvent = Parameters<typeof GET>[0];
type VersionCompatibilityMatrix = components['schemas']['VersionCompatibilityMatrix'];
type ErrorResponse = components['schemas']['ErrorResponse'];

type AuthMode = 'authenticated' | 'unauthenticated' | 'bypass';

function buildGetEvent(mode: AuthMode): GetEvent {
  const authenticated = mode === 'authenticated';
  const event: Partial<GetEvent> = {
    url: new URL('http://localhost/api/v1/compatibility/versions'),
    locals: {
      user: authenticated
        ? {
            id: 1,
            username: 'user-1',
            password_hash: 'hash',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        : null,
      session: null,
      authBypass: mode === 'bypass',
    },
  };

  return event as GetEvent;
}

Deno.test('unauthenticated version compatibility request returns 401', async () => {
  const response = await GET(buildGetEvent('unauthenticated'));
  assertEquals(response.status, 401);

  const body = (await response.json()) as ErrorResponse;
  assert(typeof body.error === 'string' && body.error.length > 0);
});

Deno.test('authenticated version compatibility request returns the matrix for all 3 apps', async () => {
  const response = await GET(buildGetEvent('authenticated'));
  assertEquals(response.status, 200);

  const body = (await response.json()) as VersionCompatibilityMatrix;
  assert(Array.isArray(body.apps));
  assertEquals(body.apps.length, 3);

  const arrTypes = body.apps.map((app) => app.arrType).sort();
  assertEquals(arrTypes, ['lidarr', 'radarr', 'sonarr']);

  for (const app of body.apps) {
    assert(Array.isArray(app.features) && app.features.length > 0, `${app.arrType} has features`);
    assert(typeof app.range.minimumSupported === 'string', `${app.arrType} range present`);
  }
});

Deno.test('auth-bypassed version compatibility request returns 200', async () => {
  const response = await GET(buildGetEvent('bypass'));
  assertEquals(response.status, 200);

  const body = (await response.json()) as VersionCompatibilityMatrix;
  assertEquals(body.apps.length, 3);
});

Deno.test('openapi.json documents the /compatibility/versions path and VersionCompatibilityMatrix schema', async () => {
  const specUrl = new URL('../../../../praxrr-api/openapi.json', import.meta.url);
  const spec = JSON.parse(await Deno.readTextFile(specUrl)) as {
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
  };

  assert(Object.hasOwn(spec.paths, '/compatibility/versions'), 'openapi paths should document /compatibility/versions');
  assert(
    Object.hasOwn(spec.components.schemas, 'VersionCompatibilityMatrix'),
    'openapi schemas should define VersionCompatibilityMatrix'
  );
});
