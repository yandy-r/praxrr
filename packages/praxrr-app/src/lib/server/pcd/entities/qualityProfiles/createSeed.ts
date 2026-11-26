/**
 * Default quality ladder seeded into a newly created quality profile.
 *
 * Seeding is scoped per target Arr app (YAN-1811): only qualities supported by the target app(s),
 * per `getSupportedQualityNames`, are written. A video ladder is used for Radarr/Sonarr and an
 * audio ladder for Lidarr; there is no cross-app fallback.
 */

import type { PCDCache } from '$pcd/index.ts';
import { ARR_APP_TYPES, type ArrAppType } from '$shared/arr/capabilities.ts';
import type { OrderedItem } from '$shared/pcd/display.ts';
import { getSupportedQualityNames } from './compatibility.ts';

/** One ladder entry, highest preference first (position 1 = top of the profile). */
export type SeedEntry =
  | { type: 'quality'; name: string; enabled?: boolean; upgradeUntil?: boolean }
  | { type: 'group'; name: string; members: readonly string[]; enabled?: boolean; upgradeUntil?: boolean };

/** Radarr/Sonarr default ladder (pre-YAN-1811 behavior, minus app-unsupported qualities). */
export const VIDEO_SEED_LADDER: readonly SeedEntry[] = [
  { type: 'quality', name: 'Remux-2160p' },
  { type: 'quality', name: 'Bluray-2160p' },
  { type: 'quality', name: 'WEBDL-2160p' },
  { type: 'quality', name: 'WEBRip-2160p' },
  { type: 'quality', name: 'HDTV-2160p' },
  { type: 'quality', name: 'Remux-1080p', enabled: true },
  { type: 'quality', name: 'Bluray-1080p', enabled: true, upgradeUntil: true },
  { type: 'group', name: 'WEB 1080p', members: ['WEBDL-1080p', 'WEBRip-1080p'] },
  { type: 'quality', name: 'HDTV-1080p' },
  { type: 'quality', name: 'Bluray-720p' },
  { type: 'quality', name: 'WEBDL-720p' },
  { type: 'quality', name: 'WEBRip-720p' },
  { type: 'quality', name: 'HDTV-720p' },
  { type: 'quality', name: 'Bluray-576p' },
  { type: 'quality', name: 'Bluray-480p' },
  { type: 'quality', name: 'WEBDL-480p' },
  { type: 'quality', name: 'WEBRip-480p' },
  { type: 'quality', name: 'HDTV-480p' },
  { type: 'quality', name: 'DVD-R' },
  { type: 'quality', name: 'DVD' },
  { type: 'quality', name: 'SDTV' },
  {
    type: 'group',
    name: 'Pre-releases',
    members: ['REGIONAL', 'DVDSCR', 'TELECINE', 'TELESYNC', 'CAM', 'WORKPRINT'],
  },
  { type: 'group', name: 'Unwanted', members: ['Unknown', 'Raw-HD', 'BR-DISK'] },
];

/**
 * Lidarr default ladder. Groups follow Lidarr's own quality-definition groups
 * (`NzbDrone.Core.Qualities.Quality.DefaultQualityDefinitions`); lossless and high-quality lossy
 * are allowed, with lossless as the upgrade-until target.
 */
export const AUDIO_SEED_LADDER: readonly SeedEntry[] = [
  { type: 'quality', name: 'WAV' },
  {
    type: 'group',
    name: 'Lossless',
    members: ['FLAC', 'ALAC', 'APE', 'WavPack', 'FLAC 24bit', 'ALAC 24bit'],
    enabled: true,
    upgradeUntil: true,
  },
  {
    type: 'group',
    name: 'High Quality Lossy',
    members: ['MP3-VBR-V0', 'AAC-VBR', 'MP3-320', 'OGG Vorbis Q9', 'AAC-320', 'OGG Vorbis Q10'],
    enabled: true,
  },
  {
    type: 'group',
    name: 'Mid Quality Lossy',
    members: ['OGG Vorbis Q7', 'MP3-VBR-V2', 'MP3-256', 'OGG Vorbis Q8', 'AAC-256'],
  },
  {
    type: 'group',
    name: 'Low Quality Lossy',
    members: ['MP3-192', 'OGG Vorbis Q6', 'AAC-192', 'WMA', 'MP3-224'],
  },
  {
    type: 'group',
    name: 'Poor Quality Lossy',
    members: ['MP3-96', 'MP3-112', 'MP3-128', 'OGG Vorbis Q5', 'MP3-160'],
  },
  {
    type: 'group',
    name: 'Trash Quality Lossy',
    members: ['MP3-8', 'MP3-16', 'MP3-24', 'MP3-32', 'MP3-40', 'MP3-48', 'MP3-56', 'MP3-64', 'MP3-80'],
  },
  { type: 'quality', name: 'Unknown' },
];

/**
 * Target apps used when the caller does not name one: the video apps the default video ladder's
 * enabled qualities are compatible with. Seeds the union of their supported qualities, which is
 * what the Qualities editor offers a multi-app profile.
 */
export const INFERRED_SEED_ARR_TYPES: readonly ArrAppType[] = ['radarr', 'sonarr'];

export interface SeedTarget {
  arrTypes: readonly ArrAppType[];
  ladder: readonly SeedEntry[];
  /** Lower-cased quality names supported by at least one target app. */
  supportedQualityNames: ReadonlySet<string>;
}

/**
 * Resolve the ladder and supported-quality set for an explicit `arrType`, or infer the video
 * apps when omitted. Unknown Arr types fail fast.
 */
export async function resolveSeedTarget(cache: PCDCache, arrType: ArrAppType | undefined): Promise<SeedTarget> {
  if (arrType !== undefined && !(ARR_APP_TYPES as readonly string[]).includes(arrType)) {
    throw new Error(`Unsupported Arr type "${String(arrType)}" for quality profile creation`);
  }

  const arrTypes = arrType ? [arrType] : INFERRED_SEED_ARR_TYPES;
  const supportedQualityNames = new Set<string>();
  for (const target of arrTypes) {
    for (const name of await getSupportedQualityNames(cache, target)) {
      supportedQualityNames.add(name);
    }
  }

  return {
    arrTypes,
    ladder: arrType === 'lidarr' ? AUDIO_SEED_LADDER : VIDEO_SEED_LADDER,
    supportedQualityNames,
  };
}

/**
 * Build the ordered profile items from `ladder`, keeping only qualities present in the PCD
 * `qualities` table AND supported by the target app(s). A group keeps its supported members; it
 * collapses to a single quality when one remains (Arr apps reject single-item groups) and is
 * dropped when none remain. Supported qualities absent from the ladder are appended disabled, in
 * `qualities` order.
 */
export function buildSeedItems(
  ladder: readonly SeedEntry[],
  allQualities: readonly { name: string }[],
  supportedQualityNames: ReadonlySet<string>
): OrderedItem[] {
  const seedable = new Map<string, string>();
  for (const quality of allQualities) {
    const lower = quality.name.toLowerCase();
    if (supportedQualityNames.has(lower) && !seedable.has(lower)) seedable.set(lower, quality.name);
  }

  const used = new Set<string>();
  const take = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    const resolved = seedable.get(lower);
    if (!resolved || used.has(lower)) return undefined;
    used.add(lower);
    return resolved;
  };

  const items: OrderedItem[] = [];
  const push = (item: Omit<OrderedItem, 'position'>) => items.push({ ...item, position: items.length + 1 });

  for (const entry of ladder) {
    const enabled = entry.enabled ?? false;
    const upgradeUntil = entry.upgradeUntil ?? false;

    if (entry.type === 'quality') {
      const name = take(entry.name);
      if (name) push({ type: 'quality', name, enabled, upgradeUntil, members: [] });
      continue;
    }

    const members = entry.members.map(take).filter((name): name is string => name !== undefined);
    if (members.length >= 2) {
      push({
        type: 'group',
        name: entry.name,
        enabled,
        upgradeUntil,
        members: members.map((name) => ({ name })),
      });
    } else if (members.length === 1) {
      push({ type: 'quality', name: members[0], enabled, upgradeUntil, members: [] });
    }
  }

  for (const quality of allQualities) {
    const name = take(quality.name);
    if (name) push({ type: 'quality', name, enabled: false, upgradeUntil: false, members: [] });
  }

  return items;
}
