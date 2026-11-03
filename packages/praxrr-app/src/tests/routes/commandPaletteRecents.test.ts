// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { usersQueries } from '$db/queries/users.ts';
import { jobDispatcher } from '$jobs/dispatcher.ts';
import {
  COMMAND_PALETTE_RECENTS_MAX,
  isSafeRelativeHref,
  sanitizeCommandPaletteRecents,
  validateCommandPaletteRecents,
  type CommandPaletteRecent,
} from '$shared/search/recents.ts';
import { GET, PUT } from '../../routes/api/v1/ui-preferences/command-palette-recents/+server.ts';

type RecentsGetEvent = Parameters<typeof GET>[0];
type RecentsPutEvent = Parameters<typeof PUT>[0];

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/command-palette-recents-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        jobDispatcher.stop();
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function locals(userId: number | null): App.Locals {
  return {
    user:
      userId === null
        ? null
        : ({
            id: userId,
            username: userId === 0 ? 'api' : `user-${userId}`,
            password_hash: 'hash',
            created_at: '2026-11-01T00:00:00.000Z',
            updated_at: '2026-11-01T00:00:00.000Z',
          } as App.Locals['user']),
    session: null,
    authBypass: userId === null,
    principal: null,
  };
}

function getEvent(userId: number | null): RecentsGetEvent {
  return { locals: locals(userId) } as unknown as RecentsGetEvent;
}

function putEvent(userId: number | null, body: unknown): RecentsPutEvent {
  return {
    locals: locals(userId),
    request: new Request('http://localhost/api/v1/ui-preferences/command-palette-recents', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as unknown as RecentsPutEvent;
}

function recent(index: number, overrides: Partial<CommandPaletteRecent> = {}): CommandPaletteRecent {
  return {
    key: `pcd:1:custom_format:${index}`,
    label: `Format ${index}`,
    href: `/custom-formats/1/${index}`,
    kind: 'custom_format',
    usedAt: '2026-11-02T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Write rate limits live in process memory keyed by user id, while every test gets a fresh database
 * whose ids restart at 1; ids unique across the whole file keep each test's write budget separate.
 */
let nextUserId = 1000;

function createUser(username = `user-${crypto.randomUUID()}`): number {
  const id = nextUserId++;
  db.execute('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)', id, username, 'hash');
  assert(usersQueries.getById(id));
  return id;
}

migratedTest('recents GET/PUT return 401 without a real user (bypass null and API-token id 0)', async () => {
  // Arrange
  const body = { recents: [recent(1)] };

  // Act
  const responses = [
    await GET(getEvent(null)),
    await GET(getEvent(0)),
    await PUT(putEvent(null, body)),
    await PUT(putEvent(0, body)),
  ];

  // Assert
  for (const response of responses) {
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: 'Unauthorized' });
  }
});

migratedTest('recents GET returns an empty list when nothing is stored', async () => {
  // Arrange
  const userId = createUser();

  // Act
  const response = await GET(getEvent(userId));

  // Assert
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { recents: [], updatedAt: null });
});

migratedTest('recents PUT then GET round-trips per user', async () => {
  // Arrange
  const userId = createUser();
  const otherUserId = createUser();
  const recents = [recent(2), recent(1, { kind: 'nav', href: '/quality-profiles?tab=all#top' })];

  // Act
  const put = await PUT(putEvent(userId, { recents }));
  const get = await GET(getEvent(userId));
  const other = await GET(getEvent(otherUserId));
  const replaced = await PUT(putEvent(userId, { recents: [recent(3)] }));
  const afterReplace = await GET(getEvent(userId));

  // Assert
  assertEquals(put.status, 200);
  const putBody = (await put.json()) as { recents: CommandPaletteRecent[]; updatedAt: string };
  assertEquals(putBody.recents, recents);
  assertEquals(typeof putBody.updatedAt, 'string');
  assertEquals(await get.json(), { recents, updatedAt: putBody.updatedAt });
  assertEquals(await other.json(), { recents: [], updatedAt: null });
  assertEquals(replaced.status, 200);
  const afterReplaceBody = (await afterReplace.json()) as { recents: CommandPaletteRecent[]; updatedAt: string };
  assertEquals(afterReplaceBody.recents, [recent(3)]);
  assert(afterReplaceBody.updatedAt !== putBody.updatedAt, 'every write issues a new token');
});

migratedTest('recents PUT rejects unsafe hrefs, oversized lists, and malformed bodies', async () => {
  // Arrange
  const userId = createUser();
  const elevenItems = Array.from({ length: COMMAND_PALETTE_RECENTS_MAX + 1 }, (_, index) => recent(index));
  const invalidBodies: unknown[] = [
    { recents: [recent(1, { href: '//evil.example/path' })] },
    { recents: [recent(1, { href: 'https://evil.example/' })] },
    { recents: [recent(1, { href: '/\\evil.example' })] },
    { recents: [recent(1, { href: '/ok\nnext' })] },
    { recents: [recent(1, { href: 'javascript:alert(1)' })] },
    { recents: elevenItems },
    { recents: [recent(1), recent(1)] },
    { recents: [recent(1, { usedAt: 'yesterday' })] },
    { recents: [recent(1, { label: 'x'.repeat(201) })] },
    { recents: [recent(1, { kind: '' })] },
    { recents: 'nope' },
    { recents: [recent(1)], expectedUpdatedAt: 42 },
    { recents: [recent(1)], expectedUpdatedAt: '' },
    { recents: [recent(1)], expectedUpdatedAt: 'x'.repeat(65) },
    [recent(1)],
    '{not json',
  ];

  // Act + Assert
  for (const body of invalidBodies) {
    const response = await PUT(putEvent(userId, body));
    assertEquals(response.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 80)}`);
    assertEquals(typeof ((await response.json()) as { error: unknown }).error, 'string');
  }
  assertEquals(await (await GET(getEvent(userId))).json(), { recents: [], updatedAt: null });
});

migratedTest('recents PUT rejects an oversized declared content-length before reading the body', async () => {
  // Arrange
  const userId = createUser();
  const event = {
    locals: locals(userId),
    request: new Request('http://localhost/api/v1/ui-preferences/command-palette-recents', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 + 1) },
      body: JSON.stringify({ recents: [recent(1)] }),
    }),
  } as unknown as RecentsPutEvent;

  // Act
  const response = await PUT(event);

  // Assert
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: 'Request body too large' });
  assertEquals(event.request.bodyUsed, false);
  assertEquals(await (await GET(getEvent(userId))).json(), { recents: [], updatedAt: null });
});

type RecentsBody = { recents: CommandPaletteRecent[]; updatedAt: string | null };

migratedTest('recents PUT with expectedUpdatedAt null succeeds only for the first write', async () => {
  // Arrange
  const userId = createUser();

  // Act
  const first = await PUT(putEvent(userId, { recents: [recent(1)], expectedUpdatedAt: null }));
  const second = await PUT(putEvent(userId, { recents: [recent(2)], expectedUpdatedAt: null }));

  // Assert
  assertEquals(first.status, 200);
  const firstBody = (await first.json()) as RecentsBody;
  assertEquals(typeof firstBody.updatedAt, 'string');
  assertEquals(second.status, 409);
  assertEquals(typeof ((await second.json()) as { error: unknown }).error, 'string');
  assertEquals(await (await GET(getEvent(userId))).json(), { recents: [recent(1)], updatedAt: firstBody.updatedAt });
});

migratedTest('recents PUT with a matching expectedUpdatedAt succeeds and rotates the token', async () => {
  // Arrange
  const userId = createUser();
  const seeded = (await (await PUT(putEvent(userId, { recents: [recent(1)] }))).json()) as RecentsBody;
  const read = (await (await GET(getEvent(userId))).json()) as RecentsBody;

  // Act
  const response = await PUT(putEvent(userId, { recents: [recent(2), recent(1)], expectedUpdatedAt: read.updatedAt }));

  // Assert
  assertEquals(read.updatedAt, seeded.updatedAt);
  assertEquals(response.status, 200);
  const body = (await response.json()) as RecentsBody;
  assertEquals(body.recents, [recent(2), recent(1)]);
  assert(body.updatedAt !== null && body.updatedAt !== read.updatedAt);
});

migratedTest('recents PUT with a stale expectedUpdatedAt returns 409 and writes nothing', async () => {
  // Arrange: two tabs read the same token; tab A writes first.
  const userId = createUser();
  await PUT(putEvent(userId, { recents: [recent(1)] }));
  const { updatedAt: token } = (await (await GET(getEvent(userId))).json()) as RecentsBody;
  const tabA = (await (
    await PUT(putEvent(userId, { recents: [recent(2), recent(1)], expectedUpdatedAt: token }))
  ).json()) as RecentsBody;

  // Act: tab B writes with the now-stale token.
  const tabB = await PUT(putEvent(userId, { recents: [recent(3), recent(1)], expectedUpdatedAt: token }));

  // Assert
  assertEquals(tabB.status, 409);
  assertEquals(typeof ((await tabB.json()) as { error: unknown }).error, 'string');
  assertEquals(await (await GET(getEvent(userId))).json(), {
    recents: [recent(2), recent(1)],
    updatedAt: tabA.updatedAt,
  });
});

migratedTest("recents PUT with another user's token returns 409 (re-login on a shared browser)", async () => {
  // Arrange: a tab still holds the previous user's token after someone else signs in.
  const previousUser = createUser();
  const nextUser = createUser();
  const insert = 'INSERT INTO user_command_palette_recents (user_id, recents_json, updated_at) VALUES (?, ?, ?)';
  db.execute(insert, previousUser, JSON.stringify([recent(1)]), '2026-11-02T10:00:00.000Z');
  db.execute(insert, nextUser, JSON.stringify([recent(5)]), '2026-11-02T11:00:00.000Z');
  const { updatedAt: previousToken } = (await (await GET(getEvent(previousUser))).json()) as RecentsBody;
  const freshUser = createUser();

  // Act
  const stale = await PUT(putEvent(nextUser, { recents: [recent(1)], expectedUpdatedAt: previousToken }));
  const staleOnEmpty = await PUT(putEvent(freshUser, { recents: [recent(1)], expectedUpdatedAt: previousToken }));

  // Assert
  assertEquals(stale.status, 409);
  assertEquals(staleOnEmpty.status, 409);
  assertEquals(((await (await GET(getEvent(nextUser))).json()) as RecentsBody).recents, [recent(5)]);
  assertEquals(await (await GET(getEvent(freshUser))).json(), { recents: [], updatedAt: null });
});

migratedTest('recents PUT returns 429 after 8 writes in the rate-limit window', async () => {
  // Arrange
  const userId = createUser();
  const statuses: number[] = [];

  // Act
  for (let index = 0; index < 9; index++) {
    statuses.push((await PUT(putEvent(userId, { recents: [recent(index)] }))).status);
  }

  // Assert
  assertEquals(statuses.slice(0, 8), Array(8).fill(200));
  assertEquals(statuses[8], 429);
  assertEquals(((await (await GET(getEvent(userId))).json()) as RecentsBody).recents, [recent(7)]);
});

migratedTest('recents GET degrades malformed stored JSON to an empty or sanitized list', async () => {
  // Arrange
  const brokenUserId = createUser();
  const mixedUserId = createUser();
  db.execute(
    'INSERT INTO user_command_palette_recents (user_id, recents_json) VALUES (?, ?)',
    brokenUserId,
    '{not valid json'
  );
  db.execute(
    'INSERT INTO user_command_palette_recents (user_id, recents_json) VALUES (?, ?)',
    mixedUserId,
    JSON.stringify([recent(1, { href: '//evil' }), recent(2), 'junk'])
  );

  // Act
  const broken = await GET(getEvent(brokenUserId));
  const mixed = await GET(getEvent(mixedUserId));

  // Assert
  assertEquals(broken.status, 200);
  assertEquals(((await broken.json()) as { recents: unknown }).recents, []);
  assertEquals(((await mixed.json()) as { recents: unknown }).recents, [recent(2)]);
});

migratedTest('recents rows are removed with their user', () => {
  // Arrange
  const userId = createUser();
  db.execute(
    'INSERT INTO user_command_palette_recents (user_id, recents_json) VALUES (?, ?)',
    userId,
    JSON.stringify([recent(1)])
  );

  // Act
  db.execute('DELETE FROM users WHERE id = ?', userId);

  // Assert
  const row = db.queryFirst('SELECT user_id FROM user_command_palette_recents WHERE user_id = ?', userId);
  assertEquals(row, undefined);
});

Deno.test('shared recents validator and sanitizer enforce the contract', () => {
  // Arrange
  const valid = [recent(1), recent(2)];

  // Act + Assert
  assertEquals(validateCommandPaletteRecents(valid), { ok: true, recents: valid });
  assertEquals(validateCommandPaletteRecents([{ ...recent(1), extra: 'dropped' }]), {
    ok: true,
    recents: [recent(1)],
  });
  assert(!validateCommandPaletteRecents([recent(1, { href: '//evil' })]).ok);
  assert(isSafeRelativeHref('/arr/1/sync'));
  assert(!isSafeRelativeHref('//evil'));
  assert(!isSafeRelativeHref('/a\\b'));
  assert(!isSafeRelativeHref('/a\u0000b'));
  assert(!isSafeRelativeHref('relative'));
  assertEquals(sanitizeCommandPaletteRecents('nope'), []);
  assertEquals(
    sanitizeCommandPaletteRecents([
      recent(1),
      recent(1, { label: 'dup' }),
      ...Array.from({ length: 12 }, (_, i) => recent(i + 2)),
    ]).length,
    COMMAND_PALETTE_RECENTS_MAX
  );
});
