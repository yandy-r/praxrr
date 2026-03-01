import { assertEquals } from '@std/assert';
import { type DatabaseInstance, databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { GET as getChangesRoute } from '../../routes/api/databases/[id]/changes/+server.ts';
import { GET as getCommitsRoute } from '../../routes/api/databases/[id]/commits/+server.ts';

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: unknown,
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement as T[K];
  restores.push(() => {
    target[key] = original;
  });
}

function buildLocalSourceDatabase(): DatabaseInstance {
  return {
    id: 1,
    uuid: crypto.randomUUID(),
    name: 'Local Source',
    repository_url: '/praxrr-db',
    local_path: '/config/data/databases/local-source',
    sync_strategy: 60,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    has_personal_access_token: 0,
    is_private: 0,
    local_ops_enabled: 0,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

Deno.test('database changes route returns graceful payload for local sources without git metadata', async () => {
  const restores: Restore[] = [];
  const database = buildLocalSourceDatabase();
  const localPath = Deno.makeTempDirSync();
  database.local_path = localPath;

  patchTarget(databaseInstancesQueries, 'getById', () => database, restores);

  try {
    const response = await getChangesRoute({
      params: { id: '1' },
    } as unknown as Parameters<typeof getChangesRoute>[0]);
    const payload = (await response.json()) as {
      gitUnavailable: boolean;
      branches: string[];
      status: { modified: string[]; untracked: string[]; staged: string[] };
      incomingChanges: { hasUpdates: boolean; commitsBehind: number; commits: unknown[] };
    };

    assertEquals(response.status, 200);
    assertEquals(payload.gitUnavailable, true);
    assertEquals(payload.branches, []);
    assertEquals(payload.status.modified, []);
    assertEquals(payload.status.untracked, []);
    assertEquals(payload.status.staged, []);
    assertEquals(payload.incomingChanges.hasUpdates, false);
    assertEquals(payload.incomingChanges.commitsBehind, 0);
    assertEquals(payload.incomingChanges.commits, []);
  } finally {
    for (const restore of restores.reverse()) restore();
    Deno.removeSync(localPath, { recursive: true });
  }
});

Deno.test('database commits route returns graceful payload for local sources without git metadata', async () => {
  const restores: Restore[] = [];
  const database = buildLocalSourceDatabase();
  const localPath = Deno.makeTempDirSync();
  database.local_path = localPath;

  patchTarget(databaseInstancesQueries, 'getById', () => database, restores);

  try {
    const response = await getCommitsRoute({
      params: { id: '1' },
      url: new URL('http://localhost/api/databases/1/commits?limit=25'),
    } as unknown as Parameters<typeof getCommitsRoute>[0]);
    const payload = (await response.json()) as {
      commits: unknown[];
      branch: string;
      gitUnavailable: boolean;
    };

    assertEquals(response.status, 200);
    assertEquals(payload.commits, []);
    assertEquals(payload.branch, '');
    assertEquals(payload.gitUnavailable, true);
  } finally {
    for (const restore of restores.reverse()) restore();
    Deno.removeSync(localPath, { recursive: true });
  }
});
