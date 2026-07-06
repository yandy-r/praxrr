import type { PresetCategory, PresetGroup } from './helpers.ts';
import rawPresetData from './presetSamples.json' with { type: 'json' };

type PresetTitle = PresetGroup['titles'][number];

type PresetDataFile = {
  groups: PresetGroup[];
};

const remainingRandomTitlesByCategory: Record<PresetCategory, string[]> = {
  movie: [],
  series: [],
  anime: [],
};

function isPresetCategory(value: unknown): value is PresetCategory {
  return value === 'movie' || value === 'series' || value === 'anime';
}

function isPresetTitle(value: unknown): value is PresetTitle {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeTitle = value as Record<string, unknown>;
  return (
    typeof maybeTitle.label === 'string' &&
    maybeTitle.label.trim().length > 0 &&
    typeof maybeTitle.title === 'string' &&
    maybeTitle.title.trim().length > 0
  );
}

function isPresetGroup(value: unknown): value is PresetGroup {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeGroup = value as Record<string, unknown>;
  return (
    isPresetCategory(maybeGroup.category) &&
    typeof maybeGroup.label === 'string' &&
    maybeGroup.label.trim().length > 0 &&
    typeof maybeGroup.description === 'string' &&
    maybeGroup.description.trim().length > 0 &&
    Array.isArray(maybeGroup.titles) &&
    maybeGroup.titles.length > 0 &&
    maybeGroup.titles.every(isPresetTitle)
  );
}

function parsePresetData(rawData: unknown): PresetDataFile {
  if (!rawData || typeof rawData !== 'object') {
    throw new Error('presetSamples.json must contain an object at the top level.');
  }

  const maybeDataFile = rawData as Record<string, unknown>;
  if (!Array.isArray(maybeDataFile.groups)) {
    throw new Error('presetSamples.json must contain a groups array.');
  }

  if (maybeDataFile.groups.length === 0) {
    throw new Error('presetSamples.json groups array cannot be empty.');
  }

  if (!maybeDataFile.groups.every(isPresetGroup)) {
    throw new Error('presetSamples.json has one or more invalid preset groups.');
  }

  return {
    groups: maybeDataFile.groups,
  };
}

function shuffleTitles(titles: readonly string[], random: () => number): string[] {
  const shuffled = [...titles];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    const boundedIndex = Math.min(Math.max(randomIndex, 0), index);
    const temporary = shuffled[index];
    shuffled[index] = shuffled[boundedIndex];
    shuffled[boundedIndex] = temporary;
  }

  return shuffled;
}

const parsedPresetData = parsePresetData(rawPresetData as unknown);

export const PRESET_GROUPS: PresetGroup[] = parsedPresetData.groups;

export function getPresetsForCategory(category: PresetCategory): PresetGroup[] {
  return PRESET_GROUPS.filter((group) => group.category === category);
}

export function getPresetTitlesForCategory(category: PresetCategory): string[] {
  const titles = getPresetsForCategory(category).flatMap((group) => group.titles.map((title) => title.title));
  const uniqueTitles = new Set(titles);
  return [...uniqueTitles];
}

export function resetPresetRandomState(category?: PresetCategory): void {
  if (category) {
    remainingRandomTitlesByCategory[category] = [];
    return;
  }

  remainingRandomTitlesByCategory.movie = [];
  remainingRandomTitlesByCategory.series = [];
  remainingRandomTitlesByCategory.anime = [];
}

export function getRandomPresetTitleForCategory(
  category: PresetCategory,
  random: () => number = Math.random
): string | null {
  const titles = getPresetTitlesForCategory(category);
  if (titles.length === 0) {
    return null;
  }

  if (remainingRandomTitlesByCategory[category].length === 0) {
    remainingRandomTitlesByCategory[category] = shuffleTitles(titles, random);
  }

  return remainingRandomTitlesByCategory[category].pop() ?? null;
}
