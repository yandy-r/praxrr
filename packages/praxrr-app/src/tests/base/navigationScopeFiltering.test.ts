import { assertEquals } from '@std/assert';
import { supportsFeature, type ArrAppType } from '../../lib/shared/arr/capabilities.ts';
import { resolveNavShell } from '../../lib/server/navigation/resolver.ts';
import { NAV_REGISTRY } from '../../lib/server/navigation/registry.ts';
import type { User } from '../../lib/server/db/queries/users.ts';
import type { ArrType } from '../../lib/shared/pcd/types.ts';
import type { NavShell } from '../../lib/shared/navigation/types.ts';

type Restore = () => void;

type ScopeMode = 'visible' | 'disabled';

interface ScopedItem {
  id: string;
  href: string;
  mode: ScopeMode;
}

interface ScopedResult {
  visible: string[];
  disabled: string[];
}

function resolveScopeEntries(scope: ArrType, shell: NavShell): ScopedResult {
  const scopedItems: ScopedItem[] = [];

  for (const group of shell.groups) {
    for (const item of group.items as ((typeof group.items)[number] & { requiredFeature?: string })[]) {
      const requiredFeature = item.requiredFeature;

      if (scope === 'all' || !requiredFeature) {
        scopedItems.push({
          id: item.id,
          href: item.href,
          mode: 'visible',
        });
        continue;
      }

      if (supportsFeature(scope, requiredFeature)) {
        scopedItems.push({
          id: item.id,
          href: item.href,
          mode: 'visible',
        });
        continue;
      }

      if (item.hasChildren) {
        scopedItems.push({
          id: item.id,
          href: item.href,
          mode: 'disabled',
        });
      }
    }
  }

  const visible = scopedItems.filter((entry) => entry.mode === 'visible').map((entry) => entry.id);
  const disabled = scopedItems.filter((entry) => entry.mode === 'disabled').map((entry) => entry.id);

  return { visible, disabled };
}

function isScopedItemVisible(scope: ArrType, requiredFeature: string | undefined): boolean {
  if (scope === 'all' || !requiredFeature) {
    return true;
  }

  return supportsFeature(scope, requiredFeature);
}

function buildBottomNavOrder(shell: NavShell, scope: ArrType): string[] {
  const flattened: Array<{ href: string; priority: 'always' | 'medium' | 'low'; sourceIndex: number }> = [];
  const priorityOrder = {
    always: 0,
    medium: 1,
    low: 2,
  } as const;
  let sourceIndex = 0;

  for (const group of shell.groups) {
    for (const item of group.items as ((typeof group.items)[number] & { requiredFeature?: string })[]) {
      if (!isScopedItemVisible(scope, item.requiredFeature)) {
        continue;
      }

      flattened.push({
        href: item.href,
        priority: item.mobilePriority,
        sourceIndex: sourceIndex++,
      });
    }
  }

  return flattened
    .sort((left, right) => {
      const byPriority = priorityOrder[left.priority] - priorityOrder[right.priority];

      if (byPriority !== 0) {
        return byPriority;
      }

      return left.sourceIndex - right.sourceIndex;
    })
    .map((item) => item.href);
}

const scopeUser = {
  id: 1,
  username: 'test-user',
  password_hash: 'hash',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
} as User;

Deno.test('scope filtering respects Arr capability constraints', () => {
  const shell = resolveNavShell({ user: scopeUser });
  const scopeAll = resolveScopeEntries('all', shell);
  const scopeLidarr = resolveScopeEntries('lidarr', shell);
  const scopeRadarr = resolveScopeEntries('radarr', shell);
  const scopeSonarr = resolveScopeEntries('sonarr', shell);

  assertEquals(scopeAll.visible.includes('policies.metadata_profiles'), true);
  assertEquals(scopeLidarr.visible.includes('policies.metadata_profiles'), true);
  assertEquals(scopeRadarr.visible.includes('policies.metadata_profiles'), false);
  assertEquals(scopeSonarr.visible.includes('policies.metadata_profiles'), false);

  assertEquals(scopeRadarr.disabled.includes('policies.metadata_profiles'), false);
  assertEquals(scopeSonarr.disabled.includes('policies.metadata_profiles'), false);
  assertEquals(supportsFeature('radarr' as ArrAppType, 'metadata_profiles'), false);
  assertEquals(supportsFeature('sonarr' as ArrAppType, 'metadata_profiles'), false);
  assertEquals(supportsFeature('lidarr' as ArrAppType, 'metadata_profiles'), true);
});

Deno.test('unsupported child-ful nav items are disabled while unsupported leaves are hidden', () => {
  const restores: Restore[] = [];
  const originalRegistry = [...NAV_REGISTRY];

  restores.push(() => {
    NAV_REGISTRY.length = 0;
    NAV_REGISTRY.push(...originalRegistry);
  });

  try {
    const synthetic = {
      id: 'policies.scope_sync_child',
      label: 'Scope Sync Child',
      href: '/scope-sync-child',
      groupId: 'policies',
      order: 99,
      arrScope: 'all',
      mobilePriority: 'low',
      iconKey: 'Tag',
      hasChildren: true,
      requiredFeature: 'metadata_profiles',
      children: [
        {
          id: 'policies.scope_sync_child.children',
          label: 'Scope Child',
          href: '/scope-sync-child/child',
          order: 0,
        },
      ],
    };

    NAV_REGISTRY.push(synthetic as (typeof NAV_REGISTRY)[number]);

    const shell = resolveNavShell({ user: scopeUser });
    const radarrScope = resolveScopeEntries('radarr', shell);

    assertEquals(radarrScope.visible.includes('policies.scope_sync_child'), false);
    assertEquals(radarrScope.disabled.includes('policies.scope_sync_child'), true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('bottom nav ordering is deterministic by priority and sidebar traversal', () => {
  const shell = resolveNavShell({ user: scopeUser });
  const shellWithoutDev = shell.groups.filter((group) => group.id !== 'dev');
  const sidebarOrder = shellWithoutDev.flatMap((group) => group.items.map((item) => item.href));

  assertEquals(sidebarOrder, [
    '/databases',
    '/parity-map',
    '/resolved-config',
    '/dependency-graph',
    '/drift',
    '/config-health',
    '/security-posture',
    '/arr',
    '/quality-profiles',
    '/custom-formats',
    '/regular-expressions',
    '/media-management',
    '/delay-profiles',
    '/metadata-profiles',
    '/score-simulator',
    '/impact-simulator',
    '/goals',
    '/sync-history',
    '/canary',
    '/timeline',
    '/settings',
  ]);

  assertEquals(buildBottomNavOrder({ ...shell, groups: shellWithoutDev }, 'all'), [
    '/databases',
    '/arr',
    '/quality-profiles',
    '/custom-formats',
    '/settings',
    '/parity-map',
    '/resolved-config',
    '/dependency-graph',
    '/drift',
    '/config-health',
    '/security-posture',
    '/regular-expressions',
    '/score-simulator',
    '/impact-simulator',
    '/goals',
    '/sync-history',
    '/canary',
    '/timeline',
    '/media-management',
    '/delay-profiles',
    '/metadata-profiles',
  ]);

  assertEquals(
    buildBottomNavOrder({ ...shell, groups: shellWithoutDev }, 'radarr').includes('/metadata-profiles'),
    false
  );
});

Deno.test('arr navigation remains scope-compatible while feature-gated routes stay constrained', () => {
  const shell = resolveNavShell({ user: scopeUser });
  const shellWithoutDev = shell.groups.filter((group) => group.id !== 'dev');
  const scopes: ArrType[] = ['all', 'radarr', 'sonarr', 'lidarr'];

  for (const scope of scopes) {
    const scopedEntries = resolveScopeEntries(scope, { ...shell, groups: shellWithoutDev });
    const bottomOrder = buildBottomNavOrder({ ...shell, groups: shellWithoutDev }, scope);

    assertEquals(scopedEntries.visible.includes('apps.arrs'), true);
    assertEquals(bottomOrder.includes('/arr'), true);
    assertEquals(bottomOrder.includes('/quality-profiles'), true);
    assertEquals(bottomOrder.includes('/custom-formats'), true);
  }

  assertEquals(
    buildBottomNavOrder({ ...shell, groups: shellWithoutDev }, 'radarr').includes('/metadata-profiles'),
    false
  );
  assertEquals(
    buildBottomNavOrder({ ...shell, groups: shellWithoutDev }, 'sonarr').includes('/metadata-profiles'),
    false
  );
  assertEquals(
    buildBottomNavOrder({ ...shell, groups: shellWithoutDev }, 'lidarr').includes('/metadata-profiles'),
    true
  );

  const visibleTopLevelHrefs = shellWithoutDev.flatMap((group) => group.items.map((item) => item.href));
  // Guards against sync sub-routes (e.g. /sync/preview) leaking into top-level nav; the
  // /sync-history audit trail is an intentional top-level operations route.
  assertEquals(
    visibleTopLevelHrefs.some((href) => href.includes('/sync/')),
    false
  );
});
