// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assertEquals } from '@std/assert';
import {
  userComplexityTiersQueries,
  type UserComplexityTier,
  type UserComplexityTierInput,
} from '$db/queries/user_complexity_tiers.ts';
import { GET, PATCH } from '../../routes/api/v1/complexity-tiers/+server.ts';
import type { ComplexityTier } from '$shared/complexity/tiers.ts';
import type { SectionKey } from '$shared/disclosure/sectionKeys.ts';

type Restore = () => void;
type PatchEvent = Parameters<typeof PATCH>[0];
type GetEvent = Parameters<typeof GET>[0];

function restoreAll(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

function withInMemoryStore(): { restoreAll: () => void; store: Map<string, UserComplexityTier> } {
  const restores: Restore[] = [];
  const store = new Map<string, UserComplexityTier>();
  const mapKey = (userId: number, sectionKey: string): string => `${userId}:${sectionKey}`;

  const originalGet = userComplexityTiersQueries.getByUserIdAndSectionKey;
  userComplexityTiersQueries.getByUserIdAndSectionKey = (userId, sectionKey) => store.get(mapKey(userId, sectionKey));
  restores.push(() => {
    userComplexityTiersQueries.getByUserIdAndSectionKey = originalGet;
  });

  const originalUpsert = userComplexityTiersQueries.upsert;
  userComplexityTiersQueries.upsert = (input: UserComplexityTierInput) => {
    const existing = store.get(mapKey(input.userId, input.sectionKey));
    const record: UserComplexityTier = {
      userId: input.userId,
      sectionKey: input.sectionKey,
      tier: input.tier,
      interactionCount: input.interactionCount ?? existing?.interactionCount ?? 0,
      advancedToggleCount: input.advancedToggleCount ?? existing?.advancedToggleCount ?? 0,
      lastSuggestedTier: input.lastSuggestedTier ?? existing?.lastSuggestedTier ?? null,
      suggestionDismissedAt:
        input.suggestionDismissedAt !== undefined
          ? input.suggestionDismissedAt
          : (existing?.suggestionDismissedAt ?? null),
      updatedAt: new Date().toISOString(),
    };
    store.set(mapKey(input.userId, input.sectionKey), record);
    return record;
  };
  restores.push(() => {
    userComplexityTiersQueries.upsert = originalUpsert;
  });

  const originalUpdateIfUpdatedAt = userComplexityTiersQueries.updateIfUpdatedAt;
  userComplexityTiersQueries.updateIfUpdatedAt = (input) => {
    const existing = store.get(mapKey(input.userId, input.sectionKey));
    if (!existing || existing.updatedAt !== input.expectedUpdatedAt) {
      return null;
    }

    const record: UserComplexityTier = {
      userId: input.userId,
      sectionKey: input.sectionKey,
      tier: input.tier,
      interactionCount: input.interactionCount,
      advancedToggleCount: input.advancedToggleCount,
      lastSuggestedTier: input.lastSuggestedTier,
      suggestionDismissedAt: input.suggestionDismissedAt,
      updatedAt: new Date().toISOString(),
    };
    store.set(mapKey(input.userId, input.sectionKey), record);
    return record;
  };
  restores.push(() => {
    userComplexityTiersQueries.updateIfUpdatedAt = originalUpdateIfUpdatedAt;
  });

  return {
    store,
    restoreAll: () => restoreAll(restores),
  };
}

function buildGetRequest(sectionKey: string, userId?: number, strict: boolean = false): GetEvent {
  const strictQuery = strict ? '&strict=true' : '';
  const event: Partial<GetEvent> = {
    url: new URL(
      `http://localhost/api/v1/complexity-tiers?section_key=${encodeURIComponent(sectionKey)}${strictQuery}`
    ),
    locals: {
      user: null,
      session: null,
      authBypass: false,
    },
  };
  if (typeof userId === 'number') {
    event.locals = {
      user: {
        id: userId,
        username: `user-${userId}`,
        password_hash: 'hash',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      session: null,
      authBypass: false,
    };
  }

  return event as GetEvent;
}

function buildPatchRequest(
  sectionKey: string,
  tier: ComplexityTier,
  userId?: number,
  extra: Record<string, unknown> = {}
): PatchEvent {
  const event: Partial<PatchEvent> = {
    request: new Request('http://localhost/api/v1/complexity-tiers', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        section_key: sectionKey,
        tier,
        ...extra,
      }),
    }),
    locals: {
      user: null,
      session: null,
      authBypass: false,
    },
  };

  if (typeof userId === 'number') {
    event.locals = {
      user: {
        id: userId,
        username: `user-${userId}`,
        password_hash: 'hash',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      session: null,
      authBypass: false,
    };
  }

  return event as PatchEvent;
}

Deno.test('unauthenticated complexity tier read and write return 401', async () => {
  const requestScope = withInMemoryStore();
  try {
    assertEquals((await GET(buildGetRequest('custom-formats:general:conditions'))).status, 401);
    assertEquals((await PATCH(buildPatchRequest('custom-formats:general:conditions', 'advanced'))).status, 401);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('complexity tiers are scoped per user and default to beginner on first visit', async () => {
  const requestScope = withInMemoryStore();

  try {
    const sectionKey = 'custom-formats:general:conditions';
    const writeForA = await PATCH(buildPatchRequest(sectionKey, 'advanced', 11));
    assertEquals(writeForA.status, 200);

    const readForA = await GET(buildGetRequest(sectionKey, 11));
    const bodyForA = (await readForA.json()) as { tier: ComplexityTier; persisted: boolean };
    assertEquals(bodyForA.tier, 'advanced');
    assertEquals(bodyForA.persisted, true);

    const readForB = await GET(buildGetRequest(sectionKey, 22));
    const bodyForB = (await readForB.json()) as { tier: ComplexityTier; persisted: boolean };
    assertEquals(bodyForB.tier, 'beginner');
    assertEquals(bodyForB.persisted, false);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('strict complexity tier read returns 404 when missing', async () => {
  const requestScope = withInMemoryStore();
  try {
    const response = await GET(buildGetRequest('custom-formats:general:scoring', 54, true));
    assertEquals(response.status, 404);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('complexity tier write rejects invalid tier and section key values', async () => {
  const requestScope = withInMemoryStore();
  try {
    const invalidTier = buildPatchRequest('custom-formats:general:conditions', 'beginner', 110);
    invalidTier.request = new Request('http://localhost/api/v1/complexity-tiers', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        section_key: 'custom-formats:general:conditions',
        tier: 'expert',
      }),
    });
    assertEquals((await PATCH(invalidTier)).status, 400);
    assertEquals((await PATCH(buildPatchRequest('invalid_section_key', 'advanced', 111))).status, 400);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('complexity tier write returns 409 when expected_updated_at is stale', async () => {
  const requestScope = withInMemoryStore();
  try {
    const sectionKey = 'custom-formats:general:conditions';
    assertEquals((await PATCH(buildPatchRequest(sectionKey, 'beginner', 109))).status, 200);

    const conflict = await PATCH(
      buildPatchRequest(sectionKey, 'advanced', 109, {
        expected_updated_at: '2000-01-01T00:00:00.000Z',
      })
    );
    assertEquals(conflict.status, 409);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('api-key synthetic user id zero returns defaults and does not persist', async () => {
  const requestScope = withInMemoryStore();
  try {
    const sectionKey = 'custom-formats:general:conditions';
    const response = await PATCH(buildPatchRequest(sectionKey, 'advanced', 0));
    const body = (await response.json()) as { tier: ComplexityTier; persisted: boolean };

    assertEquals(response.status, 200);
    assertEquals(body.tier, 'beginner');
    assertEquals(body.persisted, false);
    assertEquals(requestScope.store.size, 0);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('complexity tier write returns 409 when expected_updated_at is set but no row exists', async () => {
  const requestScope = withInMemoryStore();
  try {
    const sectionKey = 'custom-formats:general:conditions';
    const conflict = await PATCH(
      buildPatchRequest(sectionKey, 'advanced', 130, {
        expected_updated_at: '2026-07-06T00:00:00.000Z',
      })
    );

    assertEquals(conflict.status, 409);
    const body = (await conflict.json()) as { error: string };
    assertEquals(body.error, 'Concurrency conflict: complexity tier does not exist');
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('complexity tier write uses updateIfUpdatedAt when expected_updated_at matches', async () => {
  const requestScope = withInMemoryStore();
  try {
    const sectionKey = 'custom-formats:general:conditions';
    const userId = 131;

    const createRes = await PATCH(buildPatchRequest(sectionKey, 'beginner', userId));
    assertEquals(createRes.status, 200);
    const created = (await createRes.json()) as { updated_at: string };

    const updateRes = await PATCH(
      buildPatchRequest(sectionKey, 'advanced', userId, {
        expected_updated_at: created.updated_at,
      })
    );
    assertEquals(updateRes.status, 200);
    const updated = (await updateRes.json()) as { tier: ComplexityTier; persisted: boolean };
    assertEquals(updated.tier, 'advanced');
    assertEquals(updated.persisted, true);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('api-key synthetic user id zero GET returns defaults and does not persist', async () => {
  const requestScope = withInMemoryStore();
  try {
    const sectionKey = 'custom-formats:general:conditions';
    const response = await GET(buildGetRequest(sectionKey, 0));
    const body = (await response.json()) as { tier: ComplexityTier; persisted: boolean };

    assertEquals(response.status, 200);
    assertEquals(body.tier, 'beginner');
    assertEquals(body.persisted, false);
    assertEquals(requestScope.store.size, 0);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('complexity tier writes persist activity and dismissal metadata', async () => {
  const requestScope = withInMemoryStore();
  try {
    const sectionKey = 'custom-formats:general:conditions';
    const response = await PATCH(
      buildPatchRequest(sectionKey, 'beginner', 120, {
        interaction_delta: 2,
        advanced_toggle_delta: 5,
        last_suggested_tier: 'intermediate',
        suggestion_dismissed_at: '2026-07-06T00:00:00.000Z',
      })
    );
    const body = (await response.json()) as {
      interaction_count: number;
      advanced_toggle_count: number;
      last_suggested_tier: ComplexityTier | null;
      suggestion_dismissed_at: string | null;
    };

    assertEquals(response.status, 200);
    assertEquals(body.interaction_count, 2);
    assertEquals(body.advanced_toggle_count, 5);
    assertEquals(body.last_suggested_tier, 'intermediate');
    assertEquals(body.suggestion_dismissed_at, '2026-07-06T00:00:00.000Z');
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('complexity tier writes are rate limited per user and section', async () => {
  const requestScope = withInMemoryStore();
  try {
    const sectionKey = 'custom-formats:general:negation-and-groups';
    const userId = 188;
    for (let i = 0; i < 8; i += 1) {
      const response = await PATCH(buildPatchRequest(sectionKey, i % 2 === 0 ? 'advanced' : 'beginner', userId));
      assertEquals(response.status, 200);
    }

    const blockedResponse = await PATCH(buildPatchRequest(sectionKey, 'advanced', userId));
    assertEquals(blockedResponse.status, 429);
  } finally {
    requestScope.restoreAll();
  }
});
