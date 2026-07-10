import { assert, assertEquals, assertThrows } from '@std/assert';

import { buildCeilingLadder, GoalLadderMappingError } from '$shared/goals/ladder.ts';
import type { GoalQualityFact } from '$shared/goals/ladder.ts';
import type { GoalResolutionCeiling } from '$shared/goals/types.ts';
import type { OrderedItem } from '$shared/pcd/display.ts';

/**
 * Per-arr PCD-name → resolution maps, derived from `$sync/mappings.ts` QUALITIES but keyed by the
 * PCD canonical `quality_name` (what `materializeQualityFacts` emits). Sonarr omits the pre-release
 * ladder + DVD-R and renames remuxes at the API layer (their PCD names stay `Remux-*`).
 */
const RADARR_FACTS: Record<string, number> = {
  Unknown: 0,
  SDTV: 480,
  DVD: 480,
  'DVD-R': 480,
  'WEBDL-480p': 480,
  'WEBRip-480p': 480,
  'Bluray-480p': 480,
  'Bluray-576p': 576,
  'HDTV-720p': 720,
  'WEBDL-720p': 720,
  'WEBRip-720p': 720,
  'Bluray-720p': 720,
  'HDTV-1080p': 1080,
  'WEBDL-1080p': 1080,
  'WEBRip-1080p': 1080,
  'Bluray-1080p': 1080,
  'Remux-1080p': 1080,
  'Raw-HD': 1080,
  'BR-DISK': 1080,
  'HDTV-2160p': 2160,
  'WEBDL-2160p': 2160,
  'WEBRip-2160p': 2160,
  'Bluray-2160p': 2160,
  'Remux-2160p': 2160,
  WORKPRINT: 0,
  CAM: 0,
  TELESYNC: 0,
  TELECINE: 0,
  DVDSCR: 480,
  REGIONAL: 480
};

const SONARR_FACTS: Record<string, number> = {
  Unknown: 0,
  SDTV: 480,
  DVD: 480,
  'WEBDL-480p': 480,
  'WEBRip-480p': 480,
  'Bluray-480p': 480,
  'Bluray-576p': 576,
  'HDTV-720p': 720,
  'WEBDL-720p': 720,
  'WEBRip-720p': 720,
  'Bluray-720p': 720,
  'HDTV-1080p': 1080,
  'WEBDL-1080p': 1080,
  'WEBRip-1080p': 1080,
  'Bluray-1080p': 1080,
  'Remux-1080p': 1080,
  'Raw-HD': 1080,
  'HDTV-2160p': 2160,
  'WEBDL-2160p': 2160,
  'WEBRip-2160p': 2160,
  'Bluray-2160p': 2160,
  'Remux-2160p': 2160
};

function factsFrom(map: Record<string, number>): GoalQualityFact[] {
  return Object.entries(map).map(([name, resolution]) => ({ name, resolution }));
}

/** A current ladder of one standalone quality row per fact (all disabled, no cutoff yet). */
function ladderFrom(map: Record<string, number>): OrderedItem[] {
  return Object.keys(map).map((name, index) => ({
    type: 'quality',
    name,
    position: index + 1,
    enabled: false,
    upgradeUntil: false
  }));
}

function enabledQualityNames(ladder: OrderedItem[]): Set<string> {
  return new Set(ladder.filter((item) => item.type === 'quality' && item.enabled).map((item) => item.name));
}

const EXPECTED: Record<'radarr' | 'sonarr', Record<GoalResolutionCeiling, string[]>> = {
  radarr: {
    '720p': ['SDTV', 'DVD', 'DVD-R', 'WEBDL-480p', 'WEBRip-480p', 'Bluray-480p', 'Bluray-576p', 'HDTV-720p', 'WEBDL-720p', 'WEBRip-720p', 'Bluray-720p'],
    '1080p': ['SDTV', 'DVD', 'DVD-R', 'WEBDL-480p', 'WEBRip-480p', 'Bluray-480p', 'Bluray-576p', 'HDTV-720p', 'WEBDL-720p', 'WEBRip-720p', 'Bluray-720p', 'HDTV-1080p', 'WEBDL-1080p', 'WEBRip-1080p', 'Bluray-1080p', 'Remux-1080p'],
    '2160p': ['SDTV', 'DVD', 'DVD-R', 'WEBDL-480p', 'WEBRip-480p', 'Bluray-480p', 'Bluray-576p', 'HDTV-720p', 'WEBDL-720p', 'WEBRip-720p', 'Bluray-720p', 'HDTV-1080p', 'WEBDL-1080p', 'WEBRip-1080p', 'Bluray-1080p', 'Remux-1080p', 'HDTV-2160p', 'WEBDL-2160p', 'WEBRip-2160p', 'Bluray-2160p', 'Remux-2160p']
  },
  sonarr: {
    '720p': ['SDTV', 'DVD', 'WEBDL-480p', 'WEBRip-480p', 'Bluray-480p', 'Bluray-576p', 'HDTV-720p', 'WEBDL-720p', 'WEBRip-720p', 'Bluray-720p'],
    '1080p': ['SDTV', 'DVD', 'WEBDL-480p', 'WEBRip-480p', 'Bluray-480p', 'Bluray-576p', 'HDTV-720p', 'WEBDL-720p', 'WEBRip-720p', 'Bluray-720p', 'HDTV-1080p', 'WEBDL-1080p', 'WEBRip-1080p', 'Bluray-1080p', 'Remux-1080p'],
    '2160p': ['SDTV', 'DVD', 'WEBDL-480p', 'WEBRip-480p', 'Bluray-480p', 'Bluray-576p', 'HDTV-720p', 'WEBDL-720p', 'WEBRip-720p', 'Bluray-720p', 'HDTV-1080p', 'WEBDL-1080p', 'WEBRip-1080p', 'Bluray-1080p', 'Remux-1080p', 'HDTV-2160p', 'WEBDL-2160p', 'WEBRip-2160p', 'Bluray-2160p', 'Remux-2160p']
  }
};

const CEILINGS: GoalResolutionCeiling[] = ['720p', '1080p', '2160p'];

for (const arr of ['radarr', 'sonarr'] as const) {
  const map = arr === 'radarr' ? RADARR_FACTS : SONARR_FACTS;
  for (const ceiling of CEILINGS) {
    Deno.test(`ladder: ${arr} ${ceiling} enables the exact per-arr set + Bluray-${ceiling} cutoff`, () => {
      const { ladderInput, ladder } = buildCeilingLadder(ceiling, ladderFrom(map), factsFrom(map), false);
      assert(ladderInput !== null, 'expected a ladder change');

      // AC1 — exact enabled quality set.
      assertEquals(enabledQualityNames(ladderInput.orderedItems), new Set(EXPECTED[arr][ceiling]));

      // AC1 — single cutoff on Bluray-<ceiling>, cleared everywhere else.
      assertEquals(ladder.cutoff, `Bluray-${ceiling}`);
      const cutoffRows = ladderInput.orderedItems.filter((item) => item.upgradeUntil);
      assertEquals(cutoffRows.length, 1);
      assertEquals(cutoffRows[0].name, `Bluray-${ceiling}`);

      // Full coverage — every current row is preserved (zero removals).
      assertEquals(ladderInput.orderedItems.length, Object.keys(map).length);
    });
  }
}

Deno.test('ladder: junk qualities are never enabled and are preserved verbatim', () => {
  const { ladderInput } = buildCeilingLadder('2160p', ladderFrom(RADARR_FACTS), factsFrom(RADARR_FACTS), false);
  assert(ladderInput !== null);
  const enabled = enabledQualityNames(ladderInput.orderedItems);
  for (const junk of ['Unknown', 'CAM', 'WORKPRINT', 'TELESYNC', 'TELECINE', 'DVDSCR', 'REGIONAL', 'BR-DISK', 'Raw-HD']) {
    assert(!enabled.has(junk), `${junk} must not be enabled by a ceiling`);
  }
});

Deno.test('ladder: unmapped-for-arr qualities are left unchanged (no removals) — Sonarr goal keeps Radarr-only rows', () => {
  // A shared ladder populated with Radarr-only qualities; apply a Sonarr goal.
  const ladder = ladderFrom(RADARR_FACTS).map((item) =>
    // seed DVD-R as currently enabled to prove verbatim preservation
    item.name === 'DVD-R' ? { ...item, enabled: true } : item
  );
  const { ladderInput } = buildCeilingLadder('1080p', ladder, factsFrom(SONARR_FACTS), false);
  assert(ladderInput !== null);

  // Radarr-only rows are unmapped for Sonarr → preserved with their original enabled state, never dropped.
  const byName = new Map(ladderInput.orderedItems.map((item) => [item.name, item]));
  for (const radarrOnly of ['DVD-R', 'DVDSCR', 'REGIONAL', 'WORKPRINT', 'CAM', 'TELESYNC', 'TELECINE', 'BR-DISK']) {
    assert(byName.has(radarrOnly), `${radarrOnly} row must be preserved`);
  }
  assertEquals(byName.get('DVD-R')!.enabled, true, 'Radarr-only DVD-R keeps its enabled state under a Sonarr goal');
  assertEquals(ladderInput.orderedItems.length, ladder.length, 'zero removals');
});

/** The exact default profile groups from create.ts (individual Remux-1080p/Bluray-1080p, three groups). */
function defaultProfileLadder(): OrderedItem[] {
  const individual = (name: string, position: number, enabled = false, upgradeUntil = false): OrderedItem => ({
    type: 'quality',
    name,
    position,
    enabled,
    upgradeUntil
  });
  const group = (name: string, members: string[], position: number): OrderedItem => ({
    type: 'group',
    name,
    position,
    enabled: false,
    upgradeUntil: false,
    members: members.map((m) => ({ name: m }))
  });
  return [
    individual('Remux-2160p', 1),
    individual('Bluray-2160p', 2),
    individual('WEBDL-2160p', 3),
    individual('WEBRip-2160p', 4),
    individual('HDTV-2160p', 5),
    individual('Remux-1080p', 6, true),
    individual('Bluray-1080p', 7, true, true),
    group('WEB 1080p', ['WEBDL-1080p', 'WEBRip-1080p'], 8),
    individual('HDTV-1080p', 9),
    individual('Bluray-720p', 10),
    individual('WEBDL-720p', 11),
    individual('WEBRip-720p', 12),
    individual('HDTV-720p', 13),
    individual('Bluray-576p', 14),
    individual('Bluray-480p', 15),
    individual('WEBDL-480p', 16),
    individual('WEBRip-480p', 17),
    individual('HDTV-480p', 18), // mapped for NEITHER arr → orphan
    individual('DVD-R', 19),
    individual('DVD', 20),
    individual('SDTV', 21),
    group('Pre-releases', ['REGIONAL', 'DVDSCR', 'TELECINE', 'TELESYNC', 'CAM', 'WORKPRINT'], 22),
    group('Unwanted', ['Unknown', 'Raw-HD', 'BR-DISK'], 23)
  ];
}

for (const arr of ['radarr', 'sonarr'] as const) {
  const map = arr === 'radarr' ? RADARR_FACTS : SONARR_FACTS;
  Deno.test(`ladder: default profile (create.ts shape) — ${arr} goal is not ambiguous (no 422)`, () => {
    const at1080 = buildCeilingLadder('1080p', defaultProfileLadder(), factsFrom(map), false);
    assert(at1080.ladderInput !== null);
    const byName = new Map(at1080.ladder.items.map((i) => [i.name, i]));

    // Pre-releases + Unwanted are all-junk / all-unmapped → passthrough verbatim, never fatal.
    assertEquals(byName.get('Pre-releases')!.mapped, false);
    assertEquals(byName.get('Pre-releases')!.enabled, false);
    assertEquals(byName.get('Unwanted')!.mapped, false);
    assertEquals(byName.get('Unwanted')!.enabled, false);
    // HDTV-480p is mapped for neither arr → verbatim.
    assertEquals(byName.get('HDTV-480p')!.mapped, false);

    // WEB 1080p (mapped 1080p members) enabled at 1080p, disabled at 720p.
    assertEquals(byName.get('WEB 1080p')!.enabled, true);
    assertEquals(at1080.ladder.cutoff, 'Bluray-1080p');

    const at720 = buildCeilingLadder('720p', defaultProfileLadder(), factsFrom(map), false);
    const at720ByName = new Map(at720.ladder.items.map((i) => [i.name, i]));
    assertEquals(at720ByName.get('WEB 1080p')!.enabled, false);
    assertEquals(at720.ladder.cutoff, 'Bluray-720p');
  });
}

Deno.test('ladder: no Bluray-<ceiling> cutoff row present → ladderInput null (non-fatal)', () => {
  // Ladder with only 2160p qualities; a 720p ceiling has no Bluray-720p row → no derivable ladder.
  const ladder: OrderedItem[] = [
    { type: 'quality', name: 'Bluray-2160p', position: 1, enabled: true, upgradeUntil: true },
    { type: 'quality', name: 'WEBDL-2160p', position: 2, enabled: true, upgradeUntil: false }
  ];
  const facts = factsFrom({ 'Bluray-2160p': 2160, 'WEBDL-2160p': 2160 });
  const { ladderInput, ladder: result } = buildCeilingLadder('720p', ladder, facts, false);
  assertEquals(ladderInput, null);
  assertEquals(result.cutoff, null);
});

Deno.test('ladder: straddling group throws GoalLadderMappingError (genuine ambiguity → 422)', () => {
  const ladder: OrderedItem[] = [
    { type: 'quality', name: 'Bluray-1080p', position: 1, enabled: false, upgradeUntil: false },
    {
      type: 'group',
      name: 'Mixed',
      position: 2,
      enabled: false,
      upgradeUntil: false,
      members: [{ name: 'Bluray-1080p' }, { name: 'Bluray-2160p' }]
    }
  ];
  const facts = factsFrom({ 'Bluray-1080p': 1080, 'Bluray-2160p': 2160 });
  assertThrows(() => buildCeilingLadder('1080p', ladder, facts, false), GoalLadderMappingError);
});

Deno.test('ladder: sharedLadderNote is set only when a change is produced and the profile is sibling-compatible', () => {
  const withSibling = buildCeilingLadder('1080p', ladderFrom(RADARR_FACTS), factsFrom(RADARR_FACTS), true);
  assert(withSibling.ladder.sharedLadderNote !== null);
  assertEquals(withSibling.ladder.reshapesSiblingArrs, true);

  const withoutSibling = buildCeilingLadder('1080p', ladderFrom(RADARR_FACTS), factsFrom(RADARR_FACTS), false);
  assertEquals(withoutSibling.ladder.sharedLadderNote, null);
});
