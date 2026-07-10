import { assertEquals } from '@std/assert';
import { load as impactSimulatorLandingLoad } from '../../routes/impact-simulator/+page.server.ts';
import { pcdManager } from '$pcd/index.ts';
import type { DatabaseInstance } from '$db/queries/databaseInstances.ts';

const DATABASES: DatabaseInstance[] = [
  {
    id: 42,
    uuid: 'impact-simulator-db',
    name: 'Impact Simulator DB',
    repository_url: 'https://example.com/impact-simulator-db',
    local_path: '/tmp/impact-simulator-db',
    sync_strategy: 0,
    auto_pull: 1,
    enabled: 1,
    personal_access_token: null,
    has_personal_access_token: 0,
    is_private: 0,
    local_ops_enabled: 1,
    git_user_name: null,
    git_user_email: null,
    conflict_strategy: 'override',
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

Deno.test('impact simulator landing supplies databases for route selection', async () => {
  const originalGetAll = pcdManager.getAll;
  pcdManager.getAll = () => DATABASES;

  try {
    const payload = await impactSimulatorLandingLoad({} as Parameters<typeof impactSimulatorLandingLoad>[0]);

    assertEquals(payload, { databases: DATABASES });
  } finally {
    pcdManager.getAll = originalGetAll;
  }
});
