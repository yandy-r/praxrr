import { assertEquals, assertRejects } from '@std/assert';
import { HttpError } from '$http/types.ts';
import type { BaseArrClient } from '$utils/arr/base.ts';
import type { RadarrMovie, SonarrSeries, LidarrArtist } from '$utils/arr/types.ts';
import { RadarrClient } from '$utils/arr/clients/radarr.ts';
import { SonarrClient } from '$utils/arr/clients/sonarr.ts';
import { LidarrClient } from '$utils/arr/clients/lidarr.ts';
import type { ArrManagedEntity, ManagedSourceKind } from '$db/queries/arrManagedEntities.ts';
import { arrManagedEntitiesQueries } from '$db/queries/arrManagedEntities.ts';
import { executePrunes } from '$sync/ownership/executePrunes.ts';
import { loadInUseQualityProfileIds } from '$sync/ownership/qualityProfileInUse.ts';
import {
  IN_USE_UNVERIFIED_REASON,
  planPrunes,
  QP_IN_USE_REASON,
  type PruneLiveEntity,
  type PrunePlanItem,
} from '$sync/ownership/planPrunes.ts';

const NS = '\u200b';

function ledgerRow(overrides: Partial<ArrManagedEntity> = {}): ArrManagedEntity {
  return {
    instanceId: 1,
    section: 'qualityProfiles',
    entityType: 'customFormat',
    remoteId: 10,
    arrName: 'Old CF' + NS,
    pcdName: 'Old CF',
    databaseId: 3,
    sourceKind: 'pcd' as ManagedSourceKind,
    firstSyncedAt: '2026-01-01T00:00:00.000Z',
    lastSyncedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface PlannerFixture {
  ledger?: ArrManagedEntity[];
  liveCustomFormats?: PruneLiveEntity[];
  liveQualityProfiles?: PruneLiveEntity[];
  isKept?: (name: string) => boolean;
  desiredCustomFormatNames?: ReadonlySet<string>;
  desiredQualityProfileNames?: ReadonlySet<string>;
  referencedCustomFormatNames?: ReadonlySet<string>;
  inUseQualityProfileIds?: ReadonlySet<number> | null;
}

function runPlanner(fixture: PlannerFixture = {}) {
  return planPrunes({
    ledger: fixture.ledger ?? [],
    isKept: fixture.isKept ?? (() => false),
    desiredCustomFormatNames: fixture.desiredCustomFormatNames ?? new Set<string>(),
    desiredQualityProfileNames: fixture.desiredQualityProfileNames ?? new Set<string>(),
    referencedCustomFormatNames: fixture.referencedCustomFormatNames ?? new Set<string>(),
    liveCustomFormats: fixture.liveCustomFormats ?? [],
    liveQualityProfiles: fixture.liveQualityProfiles ?? [],
    inUseQualityProfileIds:
      fixture.inUseQualityProfileIds !== undefined ? fixture.inUseQualityProfileIds : new Set<number>(),
  });
}

Deno.test('planPrunes: a hand-made CF with no ledger row is never planned', () => {
  const result = runPlanner({
    liveCustomFormats: [{ id: 77, name: 'Hand-made' }],
    ledger: [],
  });
  assertEquals(result.prunes, []);
  assertEquals(result.blocked, []);
});

Deno.test('planPrunes: id match with a name mismatch is not planned', () => {
  // The live id 10 was recreated under a different name: Praxrr no longer owns it.
  const result = runPlanner({
    ledger: [ledgerRow({ arrName: 'Old CF' + NS })],
    liveCustomFormats: [{ id: 10, name: 'Renamed by hand' }],
  });
  assertEquals(result.prunes, []);
  // A ledger row with no live id match at all is skipped silently too.
  const noLive = runPlanner({ ledger: [ledgerRow()] });
  assertEquals(noLive.prunes, []);
});

Deno.test('planPrunes: a kept namespace is not planned', () => {
  const result = runPlanner({
    ledger: [ledgerRow()],
    liveCustomFormats: [{ id: 10, name: 'Old CF' + NS }],
    isKept: () => true,
  });
  assertEquals(result.prunes, []);
  assertEquals(result.blocked, []);
});

Deno.test('planPrunes: desired and referenced CFs are not planned', () => {
  const desired = runPlanner({
    ledger: [ledgerRow({ remoteId: 10, arrName: 'Desired CF' + NS })],
    liveCustomFormats: [{ id: 10, name: 'Desired CF' + NS }],
    desiredCustomFormatNames: new Set(['Desired CF' + NS]),
  });
  assertEquals(desired.prunes, []);

  const referenced = runPlanner({
    ledger: [ledgerRow({ remoteId: 11, arrName: 'Scored CF' + NS })],
    liveCustomFormats: [{ id: 11, name: 'Scored CF' + NS }],
    referencedCustomFormatNames: new Set(['Scored CF' + NS]),
  });
  assertEquals(referenced.prunes, []);
});

Deno.test('planPrunes: a CF scored by a blocked QP is not planned', () => {
  const cfRow = ledgerRow({ remoteId: 11, arrName: 'Blocked CF' + NS, pcdName: 'Blocked CF' });
  const qpRow = ledgerRow({
    entityType: 'qualityProfile',
    remoteId: 5,
    arrName: 'Old QP' + NS,
    pcdName: 'Old QP',
  });

  const result = runPlanner({
    ledger: [cfRow, qpRow],
    liveCustomFormats: [{ id: 11, name: 'Blocked CF' + NS }],
    liveQualityProfiles: [
      {
        id: 5,
        name: 'Old QP' + NS,
        formatItems: [
          { format: 11, name: 'Blocked CF' + NS, score: 100 },
          { format: 12, name: 'Zero CF' + NS, score: 0 },
        ],
      },
    ],
    inUseQualityProfileIds: new Set([5]),
  });

  assertEquals(result.prunes, []);
  assertEquals(result.blocked, [
    {
      entityType: 'qualityProfile',
      remoteId: 5,
      name: 'Old QP' + NS,
      reason: QP_IN_USE_REASON,
    },
  ]);
});

Deno.test('planPrunes: an in-use QP is blocked and a zero-score CF is still pruned', () => {
  const qpRow = ledgerRow({
    entityType: 'qualityProfile',
    remoteId: 5,
    arrName: 'Old QP' + NS,
    pcdName: 'Old QP',
  });
  const cfRow = ledgerRow({ remoteId: 11, arrName: 'Dangling CF' + NS, pcdName: 'Dangling CF' });

  const result = runPlanner({
    ledger: [cfRow, qpRow],
    liveCustomFormats: [{ id: 11, name: 'Dangling CF' + NS }],
    liveQualityProfiles: [
      {
        id: 5,
        name: 'Old QP' + NS,
        formatItems: [{ format: 11, name: 'Dangling CF' + NS, score: 0 }],
      },
    ],
    inUseQualityProfileIds: new Set([5]),
  });

  assertEquals(result.prunes, [
    {
      entityType: 'customFormat',
      remoteId: 11,
      arrName: 'Dangling CF' + NS,
      pcdName: 'Dangling CF',
      sourceKind: 'pcd',
      databaseId: 3,
    },
  ]);
  assertEquals(result.blocked, [
    {
      entityType: 'qualityProfile',
      remoteId: 5,
      name: 'Old QP' + NS,
      reason: QP_IN_USE_REASON,
    },
  ]);
});

Deno.test('planPrunes: a null in-use set blocks every QP candidate', () => {
  const qpRow = ledgerRow({
    entityType: 'qualityProfile',
    remoteId: 5,
    arrName: 'Old QP' + NS,
    pcdName: 'Old QP',
  });

  const result = runPlanner({
    ledger: [qpRow],
    liveQualityProfiles: [{ id: 5, name: 'Old QP' + NS }],
    inUseQualityProfileIds: null,
  });

  assertEquals(result.prunes, []);
  assertEquals(result.blocked, [
    {
      entityType: 'qualityProfile',
      remoteId: 5,
      name: 'Old QP' + NS,
      reason: IN_USE_UNVERIFIED_REASON,
    },
  ]);
});

Deno.test('planPrunes: QP prunes are ordered before CF prunes', () => {
  const qpRow = ledgerRow({
    entityType: 'qualityProfile',
    remoteId: 5,
    arrName: 'Old QP' + NS,
    pcdName: 'Old QP',
  });
  const cfRow = ledgerRow({ remoteId: 11, arrName: 'Old CF' + NS, pcdName: 'Old CF' });

  const result = runPlanner({
    // Ledger order has the CF first; the plan must still delete the QP first.
    ledger: [cfRow, qpRow],
    liveCustomFormats: [{ id: 11, name: 'Old CF' + NS }],
    liveQualityProfiles: [{ id: 5, name: 'Old QP' + NS }],
    inUseQualityProfileIds: new Set<number>(),
  });

  assertEquals(
    result.prunes.map((item) => item.entityType),
    ['qualityProfile', 'customFormat']
  );
});

Deno.test('planPrunes: every surviving live profile protects its nonzero-scored formats', () => {
  for (const formatItem of [
    { format: 10, score: 100 },
    { name: 'Old CF' + NS, score: -5 },
  ]) {
    for (const profile of [
      { id: 99, name: 'Hand-made', formatItems: [formatItem] },
      { id: 5, name: 'Renamed by user', formatItems: [formatItem] },
    ]) {
      const result = runPlanner({
        ledger: [ledgerRow(), ledgerRow({ entityType: 'qualityProfile', remoteId: 5, arrName: 'Old QP' + NS })],
        liveCustomFormats: [{ id: 10, name: 'Old CF' + NS }],
        liveQualityProfiles: [profile],
      });
      assertEquals(result.prunes, []);
    }
  }
});

// =============================================================================
// executePrunes (fake client; deleteConfirmed is stubbed on the imported object)
// =============================================================================

interface FakePruneClient {
  deleteCalls: { method: 'cf' | 'qp'; id: number }[];
}

function fakePruneClient(
  behavior: {
    cf?: (id: number) => void;
    qp?: (id: number) => void;
  } = {}
): { client: BaseArrClient; state: FakePruneClient } {
  const state: FakePruneClient = { deleteCalls: [] };
  const client = {
    getCustomFormat: async () => ({ id: 11, name: 'Old CF' + NS }),
    getQualityProfile: async () => ({ id: 5, name: 'Old QP' + NS }),
    deleteCustomFormat: async (id: number) => {
      state.deleteCalls.push({ method: 'cf', id });
      behavior.cf?.(id);
    },
    deleteQualityProfile: async (id: number) => {
      state.deleteCalls.push({ method: 'qp', id });
      behavior.qp?.(id);
    },
  };
  return { client: client as unknown as BaseArrClient, state };
}

function withDeleteConfirmedStub(): { deletedIds: string[]; restore: () => void } {
  const deletedIds: string[] = [];
  const original = arrManagedEntitiesQueries.deleteConfirmed;
  arrManagedEntitiesQueries.deleteConfirmed = (_instanceId: number, entityType: string, remoteId: number) => {
    deletedIds.push(`${entityType}:${remoteId}`);
  };
  return {
    deletedIds,
    restore: () => {
      arrManagedEntitiesQueries.deleteConfirmed = original;
    },
  };
}

function planItem(overrides: Partial<PrunePlanItem> = {}): PrunePlanItem {
  return {
    entityType: 'qualityProfile',
    remoteId: 5,
    arrName: 'Old QP' + NS,
    pcdName: 'Old QP',
    sourceKind: 'pcd',
    databaseId: 3,
    ...overrides,
  };
}

Deno.test('executePrunes: a successful delete emits an outcome and drops the ledger row', async () => {
  const { client, state } = fakePruneClient();
  const stub = withDeleteConfirmedStub();

  try {
    const outcomes = await executePrunes(
      client,
      1,
      'radarr',
      [
        planItem(),
        planItem({
          entityType: 'customFormat',
          remoteId: 11,
          arrName: 'Old CF' + NS,
          pcdName: 'Old CF',
        }),
      ],
      {
        customFormats: [{ id: 11, name: 'Old CF' + NS }],
        qualityProfiles: [{ id: 5, name: 'Old QP' + NS }],
      }
    );

    assertEquals(
      state.deleteCalls.map((call) => call.method),
      ['qp', 'cf']
    );
    assertEquals(outcomes, [
      {
        section: 'qualityProfiles',
        arrType: 'radarr',
        entityType: 'qualityProfile',
        name: 'Old QP',
        action: 'delete',
        status: 'success',
        remoteId: '5',
        reason: null,
      },
      {
        section: 'qualityProfiles',
        arrType: 'radarr',
        entityType: 'customFormat',
        name: 'Old CF',
        action: 'delete',
        status: 'success',
        remoteId: '11',
        reason: null,
      },
    ]);
    assertEquals(stub.deletedIds, ['qualityProfile:5', 'customFormat:11']);
  } finally {
    stub.restore();
  }
});

Deno.test('executePrunes: an HTTP 404 is treated as success and drops the row', async () => {
  const { client, state } = fakePruneClient({
    cf: () => {
      throw new HttpError('HTTP 404: Not Found', 404);
    },
  });
  const stub = withDeleteConfirmedStub();

  try {
    const outcomes = await executePrunes(
      client,
      1,
      'radarr',
      [
        planItem({
          entityType: 'customFormat',
          remoteId: 11,
          arrName: 'Old CF' + NS,
          pcdName: 'Old CF',
        }),
      ],
      {
        customFormats: [{ id: 11, name: 'Old CF' + NS }],
        qualityProfiles: [],
      }
    );

    assertEquals(state.deleteCalls.length, 1);
    assertEquals(outcomes[0].status, 'success');
    assertEquals(outcomes[0].reason, null);
    assertEquals(stub.deletedIds, ['customFormat:11']);
  } finally {
    stub.restore();
  }
});

Deno.test('executePrunes: any other error fails the outcome and keeps the ledger row', async () => {
  const { client } = fakePruneClient({
    qp: () => {
      throw new HttpError('HTTP 500: Internal Server Error | boom', 500);
    },
  });
  const stub = withDeleteConfirmedStub();

  try {
    const outcomes = await executePrunes(client, 1, 'radarr', [planItem()], {
      customFormats: [],
      qualityProfiles: [{ id: 5, name: 'Old QP' + NS }],
    });

    assertEquals(outcomes.length, 1);
    assertEquals(outcomes[0].status, 'failed');
    assertEquals(outcomes[0].reason, 'The Arr instance returned an error (HTTP 500).');
    assertEquals(stub.deletedIds, []);
  } finally {
    stub.restore();
  }
});

Deno.test('executePrunes: a guard mismatch throws before any DELETE call', async () => {
  const { client, state } = fakePruneClient();
  const original = arrManagedEntitiesQueries.deleteConfirmed;
  arrManagedEntitiesQueries.deleteConfirmed = () => {
    throw new Error('must not be called');
  };

  try {
    await assertRejects(
      () =>
        executePrunes(
          client,
          1,
          'radarr',
          [
            planItem(),
            planItem({
              entityType: 'customFormat',
              remoteId: 12,
              arrName: 'Drifted CF' + NS,
              pcdName: 'Drifted CF',
            }),
          ],
          {
            // CF guard has a different name for id 12.
            customFormats: [{ id: 12, name: 'Renamed CF' + NS }],
            qualityProfiles: [{ id: 5, name: 'Old QP' + NS }],
          }
        ),
      Error,
      'Prune guard mismatch for customFormat "Drifted CF'
    );
    assertEquals(state.deleteCalls, []);
  } finally {
    arrManagedEntitiesQueries.deleteConfirmed = original;
  }
});
Deno.test('executePrunes: a failed or renamed profile protects its scored formats', async () => {
  for (const renamed of [false, true]) {
    const { client, state } = fakePruneClient({
      qp: () => {
        throw new Error('delete refused');
      },
    });
    const profile = {
      id: 5,
      name: 'Old QP' + NS,
      formatItems: [renamed ? { name: 'Old CF' + NS, score: -50 } : { format: 11, score: 50 }],
    };
    client.getQualityProfile = async () => ({ ...profile, name: renamed ? 'Renamed' : profile.name }) as never;
    const stub = withDeleteConfirmedStub();
    try {
      const outcomes = await executePrunes(
        client,
        1,
        'radarr',
        [planItem(), planItem({ entityType: 'customFormat', remoteId: 11, arrName: 'Old CF' + NS })],
        { customFormats: [{ id: 11, name: 'Old CF' + NS }], qualityProfiles: [profile] }
      );
      assertEquals(state.deleteCalls, renamed ? [] : [{ method: 'qp', id: 5 }]);
      assertEquals(
        outcomes.map(({ status }) => status),
        [renamed ? 'skipped' : 'failed', 'skipped']
      );
      assertEquals(stub.deletedIds, []);
    } finally {
      stub.restore();
    }
  }
});

Deno.test('executePrunes: live rename skips DELETE and keeps ownership', async () => {
  const { client, state } = fakePruneClient();
  client.getCustomFormat = async () => ({ id: 11, name: 'Renamed' }) as never;
  const stub = withDeleteConfirmedStub();
  try {
    const outcomes = await executePrunes(
      client,
      1,
      'radarr',
      [planItem({ entityType: 'customFormat', remoteId: 11, arrName: 'Old CF' + NS })],
      { customFormats: [{ id: 11, name: 'Old CF' + NS }], qualityProfiles: [] }
    );
    assertEquals(state.deleteCalls, []);
    assertEquals(outcomes[0].status, 'skipped');
    assertEquals(outcomes[0].reason, 'Arr entity changed since review; not deleted');
    assertEquals(stub.deletedIds, []);
  } finally {
    stub.restore();
  }
});
Deno.test('executePrunes: a fresh GET 404 drops ownership without issuing DELETE', async () => {
  const { client, state } = fakePruneClient();
  client.getCustomFormat = async () => {
    throw new HttpError('HTTP 404: Not Found', 404);
  };
  const stub = withDeleteConfirmedStub();
  try {
    const outcomes = await executePrunes(
      client,
      1,
      'radarr',
      [planItem({ entityType: 'customFormat', remoteId: 11, arrName: 'Old CF' + NS })],
      { customFormats: [{ id: 11, name: 'Old CF' + NS }], qualityProfiles: [] }
    );
    assertEquals(state.deleteCalls, []);
    assertEquals(outcomes[0].status, 'success');
    assertEquals(stub.deletedIds, ['customFormat:11']);
  } finally {
    stub.restore();
  }
});

// =============================================================================
// loadInUseQualityProfileIds (real client classes with stubbed media fetchers)
// =============================================================================

Deno.test('loadInUseQualityProfileIds: radarr collects movie profile ids', async () => {
  const client = new RadarrClient('http://localhost:7878', 'key');
  // Only the profile-id field matters here; the rest of the media shape is stubbed away.
  client.getMovies = () =>
    Promise.resolve([
      { qualityProfileId: 5 },
      { qualityProfileId: 5 },
      { qualityProfileId: 0 },
    ] as unknown as RadarrMovie[]);
  assertEquals(await loadInUseQualityProfileIds(client, 'radarr'), new Set([5]));
});

Deno.test('loadInUseQualityProfileIds: sonarr collects series profile ids', async () => {
  const client = new SonarrClient('http://localhost:8989', 'key');
  client.getAllSeries = () =>
    Promise.resolve([{ qualityProfileId: 3 }, { qualityProfileId: 8 }] as unknown as SonarrSeries[]);
  assertEquals(await loadInUseQualityProfileIds(client, 'sonarr'), new Set([3, 8]));
});

Deno.test('loadInUseQualityProfileIds: lidarr collects artist profile ids', async () => {
  const client = new LidarrClient('http://localhost:8686', 'key');
  client.getArtists = () => Promise.resolve([{ qualityProfileId: 2 }] as unknown as LidarrArtist[]);
  assertEquals(await loadInUseQualityProfileIds(client, 'lidarr'), new Set([2]));
});

Deno.test('loadInUseQualityProfileIds: a wrong concrete client or unknown type returns null', async () => {
  const sonarrOnly = new SonarrClient('http://localhost:8989', 'key');
  sonarrOnly.getAllSeries = () => Promise.resolve([{ qualityProfileId: 3 }] as unknown as SonarrSeries[]);
  assertEquals(await loadInUseQualityProfileIds(sonarrOnly, 'radarr'), null);
  assertEquals(await loadInUseQualityProfileIds(sonarrOnly, 'chaptarr'), null);
  assertEquals(await loadInUseQualityProfileIds(sonarrOnly, 'unknown'), null);
});

Deno.test('loadInUseQualityProfileIds: any fetch error returns null', async () => {
  const failing = new RadarrClient('http://localhost:7878', 'key');
  failing.getMovies = () => Promise.reject(new Error('boom'));
  assertEquals(await loadInUseQualityProfileIds(failing, 'radarr'), null);
});
