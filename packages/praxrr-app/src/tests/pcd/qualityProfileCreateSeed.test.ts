/**
 * YAN-1811: new quality profiles seed only the qualities supported by their target Arr app.
 *
 * Runs `qualityProfiles.create` end-to-end against the real schema + qualities ops
 * (`packages/praxrr-schema/ops`), then reads the stored ladder back from the compiled cache.
 */

import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import type { ArrAppType } from '$shared/arr/capabilities.ts';
import type { PCDCache } from '$pcd/index.ts';
import * as qualityProfiles from '$pcd/entities/qualityProfiles/index.ts';
import { getSupportedQualityNames } from '$pcd/entities/qualityProfiles/compatibility.ts';
import { buildSeedItems, VIDEO_SEED_LADDER } from '$pcd/entities/qualityProfiles/createSeed.ts';
import { actions as newProfileActions } from '../../routes/quality-profiles/[databaseId]/new/+page.server.ts';
import { overridesTest, type PcdFixture } from './overrides/overridesTestHelpers.ts';

const LIDARR_ONLY = ['MP3-320', 'FLAC', 'ALAC 24bit', 'WAV', 'OGG Vorbis Q10'];
const VIDEO_ONLY = ['Bluray-1080p', 'Remux-2160p', 'WEBDL-720p', 'SDTV'];
const RADARR_ONLY = ['CAM', 'TELESYNC', 'DVDSCR', 'REGIONAL', 'WORKPRINT', 'TELECINE', 'BR-DISK', 'DVD-R'];

interface StoredLadder {
  /** Every quality stored on the profile: direct items plus group members. */
  qualityNames: string[];
  items: { name: string; type: 'quality' | 'group'; enabled: boolean; upgradeUntil: boolean; members: string[] }[];
}

async function createProfile(fixture: PcdFixture, name: string, arrType?: ArrAppType): Promise<StoredLadder> {
  await fixture.writeUserEdit((cache, databaseId) =>
    qualityProfiles.create({
      databaseId,
      cache,
      layer: 'user',
      input: { name, description: null, tags: [], language: null, ...(arrType ? { arrType } : {}) },
    })
  );

  const ladder = await qualityProfiles.qualities(fixture.cache(), fixture.databaseId, name);
  const items = ladder.orderedItems.map((item) => ({
    name: item.name,
    type: item.type,
    enabled: item.enabled,
    upgradeUntil: item.upgradeUntil,
    // Group-member read order is unspecified (no ORDER BY in qualities()); compare as sorted sets.
    members: (item.members ?? []).map((member) => member.name).sort(),
  }));
  const qualityNames = items.flatMap((item) => (item.type === 'group' ? item.members : [item.name]));
  return { qualityNames, items };
}

function assertOnlySupported(stored: StoredLadder, supported: ReadonlySet<string>, arrLabel: string): void {
  assert(stored.qualityNames.length > 0, `${arrLabel}: ladder must not be empty`);
  for (const name of stored.qualityNames) {
    assert(supported.has(name.toLowerCase()), `${arrLabel}: seeded unsupported quality "${name}"`);
  }
  assertEquals(new Set(stored.qualityNames).size, stored.qualityNames.length, `${arrLabel}: duplicate qualities`);
}

async function supportedFor(cache: PCDCache, arrType: ArrAppType): Promise<Set<string>> {
  return await getSupportedQualityNames(cache, arrType);
}

async function seedableNames(cache: PCDCache, supported: ReadonlySet<string>): Promise<string[]> {
  const rows = await cache.kb.selectFrom('qualities').select(['name']).execute();
  return rows.map((row) => row.name).filter((name) => supported.has(name.toLowerCase()));
}

overridesTest('create seed: radarr profile stores only Radarr qualities, default ladder intact', async (fixture) => {
  const stored = await createProfile(fixture, 'Radarr QP', 'radarr');
  const supported = await supportedFor(fixture.cache(), 'radarr');

  assertOnlySupported(stored, supported, 'radarr');
  for (const name of LIDARR_ONLY) assert(!stored.qualityNames.includes(name), `radarr seeded ${name}`);
  // Every Radarr-supported PCD quality is present exactly once.
  assertEquals([...stored.qualityNames].sort(), (await seedableNames(fixture.cache(), supported)).sort());

  // HDTV-480p has no Radarr mapping, so it drops out; the rest of the default ladder is unchanged.
  assertEquals(
    stored.items.map((item) => item.name),
    [
      'Remux-2160p',
      'Bluray-2160p',
      'WEBDL-2160p',
      'WEBRip-2160p',
      'HDTV-2160p',
      'Remux-1080p',
      'Bluray-1080p',
      'WEB 1080p',
      'HDTV-1080p',
      'Bluray-720p',
      'WEBDL-720p',
      'WEBRip-720p',
      'HDTV-720p',
      'Bluray-576p',
      'Bluray-480p',
      'WEBDL-480p',
      'WEBRip-480p',
      'DVD-R',
      'DVD',
      'SDTV',
      'Pre-releases',
      'Unwanted',
    ]
  );
  assertEquals(
    stored.items.find((item) => item.name === 'Pre-releases')?.members,
    ['REGIONAL', 'DVDSCR', 'TELECINE', 'TELESYNC', 'CAM', 'WORKPRINT'].sort()
  );
  assertEquals(stored.items.find((item) => item.name === 'Unwanted')?.members, ['Unknown', 'Raw-HD', 'BR-DISK'].sort());
  assertEquals(
    stored.items.filter((item) => item.enabled).map((item) => item.name),
    ['Remux-1080p', 'Bluray-1080p']
  );
  assertEquals(
    stored.items.filter((item) => item.upgradeUntil).map((item) => item.name),
    ['Bluray-1080p']
  );
});

overridesTest('create seed: sonarr profile drops Radarr-only and Lidarr qualities', async (fixture) => {
  const stored = await createProfile(fixture, 'Sonarr QP', 'sonarr');
  const supported = await supportedFor(fixture.cache(), 'sonarr');

  assertOnlySupported(stored, supported, 'sonarr');
  for (const name of [...LIDARR_ONLY, ...RADARR_ONLY]) {
    assert(!stored.qualityNames.includes(name), `sonarr seeded ${name}`);
  }
  for (const name of VIDEO_ONLY) assert(stored.qualityNames.includes(name), `sonarr missing ${name}`);
  assertEquals([...stored.qualityNames].sort(), (await seedableNames(fixture.cache(), supported)).sort());

  // Pre-releases has no Sonarr members and is dropped; Unwanted keeps its Sonarr members.
  assert(!stored.items.some((item) => item.name === 'Pre-releases'));
  assertEquals(stored.items.find((item) => item.name === 'Unwanted')?.members, ['Raw-HD', 'Unknown']);
  assertEquals(
    stored.items.filter((item) => item.enabled).map((item) => item.name),
    ['Remux-1080p', 'Bluray-1080p']
  );

  const compatible = await qualityProfiles.list(fixture.cache(), 'sonarr');
  assert(
    compatible.some((profile) => profile.name === 'Sonarr QP'),
    'sonarr profile must stay Sonarr-compatible'
  );
});

overridesTest('create seed: lidarr profile gets the audio ladder only', async (fixture) => {
  const stored = await createProfile(fixture, 'Lidarr QP', 'lidarr');
  const supported = await supportedFor(fixture.cache(), 'lidarr');

  assertOnlySupported(stored, supported, 'lidarr');
  for (const name of [...VIDEO_ONLY, ...RADARR_ONLY]) {
    assert(!stored.qualityNames.includes(name), `lidarr seeded ${name}`);
  }
  assertEquals([...stored.qualityNames].sort(), (await seedableNames(fixture.cache(), supported)).sort());

  assertEquals(
    stored.items.map((item) => item.name),
    [
      'WAV',
      'Lossless',
      'High Quality Lossy',
      'Mid Quality Lossy',
      'Low Quality Lossy',
      'Poor Quality Lossy',
      'Trash Quality Lossy',
      'Unknown',
    ]
  );
  assertEquals(
    stored.items.filter((item) => item.enabled).map((item) => item.name),
    ['Lossless', 'High Quality Lossy']
  );
  assertEquals(
    stored.items.filter((item) => item.upgradeUntil).map((item) => item.name),
    ['Lossless']
  );

  const lidarrProfiles = await qualityProfiles.list(fixture.cache(), 'lidarr');
  assert(
    lidarrProfiles.some((profile) => profile.name === 'Lidarr QP'),
    'lidarr profile must be Lidarr-compatible'
  );
  const radarrProfiles = await qualityProfiles.list(fixture.cache(), 'radarr');
  assert(
    !radarrProfiles.some((profile) => profile.name === 'Lidarr QP'),
    'lidarr profile must not be Radarr-compatible'
  );
});

overridesTest('create seed: omitted arrType infers Radarr + Sonarr and seeds no audio qualities', async (fixture) => {
  const stored = await createProfile(fixture, 'Inferred QP');
  const radarr = await supportedFor(fixture.cache(), 'radarr');
  const sonarr = await supportedFor(fixture.cache(), 'sonarr');
  const union = new Set([...radarr, ...sonarr]);

  assertOnlySupported(stored, union, 'inferred');
  for (const name of LIDARR_ONLY) assert(!stored.qualityNames.includes(name), `inferred seeded ${name}`);
  // Same ladder shape as the explicit Radarr default (Radarr supports every inferred quality).
  const radarrStored = await createProfile(fixture, 'Radarr Twin', 'radarr');
  assertEquals(stored.items, radarrStored.items);

  for (const arrType of ['radarr', 'sonarr'] as const) {
    const profiles = await qualityProfiles.list(fixture.cache(), arrType);
    assert(
      profiles.some((profile) => profile.name === 'Inferred QP'),
      `inferred profile must be ${arrType}-compatible`
    );
  }
});

overridesTest('create seed: unknown arrType fails fast and writes nothing', async (fixture) => {
  await assertRejects(
    () =>
      fixture.writeUserEdit((cache, databaseId) =>
        qualityProfiles.create({
          databaseId,
          cache,
          layer: 'user',
          input: {
            name: 'Bad QP',
            description: null,
            tags: [],
            language: null,
            arrType: 'readarr' as unknown as ArrAppType,
          },
        })
      ),
    Error,
    'Unsupported Arr type'
  );
  const profiles = await qualityProfiles.list(fixture.cache());
  assert(!profiles.some((profile) => profile.name === 'Bad QP'));
});

/** Invoke the "new quality profile" form action like SvelteKit would; returns the fail() payload or redirect. */
async function submitNewProfileForm(fixture: PcdFixture, name: string, query: string): Promise<unknown> {
  const form = new FormData();
  form.set('name', name);
  form.set('tags', '[]');
  form.set('language', '');
  form.set('layer', 'user');
  const url = new URL(`http://localhost/quality-profiles/${fixture.databaseId}/new${query}`);
  const event = {
    request: new Request(url, { method: 'POST', body: form }),
    params: { databaseId: String(fixture.databaseId) },
    url,
  } as unknown as Parameters<NonNullable<typeof newProfileActions.default>>[0];
  try {
    return await newProfileActions.default!(event);
  } catch (thrown) {
    return thrown; // redirect(303, ...) on success
  }
}

overridesTest('create seed: new-profile form action passes ?arrType=lidarr through to seeding', async (fixture) => {
  const outcome = (await submitNewProfileForm(fixture, 'Form Lidarr QP', '?arrType=lidarr')) as { status?: number };
  assertEquals(outcome.status, 303, 'successful create redirects');

  const ladder = await qualityProfiles.qualities(fixture.cache(), fixture.databaseId, 'Form Lidarr QP');
  const names = ladder.orderedItems.flatMap((item) =>
    item.type === 'group' ? (item.members ?? []).map((member) => member.name) : [item.name]
  );
  assert(names.includes('FLAC'), 'lidarr form create seeds audio qualities');
  for (const name of VIDEO_ONLY) assert(!names.includes(name), `lidarr form create seeded ${name}`);
});

overridesTest('create seed: new-profile form action rejects an unknown arrType', async (fixture) => {
  const outcome = (await submitNewProfileForm(fixture, 'Form Bad QP', '?arrType=readarr')) as {
    status?: number;
    data?: { error?: string };
  };
  assertEquals(outcome.status, 400);
  assertEquals(outcome.data?.error, 'Invalid target Arr app');
  const profiles = await qualityProfiles.list(fixture.cache());
  assert(!profiles.some((profile) => profile.name === 'Form Bad QP'));
});

Deno.test('buildSeedItems: collapses single-member groups, drops empty groups, appends extras', () => {
  const items = buildSeedItems(
    VIDEO_SEED_LADDER,
    [{ name: 'Bluray-1080p' }, { name: 'WEBDL-1080p' }, { name: 'CAM' }, { name: 'Extra-Q' }, { name: 'FLAC' }],
    new Set(['bluray-1080p', 'webdl-1080p', 'cam', 'extra-q'])
  );

  assertEquals(
    items.map(({ type, name, position, enabled, upgradeUntil }) => ({ type, name, position, enabled, upgradeUntil })),
    [
      { type: 'quality', name: 'Bluray-1080p', position: 1, enabled: true, upgradeUntil: true },
      // 'WEB 1080p' keeps one member -> stored as that quality, not a one-item group.
      { type: 'quality', name: 'WEBDL-1080p', position: 2, enabled: false, upgradeUntil: false },
      { type: 'quality', name: 'CAM', position: 3, enabled: false, upgradeUntil: false },
      // Supported but not on the ladder -> appended disabled. FLAC is unsupported -> absent.
      { type: 'quality', name: 'Extra-Q', position: 4, enabled: false, upgradeUntil: false },
    ]
  );
  const cam = items.find((item) => item.name === 'CAM');
  assertExists(cam);
  assertEquals(cam.members, []);
});
