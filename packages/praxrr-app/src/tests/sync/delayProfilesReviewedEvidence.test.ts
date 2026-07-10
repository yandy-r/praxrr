import { assert, assertEquals, assertNotEquals, assertRejects } from '@std/assert';
import type { ArrDelayProfile } from '$arr/types.ts';
import { LidarrClient } from '$arr/clients/lidarr.ts';
import { RadarrClient } from '$arr/clients/radarr.ts';
import { SonarrClient } from '$arr/clients/sonarr.ts';
import { clearAllCaches, setCache } from '$pcd/database/registry.ts';
import type { PCDCache } from '$pcd/index.ts';
import { DelayProfileSyncer } from '$sync/delayProfiles/syncer.ts';
import type {
  SyncPreviewEvidenceClass,
  SyncPreviewEvidenceRecorder,
  SyncPreviewPreparedExecutionContext,
  SyncPreviewSection,
} from '$sync/preview/types.ts';

const DATABASE_ID = 234;
const EXACT_PROFILE_NAME = '  Exact Delay Profile  ';

interface RawDelayProfile {
  id: number;
  name: string;
  preferred_protocol: string;
  usenet_delay: number | null;
  torrent_delay: number | null;
  bypass_if_highest_quality: number;
  bypass_if_above_custom_format_score: number;
  minimum_custom_format_score: number | null;
  created_at: string;
  updated_at: string;
}

class CapturingRecorder implements SyncPreviewEvidenceRecorder {
  readonly pcd: Record<string, unknown> = {};
  readonly arr: Record<string, unknown> = {};
  prepared: SyncPreviewPreparedExecutionContext | null = null;

  record(section: SyncPreviewSection, source: SyncPreviewEvidenceClass, key: string, value: unknown): void {
    assertEquals(section, 'delayProfiles');
    this[source][key] = value;
  }

  prepare(context: SyncPreviewPreparedExecutionContext): void {
    assertEquals(context.section, 'delayProfiles');
    this.prepared = context;
  }
}

function rawDelayProfile(overrides: Partial<RawDelayProfile> = {}): RawDelayProfile {
  return {
    id: 3,
    name: EXACT_PROFILE_NAME,
    preferred_protocol: 'prefer_torrent',
    usenet_delay: 15,
    torrent_delay: 5,
    bypass_if_highest_quality: 1,
    bypass_if_above_custom_format_score: 0,
    minimum_custom_format_score: 200,
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function liveDelayProfile(overrides: Partial<ArrDelayProfile> = {}): ArrDelayProfile {
  return {
    id: 1,
    enableUsenet: true,
    enableTorrent: true,
    preferredProtocol: 'usenet',
    usenetDelay: 0,
    torrentDelay: 0,
    bypassIfHighestQuality: false,
    bypassIfAboveCustomFormatScore: false,
    minimumCustomFormatScore: 0,
    order: 10,
    tags: [],
    ...overrides,
  };
}

function setMutableProfileCache(
  readProfile: () => RawDelayProfile | null,
  onLookup: (name: string) => void = () => {}
): void {
  const cache = {
    kb: {
      selectFrom: (table: string) => {
        assertEquals(table, 'delay_profiles');
        return {
          select: () => ({
            where: (_field: string, _operator: string, name: string) => ({
              executeTakeFirst: async () => {
                onLookup(name);
                return readProfile();
              },
            }),
          }),
        };
      },
    },
    close: () => {},
  } as unknown as PCDCache;

  setCache(DATABASE_ID, cache);
}

function configurePreview(syncer: DelayProfileSyncer, recorder: CapturingRecorder): void {
  syncer.setPreviewConfig({
    databaseId: DATABASE_ID,
    profileName: EXACT_PROFILE_NAME,
  });
  syncer.setPreviewEvidenceRecorder(recorder);
}

function createRadarr(target: ArrDelayProfile, calls: string[] = []): RadarrClient {
  const client = new RadarrClient('http://radarr.test', 'key', { retries: 0 });
  client.getDelayProfile = async (id) => {
    calls.push(`radarr:get:${id}`);
    return structuredClone(target);
  };
  client.getDelayProfiles = async () => {
    calls.push('radarr:list');
    throw new Error('Radarr must not use Lidarr target discovery');
  };
  return client;
}

function createSonarr(target: ArrDelayProfile, calls: string[] = []): SonarrClient {
  const client = new SonarrClient('http://sonarr.test', 'key', { retries: 0 });
  client.getDelayProfile = async (id) => {
    calls.push(`sonarr:get:${id}`);
    return structuredClone(target);
  };
  client.getDelayProfiles = async () => {
    calls.push('sonarr:list');
    throw new Error('Sonarr must not use Lidarr target discovery');
  };
  return client;
}

function createLidarr(targets: ArrDelayProfile[], calls: string[] = []): LidarrClient {
  const client = new LidarrClient('http://lidarr.test', 'key', { retries: 0 });
  client.getDelayProfiles = async () => {
    calls.push('lidarr:list');
    return structuredClone(targets);
  };
  client.getDelayProfile = async (id) => {
    calls.push(`lidarr:get:${id}`);
    throw new Error('Non-empty Lidarr target discovery must not fall back to a fixed id');
  };
  return client;
}

async function captureRadarrEvidence(
  profile: RawDelayProfile,
  target: ArrDelayProfile,
  profileName = EXACT_PROFILE_NAME
): Promise<CapturingRecorder> {
  clearAllCaches();
  setMutableProfileCache(() => profile);
  const recorder = new CapturingRecorder();
  const client = createRadarr(target);
  const syncer = new DelayProfileSyncer(client, 1, 'Reviewed Radarr');
  syncer.setPreviewConfig({ databaseId: DATABASE_ID, profileName });
  syncer.setPreviewEvidenceRecorder(recorder);
  try {
    await syncer.generatePreview();
    return recorder;
  } finally {
    client.close();
    clearAllCaches();
  }
}

Deno.test('delay profile review evidence captures exact config, PCD, desired, target, and frozen guard', async () => {
  let lookupName = '';
  const profile = rawDelayProfile();
  const target = liveDelayProfile({ id: 17, order: 4, tags: [8, 3] });
  setMutableProfileCache(
    () => profile,
    (name) => {
      lookupName = name;
    }
  );

  const recorder = new CapturingRecorder();
  const client = createRadarr(target);
  const syncer = new DelayProfileSyncer(client, 1, 'Reviewed Radarr');
  configurePreview(syncer, recorder);

  try {
    const preview = await syncer.generatePreview();
    assertEquals(lookupName, EXACT_PROFILE_NAME);
    assertEquals(preview.profile?.name, EXACT_PROFILE_NAME);
    assertEquals(recorder.pcd.selectedConfig, {
      databaseId: DATABASE_ID,
      profileName: EXACT_PROFILE_NAME,
    });
    assertEquals(recorder.pcd.selectedProfile, {
      ...profile,
      bypass_if_highest_quality: true,
      bypass_if_above_custom_format_score: false,
    });
    assertEquals(recorder.pcd.transformedDesiredProfile, {
      id: 1,
      enableUsenet: true,
      enableTorrent: true,
      preferredProtocol: 'torrent',
      usenetDelay: 15,
      torrentDelay: 5,
      bypassIfHighestQuality: true,
      bypassIfAboveCustomFormatScore: false,
      minimumCustomFormatScore: 200,
      order: 2147483647,
      tags: [],
    });
    assertEquals(recorder.arr.materialCapabilities, {
      arrType: 'radarr',
      delayProfilesSupported: true,
      targetResolution: 'fixed-default-id',
    });
    assertEquals(recorder.arr.liveTargetProfile, target);
    assertEquals(recorder.arr.remoteIdentity, {
      id: 17,
      order: 4,
      tags: [8, 3],
    });
    assertEquals(recorder.arr.targetResolution, {
      arrType: 'radarr',
      strategy: 'fixed-default-id',
      requestedId: 1,
      selectedId: 17,
    });

    const prepared = recorder.prepared as {
      config: { databaseId: number; profileName: string };
      desired: ArrDelayProfile;
      materialPlan: {
        arrType: string;
        profileName: string;
        targetProfileId: number;
        targetResolution: unknown;
      };
      currentGuards: { targetProfile: ArrDelayProfile };
    };
    assert(Object.isFrozen(prepared));
    assert(Object.isFrozen(prepared.desired));
    assert(Object.isFrozen(prepared.currentGuards.targetProfile));
    assertEquals(prepared.config.profileName, EXACT_PROFILE_NAME);
    assertEquals(prepared.desired, {
      ...target,
      ...(recorder.pcd.transformedDesiredProfile as ArrDelayProfile),
      id: 17,
      order: 4,
      tags: [8, 3],
    });
    assertEquals(prepared.currentGuards.targetProfile, target);
    assertEquals(prepared.materialPlan, {
      arrType: 'radarr',
      profileName: EXACT_PROFILE_NAME,
      targetProfileId: 17,
      targetResolution: recorder.arr.targetResolution,
    });

    profile.usenet_delay = 999;
    target.order = 999;
    assertEquals((recorder.pcd.selectedProfile as { usenet_delay: number }).usenet_delay, 15);
    assertEquals((recorder.arr.liveTargetProfile as ArrDelayProfile).order, 4);
  } finally {
    client.close();
    clearAllCaches();
  }
});

Deno.test('delay profile evidence changes independently for config, PCD, and live Arr mutations', async () => {
  const baseline = await captureRadarrEvidence(rawDelayProfile(), liveDelayProfile());
  const configChanged = await captureRadarrEvidence(
    rawDelayProfile({ name: `${EXACT_PROFILE_NAME}changed` }),
    liveDelayProfile(),
    `${EXACT_PROFILE_NAME}changed`
  );
  const pcdChanged = await captureRadarrEvidence(rawDelayProfile({ torrent_delay: 99 }), liveDelayProfile());
  const arrChanged = await captureRadarrEvidence(rawDelayProfile(), liveDelayProfile({ torrentDelay: 99 }));

  assertNotEquals(baseline.pcd.selectedConfig, configChanged.pcd.selectedConfig);
  assertEquals(baseline.arr, configChanged.arr);
  assertNotEquals(baseline.pcd.selectedProfile, pcdChanged.pcd.selectedProfile);
  assertEquals(baseline.arr, pcdChanged.arr);
  assertEquals(baseline.pcd, arrChanged.pcd);
  assertNotEquals(baseline.arr.liveTargetProfile, arrChanged.arr.liveTargetProfile);
});

Deno.test('delay profile target resolution is explicit per Arr app and deterministic for Lidarr sets', async () => {
  setMutableProfileCache(() => rawDelayProfile());
  const fixedTarget = liveDelayProfile();
  const lidarrProfiles = [
    liveDelayProfile({ id: 20, order: 1, tags: [7, 2] }),
    liveDelayProfile({ id: 9, order: 2, tags: [] }),
    liveDelayProfile({ id: 5, order: 4, tags: [] }),
  ];

  const cases = [
    {
      arrType: 'radarr',
      client: createRadarr(fixedTarget, []),
      calls: [] as string[],
    },
    {
      arrType: 'sonarr',
      client: createSonarr(fixedTarget, []),
      calls: [] as string[],
    },
  ];
  for (const testCase of cases) {
    const calls: string[] = [];
    const client = testCase.arrType === 'radarr' ? createRadarr(fixedTarget, calls) : createSonarr(fixedTarget, calls);
    const recorder = new CapturingRecorder();
    const syncer = new DelayProfileSyncer(client, 1, `Reviewed ${testCase.arrType}`);
    configurePreview(syncer, recorder);
    try {
      await syncer.generatePreview();
      assertEquals(calls, [`${testCase.arrType}:get:1`]);
      assertEquals((recorder.arr.materialCapabilities as { arrType: string }).arrType, testCase.arrType);
    } finally {
      client.close();
    }
  }

  for (const profiles of [lidarrProfiles, [...lidarrProfiles].reverse()]) {
    const calls: string[] = [];
    const client = createLidarr(profiles, calls);
    const recorder = new CapturingRecorder();
    const syncer = new DelayProfileSyncer(client, 1, 'Reviewed Lidarr');
    configurePreview(syncer, recorder);
    try {
      await syncer.generatePreview();
      assertEquals(calls, ['lidarr:list']);
      assertEquals(recorder.arr.targetResolution, {
        arrType: 'lidarr',
        strategy: 'untagged-lowest-order',
        selectedId: 9,
        candidates: [
          { id: 5, order: 4, tags: [] },
          { id: 9, order: 2, tags: [] },
          { id: 20, order: 1, tags: [2, 7] },
        ],
      });
    } finally {
      client.close();
    }
  }

  for (const testCase of cases) testCase.client.close();
  clearAllCaches();
});

Deno.test(
  'reviewed delay profile write consumes frozen payload and guard without rereading PCD or live target',
  async () => {
    let pcdReads = 0;
    const source = rawDelayProfile();
    setMutableProfileCache(() => {
      pcdReads += 1;
      return source;
    });

    const previewClient = createRadarr(liveDelayProfile({ id: 17, order: 6, tags: [4] }));
    const recorder = new CapturingRecorder();
    const previewSyncer = new DelayProfileSyncer(previewClient, 1, 'Reviewed Radarr');
    configurePreview(previewSyncer, recorder);
    await previewSyncer.generatePreview();
    previewClient.close();
    assertEquals(pcdReads, 1);

    source.torrent_delay = 999;
    clearAllCaches();

    const writeClient = createRadarr(liveDelayProfile({ id: 99 }));
    let write: { id: number; payload: ArrDelayProfile } | null = null;
    writeClient.getDelayProfile = () => {
      throw new Error('Reviewed write must not rematerialize the live target');
    };
    writeClient.updateDelayProfile = async (id, payload) => {
      write = { id, payload: structuredClone(payload) };
      return payload;
    };

    const writeSyncer = new DelayProfileSyncer(writeClient, 1, 'Reviewed Radarr');
    writeSyncer.setPreviewConfig({
      databaseId: 999,
      profileName: 'Mutated saved config',
    });
    writeSyncer.setPreparedExecutionContext(recorder.prepared!);
    try {
      const result = await writeSyncer.sync();
      assertEquals(result.success, true);
      assertEquals(result.outcomes[0]?.name, EXACT_PROFILE_NAME);
      assertEquals(result.outcomes[0]?.remoteId, '17');
      assertEquals(pcdReads, 1);
      assertEquals(write, {
        id: 17,
        payload: (recorder.prepared as { desired: ArrDelayProfile }).desired,
      });

      const retainedContext = (
        writeSyncer as unknown as {
          getPreparedExecutionContext(): SyncPreviewPreparedExecutionContext | null;
        }
      ).getPreparedExecutionContext();
      const retainedConfig = (
        writeSyncer as unknown as {
          getPreviewConfig(): unknown;
        }
      ).getPreviewConfig();
      assertEquals(retainedContext, null);
      assertEquals(retainedConfig, null);
    } finally {
      writeClient.close();
    }
  }
);

Deno.test('delay-profile transient overrides fail closed for every supported Arr type', async () => {
  const cases = [
    ['radarr', createRadarr(liveDelayProfile())],
    ['sonarr', createSonarr(liveDelayProfile())],
    ['lidarr', createLidarr([liveDelayProfile()])],
  ] as const;

  for (const [arrType, client] of cases) {
    const syncer = new DelayProfileSyncer(client, 999_001, `Invalid ${arrType}`);
    syncer.setPreviewConfig({ databaseId: DATABASE_ID });
    try {
      await assertRejects(
        () => syncer.generatePreview(),
        Error,
        'Invalid reviewed delay profile configuration',
        `${arrType} must not fall back to saved delay-profile config`
      );
    } finally {
      client.close();
    }
  }
});
