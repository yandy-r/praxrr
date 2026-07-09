import { assertEquals } from '@std/assert';
import type { User } from '../../lib/server/db/queries/users.ts';
import { resolveNavShell } from '../../lib/server/navigation/resolver.ts';

const shellUser = {
  id: 1,
  username: 'test-user',
  password_hash: 'hash',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
} as User;

Deno.test('app layout shell is stable and deep-link hrefs remain unchanged', () => {
  const first = resolveNavShell({ user: shellUser });
  const second = resolveNavShell({ user: shellUser });

  assertEquals(first, second);
  assertEquals(first.variant, 'legacy');

  const topLevelHrefs = first.groups.flatMap((group) => group.items.map((item) => item.href));
  assertEquals(topLevelHrefs, [
    '/databases',
    '/parity-map',
    '/resolved-config',
    '/dependency-graph',
    '/drift',
    '/arr',
    '/quality-profiles',
    '/custom-formats',
    '/regular-expressions',
    '/media-management',
    '/delay-profiles',
    '/metadata-profiles',
    '/score-simulator',
    '/impact-simulator',
    '/sync-history',
    '/settings',
  ]);

  const deepLinks: string[] = [];
  for (const group of first.groups) {
    for (const item of group.items) {
      deepLinks.push(item.href, ...item.children.map((child) => child.href));
    }
  }
  assertEquals(deepLinks, [
    '/databases',
    '/parity-map',
    '/resolved-config',
    '/dependency-graph',
    '/drift',
    '/arr',
    '/quality-profiles',
    '/quality-profiles/entity-testing',
    '/custom-formats',
    '/regular-expressions',
    '/media-management',
    '/media-management?section=naming',
    '/media-management?section=quality-definitions',
    '/media-management?section=media-settings',
    '/delay-profiles',
    '/metadata-profiles',
    '/score-simulator',
    '/impact-simulator',
    '/sync-history',
    '/settings',
    '/settings/general',
    '/settings/jobs',
    '/settings/logs',
    '/settings/backups',
    '/settings/notifications',
    '/settings/security',
    '/settings/about',
    '/auth/logout',
  ]);
});
