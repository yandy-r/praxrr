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

function createUser(username = `user-${crypto.randomUUID()}`): number {
  const id = usersQueries.create(username, 'hash');
  assert(id > 0);
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
  assertEquals(await response.json(), { recents: [] });
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
  assertEquals(await put.json(), { recents });
  assertEquals(await get.json(), { recents });
  assertEquals(await other.json(), { recents: [] });
  assertEquals(replaced.status, 200);
  assertEquals(await afterReplace.json(), { recents: [recent(3)] });
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
    [recent(1)],
    '{not json',
  ];

  // Act + Assert
  for (const body of invalidBodies) {
    const response = await PUT(putEvent(userId, body));
    assertEquals(response.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 80)}`);
    assertEquals(typeof ((await response.json()) as { error: unknown }).error, 'string');
  }
  assertEquals(await (await GET(getEvent(userId))).json(), { recents: [] });
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
  assertEquals(await (await GET(getEvent(userId))).json(), { recents: [] });
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
  assertEquals(await broken.json(), { recents: [] });
  assertEquals(await mixed.json(), { recents: [recent(2)] });
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
