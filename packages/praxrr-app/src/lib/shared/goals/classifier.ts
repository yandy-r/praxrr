/**
 * Quality Goals classifier (issue #20).
 *
 * A pure, ordered, first-match rule set that places each custom format into one closed
 * {@link GoalCategory} using the reliable semantic signal on the format: its tags and its name.
 * Descriptions are intentionally NOT matched (they mention other formats via negations). Ordering IS
 * the transparency contract — a CF is assigned the category of the FIRST
 * rule it matches, so `unwanted` (Banned) runs ahead of every reward category and dual-tagged CFs
 * (e.g. "Remux Tier 1", tagged both Release Group Tier and Remux) resolve deterministically.
 *
 * The vocabulary is grounded in the real praxrr default-DB tag set (Title-Case tags, lowercased
 * before matching): Banned, HDR, Colour Grade, Release Group Tier, Remux, Audio, Streaming Service,
 * Edition, Repack, Source, plus resolution tags. Any CF no rule matches is uncategorized and is left
 * untouched by the engine (fail-safe — never mis-scored).
 */

import type { CfFacts, GoalArrType, GoalCategory } from './types.ts';

/**
 * Categories dropped to uncategorized for audio-only Arr apps (lidarr, #222). Every member is a
 * video-domain concept with no proven audio parity: HDR tiers, remux, resolution, editions
 * (`movie_version`), and — pending proven music vocabulary — streaming services and release-group
 * tiers (whose tier group lists are video-derived).
 */
const LIDARR_EXCLUDED_CATEGORIES: ReadonlySet<GoalCategory> = new Set([
  'hdr_dv',
  'hdr_hdr10plus',
  'hdr_baseline',
  'remux',
  'resolution',
  'movie_version',
  'streaming_service',
  'release_group_tier_1',
  'release_group_tier_2',
  'release_group_tier_3',
]);

interface ClassifierRule {
  ruleId: string;
  /** Fixed category, or `null` when resolved dynamically (release-group tiers). */
  category: GoalCategory | null;
  /** Lowercased tag tokens; the rule fires if any is present. */
  matchTags: string[];
  /** Lowercased name substrings; the rule fires if any is present. */
  matchName: string[];
  /** When set, the rule only fires if this lowercased tag is present (AND gate). */
  gateTag?: string;
  /** When set, the rule only fires for this `arrType` (keeps radarr/sonarr rule evaluation identical). */
  arrScope?: GoalArrType;
  /** Special resolver for release-group tiers. */
  dynamic?: 'release_group_tier';
}

/**
 * Ordered first-match rules. Order rationale is load-bearing:
 * - `unwanted` first: a Banned CF (e.g. "Sing Along" = Banned+Edition, "B&W" = Banned+Colour Grade)
 *   must never be scored as a positive edition/HDR format.
 * - name-based HDR tiers (`dolby vision`, `hdr10+`) before the tag-based `hdr_baseline`, since all
 *   HDR CFs share the HDR tag and only the name distinguishes the tier.
 * - `release_group_tier` before `remux`: real "Remux Tier N" CFs are small per-group bonuses
 *   (release-group tiers), not the source-fidelity remux value, which lives in name-only CFs.
 */
export const CATEGORY_RULES: readonly ClassifierRule[] = [
  {
    ruleId: 'rule.unwanted',
    category: 'unwanted',
    matchTags: ['banned'],
    matchName: ['without fallback', 'full disc', 'br-disk', 'brdisk'],
  },
  { ruleId: 'rule.hdr.dv', category: 'hdr_dv', matchTags: [], matchName: ['dolby vision', 'dovi', 'dv hdr'] },
  {
    ruleId: 'rule.hdr.hdr10plus',
    category: 'hdr_hdr10plus',
    matchTags: [],
    matchName: ['hdr10+', 'hdr10 plus', 'hdr10plus'],
  },
  { ruleId: 'rule.hdr.baseline', category: 'hdr_baseline', matchTags: ['hdr'], matchName: ['hdr', 'pq', 'hlg'] },
  {
    ruleId: 'rule.release_group_tier',
    category: null,
    dynamic: 'release_group_tier',
    matchTags: ['release group tier'],
    matchName: ['tier'],
  },
  { ruleId: 'rule.remux', category: 'remux', matchTags: [], matchName: ['remux'] },
  // Lidarr-only audio matchers (#222), grounded in QUALITIES.lidarr + the real Lidarr CFs (FLAC/AAC/
  // Opus). They run before the shared audio rules so Lidarr classification uses audio-domain tokens;
  // `arrScope: 'lidarr'` keeps radarr/sonarr rule evaluation byte-identical.
  {
    ruleId: 'rule.audio.lidarr.lossless',
    category: 'audio_lossless',
    arrScope: 'lidarr',
    gateTag: 'audio',
    matchTags: [],
    matchName: ['flac', 'alac', 'wav', 'ape', 'wavpack'],
  },
  {
    ruleId: 'rule.audio.lidarr.advanced',
    category: 'audio_advanced',
    arrScope: 'lidarr',
    gateTag: 'audio',
    matchTags: [],
    matchName: ['aac', 'opus', 'ogg', 'vorbis', 'mp3-320', 'mp3 320', 'vbr v0'],
  },
  {
    ruleId: 'rule.audio.lossless',
    category: 'audio_lossless',
    gateTag: 'audio',
    matchTags: [],
    matchName: ['truehd', 'flac', 'pcm', 'dts-hd ma', 'dts hd ma', 'lossless'],
  },
  {
    ruleId: 'rule.audio.advanced',
    category: 'audio_advanced',
    gateTag: 'audio',
    matchTags: [],
    matchName: ['atmos', 'dts-x', 'dts:x', 'ddp', 'eac3', 'e-ac-3', 'dolby digital +', 'dd+'],
  },
  { ruleId: 'rule.audio.baseline', category: 'audio_baseline', gateTag: 'audio', matchTags: [], matchName: [] },
  { ruleId: 'rule.streaming_service', category: 'streaming_service', matchTags: ['streaming service'], matchName: [] },
  {
    ruleId: 'rule.movie_version',
    category: 'movie_version',
    matchTags: ['edition'],
    matchName: ['imax', 'hybrid', 'remaster', 'special edition', 'uncut', 'director', 'theatrical'],
  },
  { ruleId: 'rule.repack_proper', category: 'repack_proper', matchTags: ['repack'], matchName: ['repack', 'proper'] },
  {
    ruleId: 'rule.resolution',
    category: 'resolution',
    matchTags: ['2160p', '1080p', '720p', '480p', '576p'],
    matchName: ['2160p', '1080p', '720p', '480p', '576p', '4k', 'uhd'],
  },
] as const;

export const FALLBACK_RULE_ID = 'rule.fallback.no-match';

/**
 * Distinguishes a CF dropped by the Lidarr video-only exclusion filter (#222) from one that simply
 * matched no rule. The engine maps this ruleId to the user-facing `excluded.video-only-on-lidarr`
 * reason so the UI can explain the skip instead of showing it as a coverage gap.
 */
export const EXCLUDED_RULE_ID = 'rule.excluded.video-only';

/** Resolution ordinal: 0 = SD/DVD, 1 = 720p, 2 = 1080p, 3 = 2160p/4K/UHD. `undefined` if none. */
export type ResolutionLevel = 0 | 1 | 2 | 3;

export interface CfClassification {
  category: GoalCategory | null;
  ruleId: string;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function ruleMatches(rule: ClassifierRule, tags: ReadonlySet<string>, haystack: string): boolean {
  if (rule.gateTag && !tags.has(rule.gateTag)) return false;
  if (rule.matchTags.some((tag) => tags.has(tag))) return true;
  if (rule.matchName.some((token) => haystack.includes(token))) return true;
  // A gate-only rule (e.g. audio baseline) fires on the gate tag alone.
  return Boolean(rule.gateTag) && rule.matchTags.length === 0 && rule.matchName.length === 0;
}

/** Resolve the release-group tier ordinal from a tier digit in the name (1, 2, else 3). */
function resolveReleaseGroupTier(nameLower: string): GoalCategory {
  const match = nameLower.match(/tier\s*(\d+)/);
  const tier = match ? Number(match[1]) : 3;
  if (tier <= 1) return 'release_group_tier_1';
  if (tier === 2) return 'release_group_tier_2';
  return 'release_group_tier_3';
}

/**
 * Detect a CF's resolution independently of its category, keying off BOTH name and tags — e.g.
 * "UHD Bluray" has the resolution only in its tag, "2160p Quality Tier 1" in its tag, "1080p Bluray"
 * in its name. Feeds the ceiling gate for any CF with a detectable resolution.
 */
export function detectResolutionLevel(facts: CfFacts): ResolutionLevel | undefined {
  const haystack = `${lower(facts.name)} ${facts.tags.map(lower).join(' ')}`;
  if (/2160p|\buhd\b|\b4k\b/.test(haystack)) return 3;
  if (/1080p/.test(haystack)) return 2;
  if (/720p/.test(haystack)) return 1;
  if (/480p|576p|\bdvd\b/.test(haystack)) return 0;
  return undefined;
}

/**
 * Classify one custom format. Pure and deterministic: first matching rule wins. For `arrType`
 * 'lidarr', video-only categories are dropped to uncategorized (forward seam).
 */
export function classifyCustomFormat(facts: CfFacts, arrType: GoalArrType): CfClassification {
  const tags = new Set(facts.tags.map(lower));
  // Match name tokens against the NAME only — descriptions routinely mention OTHER formats via
  // negations/comparisons (e.g. "...that are NOT remuxes", "...without Dolby Vision"), so substring
  // matching on the description would invert intent and mis-score real custom formats.
  const haystack = lower(facts.name);

  for (const rule of CATEGORY_RULES) {
    // arrScope-gated rules (e.g. the Lidarr audio matchers) only fire for their arrType, so the
    // radarr/sonarr rule set is untouched.
    if (rule.arrScope && rule.arrScope !== arrType) continue;
    if (!ruleMatches(rule, tags, haystack)) continue;
    const category = rule.dynamic === 'release_group_tier' ? resolveReleaseGroupTier(lower(facts.name)) : rule.category;
    if (category && arrType === 'lidarr' && LIDARR_EXCLUDED_CATEGORIES.has(category)) {
      return { category: null, ruleId: EXCLUDED_RULE_ID };
    }
    return { category, ruleId: rule.ruleId };
  }

  return { category: null, ruleId: FALLBACK_RULE_ID };
}
