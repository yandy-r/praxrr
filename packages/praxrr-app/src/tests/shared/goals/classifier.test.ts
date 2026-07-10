import { assertEquals } from '@std/assert';

import { classifyCustomFormat, detectResolutionLevel } from '$shared/goals/classifier.ts';
import type { CfFacts } from '$shared/goals/types.ts';

function cf(name: string, tags: string[], description: string | null = null): CfFacts {
  return { name, tags, description };
}

/**
 * Golden classification fixtures — every entry is a REAL custom format from the praxrr default DB
 * (packages/praxrr-db/entities/custom-formats), pinned so any classifier vocabulary change is caught.
 * Covers all categories plus two that MUST be uncategorized.
 */
const GOLDEN: { cf: CfFacts; expected: string | null }[] = [
  // unwanted — the Banned tag, and hard-reject CFs the tag misses
  { cf: cf('Banned Groups', ['Banned', 'Release Group']), expected: 'unwanted' },
  { cf: cf('Sing Along', ['Banned', 'Edition']), expected: 'unwanted' }, // Banned beats Edition
  { cf: cf('B&W', ['Banned', 'Colour Grade', 'Enhancement']), expected: 'unwanted' }, // Banned beats HDR/Colour
  { cf: cf('Dolby Vision (Without Fallback)', ['Colour Grade', 'HDR']), expected: 'unwanted' }, // name hard-reject
  // hdr tiers — all share Colour Grade + HDR, distinguished by name
  { cf: cf('Dolby Vision', ['Colour Grade', 'HDR']), expected: 'hdr_dv' },
  { cf: cf('HDR10+', ['Colour Grade', 'HDR']), expected: 'hdr_hdr10plus' },
  { cf: cf('HDR10', ['Colour Grade', 'HDR']), expected: 'hdr_baseline' },
  { cf: cf('HLG', ['Colour Grade', 'HDR']), expected: 'hdr_baseline' },
  // release-group tiers — including dual-tagged Remux Tier N (Release Group Tier + Remux)
  { cf: cf('Remux Tier 1', ['Release Group Tier', 'Remux']), expected: 'release_group_tier_1' },
  { cf: cf('2160p Quality Tier 1', ['2160p', 'Quality', 'Release Group Tier']), expected: 'release_group_tier_1' },
  { cf: cf('WEB-DL Tier 4', ['Release Group Tier', 'WEB-DL']), expected: 'release_group_tier_3' }, // tier>=3 clamps
  // remux — name-only, after release-group tiers
  { cf: cf('2160p Remux', ['Source']), expected: 'remux' },
  // audio
  { cf: cf('TrueHD', ['Audio']), expected: 'audio_lossless' },
  { cf: cf('DTS-X', ['Audio']), expected: 'audio_advanced' },
  { cf: cf('DTS', ['Audio']), expected: 'audio_baseline' }, // Audio tag catch-all
  // streaming — the Streaming Service tag, not just a few name tokens
  { cf: cf('AMZN', ['Streaming Service', 'WEB-DL']), expected: 'streaming_service' },
  { cf: cf('HULU', ['Streaming Service', 'WEB-DL']), expected: 'streaming_service' },
  // editions
  { cf: cf('IMAX', ['Edition']), expected: 'movie_version' },
  { cf: cf('Better Theatricals', ['Edition']), expected: 'movie_version' },
  // repack
  { cf: cf('Repack3', ['Flag', 'Repack']), expected: 'repack_proper' },
  // resolution ladder
  { cf: cf('1080p Bluray', ['Source']), expected: 'resolution' },
  // uncategorized — no rule matches (Codec family has no category)
  { cf: cf('x265 (Bluray)', ['Codec']), expected: null },
  { cf: cf('Season Pack', ['Flag']), expected: null },
];

Deno.test('classifier: golden fixtures classify to expected categories (radarr)', () => {
  for (const { cf: facts, expected } of GOLDEN) {
    const { category } = classifyCustomFormat(facts, 'radarr');
    assertEquals(category, expected, `"${facts.name}" -> expected ${expected}, got ${category}`);
  }
});

Deno.test('classifier: first-match ordering keeps Banned ahead of reward categories', () => {
  // Sing Along carries Edition; B&W carries Colour Grade/HDR — Banned must win.
  assertEquals(classifyCustomFormat(cf('Sing Along', ['Banned', 'Edition']), 'radarr').category, 'unwanted');
  assertEquals(classifyCustomFormat(cf('B&W', ['Banned', 'HDR']), 'radarr').category, 'unwanted');
});

Deno.test('classifier: Remux Tier N resolves to release_group_tier, not remux', () => {
  const t1 = classifyCustomFormat(cf('Remux Tier 1', ['Release Group Tier', 'Remux']), 'radarr');
  assertEquals(t1.category, 'release_group_tier_1');
  const t2 = classifyCustomFormat(cf('Remux Tier 2', ['Release Group Tier', 'Remux']), 'radarr');
  assertEquals(t2.category, 'release_group_tier_2');
  // A bare remux (no Release Group Tier tag, no tier digit) is remux.
  assertEquals(classifyCustomFormat(cf('2160p Remux', ['Source']), 'radarr').category, 'remux');
});

Deno.test('classifier: case-insensitive on tags and name', () => {
  assertEquals(classifyCustomFormat(cf('dOlBy ViSiOn', ['cOlOuR gRaDe', 'hDr']), 'radarr').category, 'hdr_dv');
  assertEquals(classifyCustomFormat(cf('banned groups', ['BANNED']), 'radarr').category, 'unwanted');
});

Deno.test('classifier: uncategorized falls back with the sentinel ruleId', () => {
  const result = classifyCustomFormat(cf('x265 (Bluray)', ['Codec']), 'radarr');
  assertEquals(result.category, null);
  assertEquals(result.ruleId, 'rule.fallback.no-match');
});

Deno.test('classifier: lidarr drops video-only categories to uncategorized', () => {
  assertEquals(classifyCustomFormat(cf('Dolby Vision', ['Colour Grade', 'HDR']), 'lidarr').category, null);
  assertEquals(classifyCustomFormat(cf('2160p Remux', ['Source']), 'lidarr').category, null);
  assertEquals(classifyCustomFormat(cf('1080p Bluray', ['Source']), 'lidarr').category, null);
  // Audio survives for lidarr.
  assertEquals(classifyCustomFormat(cf('TrueHD', ['Audio']), 'lidarr').category, 'audio_lossless');
});

Deno.test('classifier: lidarr audio codecs classify to audio tiers (grounded in the real Lidarr CFs, #222)', () => {
  // The 3 real Lidarr CFs (packages/praxrr-db/entities/custom-formats/lidarr-{flac,aac,opus}).
  const flac = classifyCustomFormat(cf('Lidarr - FLAC (Praxrr)', ['Audio']), 'lidarr');
  assertEquals(flac.category, 'audio_lossless');
  assertEquals(flac.ruleId, 'rule.audio.lidarr.lossless');
  assertEquals(classifyCustomFormat(cf('Lidarr - AAC (Praxrr)', ['Audio']), 'lidarr').category, 'audio_advanced');
  assertEquals(classifyCustomFormat(cf('Lidarr - Opus (Praxrr)', ['Audio']), 'lidarr').category, 'audio_advanced');
  // An audio-tagged CF matching no audio token still lands in the gate-only baseline tier.
  assertEquals(classifyCustomFormat(cf('WMA', ['Audio']), 'lidarr').category, 'audio_baseline');
});

Deno.test('classifier: lidarr excludes video-only categories with the distinct excluded ruleId (AC4)', () => {
  const excluded = [
    cf('Dolby Vision', ['Colour Grade', 'HDR']), // hdr
    cf('2160p Remux', ['Source']), // remux
    cf('1080p Bluray', ['Source']), // resolution
    cf('IMAX', ['Edition']), // movie_version (newly excluded)
    cf('AMZN', ['Streaming Service', 'WEB-DL']), // streaming_service (newly excluded)
    cf('Remux Tier 1', ['Release Group Tier', 'Remux']), // release_group_tier (newly excluded)
  ];
  for (const facts of excluded) {
    const result = classifyCustomFormat(facts, 'lidarr');
    assertEquals(result.category, null, `"${facts.name}" should be excluded for lidarr`);
    assertEquals(result.ruleId, 'rule.excluded.video-only', `"${facts.name}" should carry the excluded ruleId`);
  }
});

Deno.test('classifier: arrScope keeps radarr/sonarr classification unchanged (AC5)', () => {
  for (const arr of ['radarr', 'sonarr'] as const) {
    // CFs excluded for lidarr still classify to their video categories for radarr/sonarr.
    assertEquals(classifyCustomFormat(cf('Dolby Vision', ['Colour Grade', 'HDR']), arr).category, 'hdr_dv');
    assertEquals(classifyCustomFormat(cf('IMAX', ['Edition']), arr).category, 'movie_version');
    assertEquals(classifyCustomFormat(cf('AMZN', ['Streaming Service', 'WEB-DL']), arr).category, 'streaming_service');
    assertEquals(
      classifyCustomFormat(cf('Remux Tier 1', ['Release Group Tier', 'Remux']), arr).category,
      'release_group_tier_1'
    );
    // The lidarr-only audio rules never fire for radarr/sonarr — a FLAC-named CF matches the SHARED rule.
    assertEquals(classifyCustomFormat(cf('Lidarr - FLAC (Praxrr)', ['Audio']), arr).ruleId, 'rule.audio.lossless');
  }
});

Deno.test('classifier: real descriptions do NOT leak into classification (name/tags only)', () => {
  // Real default-DB descriptions mention OTHER formats via negations/comparisons — substring-matching
  // them would invert intent. Each entry uses a REAL praxrr-db CF's name + tags + description.
  const cases: { name: string; tags: string[]; description: string; expected: string | null }[] = [
    {
      name: 'SDR',
      tags: [],
      description: 'Ban 2160p WEB-DL Releases without Dolby Vision or HDR Formats',
      expected: null,
    },
    {
      name: '1080p Bluray',
      tags: ['Source'],
      description: 'Matches 1080p Blurays that are NOT remuxes',
      expected: 'resolution',
    },
    {
      name: 'x265 (Bluray)',
      tags: ['Codec'],
      description: 'Matches x265 Bluray Releases when not 2160p',
      expected: null,
    },
    { name: 'UHD Bluray', tags: ['2160p', 'Storage'], description: 'not Dolby Vision', expected: 'resolution' },
    { name: 'Atmos (Missing)', tags: ['Audio'], description: 'Atmos (TrueHD 7.1) missing', expected: 'audio_advanced' },
  ];
  for (const { name, tags, description, expected } of cases) {
    const { category } = classifyCustomFormat(cf(name, tags, description), 'radarr');
    assertEquals(category, expected, `"${name}" (desc "${description}") -> expected ${expected}, got ${category}`);
  }
});

Deno.test('detectResolutionLevel: reads name and tags, including UHD/4K synonyms', () => {
  assertEquals(detectResolutionLevel(cf('2160p Remux', ['Source'])), 3);
  assertEquals(detectResolutionLevel(cf('UHD Bluray', ['2160p', 'Storage'])), 3); // resolution only in the tag
  assertEquals(detectResolutionLevel(cf('1080p Bluray', ['Source'])), 2);
  assertEquals(detectResolutionLevel(cf('720p WEB-DL', ['Source'])), 1);
  assertEquals(detectResolutionLevel(cf('480p Bluray', ['Source'])), 0);
  assertEquals(detectResolutionLevel(cf('TrueHD', ['Audio'])), undefined);
});
