import type { PortableRadarrNaming, PortableSonarrNaming } from '$shared/pcd/portable.ts';
import type { TrashGuideNamingEntity, TrashGuideSupportedArrType } from '../types.ts';

export interface TrashGuideNamingTransformResult {
  portableEntityType: 'radarr_naming' | 'sonarr_naming';
  data: PortableRadarrNaming | PortableSonarrNaming;
}

export function toPortableNaming(
  entity: TrashGuideNamingEntity,
  arrType: TrashGuideSupportedArrType
): TrashGuideNamingTransformResult {
  if (entity.arr_type !== arrType) {
    throw new Error(
      `Naming "${entity.name}" arr_type "${entity.arr_type}" does not match transform arr_type "${arrType}"`
    );
  }

  if (arrType === 'radarr') {
    return {
      portableEntityType: 'radarr_naming',
      data: toPortableRadarrNaming(entity),
    };
  }

  return {
    portableEntityType: 'sonarr_naming',
    data: toPortableSonarrNaming(entity),
  };
}

function toPortableRadarrNaming(entity: TrashGuideNamingEntity): PortableRadarrNaming {
  return {
    name: entity.name,
    rename: true,
    movieFolderFormat: selectTemplate(entity.templates, 'radarr.folder', [['folder', 'default'], ['folder']]),
    movieFormat: selectTemplate(entity.templates, 'radarr.file', [
      ['file', 'standard', 'default'],
      ['file', 'standard'],
      ['file', 'default'],
      ['file'],
    ]),
    replaceIllegalCharacters: true,
    colonReplacementFormat: 'smart',
  };
}

function toPortableSonarrNaming(entity: TrashGuideNamingEntity): PortableSonarrNaming {
  return {
    name: entity.name,
    rename: true,
    seriesFolderFormat: selectTemplate(entity.templates, 'sonarr.series', [['series', 'default'], ['series']]),
    seasonFolderFormat: selectTemplate(entity.templates, 'sonarr.season', [['season', 'default'], ['season']]),
    standardEpisodeFormat: selectTemplate(entity.templates, 'sonarr.episodes.standard', [
      ['episodes', 'standard', 'default'],
      ['episodes', 'standard'],
    ]),
    dailyEpisodeFormat: selectTemplate(entity.templates, 'sonarr.episodes.daily', [
      ['episodes', 'daily', 'default'],
      ['episodes', 'daily'],
    ]),
    animeEpisodeFormat: selectTemplate(entity.templates, 'sonarr.episodes.anime', [
      ['episodes', 'anime', 'default'],
      ['episodes', 'anime'],
    ]),
    replaceIllegalCharacters: true,
    colonReplacementFormat: 'smart',
    customColonReplacementFormat: null,
    multiEpisodeStyle: 'extend',
  };
}

function selectTemplate(
  templates: Readonly<Record<string, unknown>>,
  context: string,
  candidatePaths: readonly (readonly string[])[]
): string {
  for (const path of candidatePaths) {
    const value = readPath(templates, path);
    if (value === undefined) {
      continue;
    }

    const resolved = resolveTemplateValue(value, `${context}.${path.join('.')}`);
    if (resolved !== null) {
      return resolved;
    }
  }

  throw new Error(`Missing naming template mapping for ${context}`);
}

function readPath(record: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function resolveTemplateValue(value: unknown, context: string): string | null {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new Error(`Naming template "${context}" cannot be empty`);
    }
    return value;
  }
  if (!isRecord(value)) {
    throw new Error(`Naming template "${context}" must be a string or object`);
  }

  const defaultValue = value.default;
  if (typeof defaultValue === 'string') {
    if (defaultValue.trim().length === 0) {
      throw new Error(`Naming template "${context}.default" cannot be empty`);
    }
    return defaultValue;
  }

  const resolvedChildren = new Set<string>();
  for (const [key, child] of Object.entries(value)) {
    if (key === 'default') {
      continue;
    }
    const childValue = resolveTemplateValue(child, `${context}.${key}`);
    if (childValue !== null) {
      resolvedChildren.add(childValue);
    }
  }

  if (resolvedChildren.size === 0) {
    return null;
  }
  if (resolvedChildren.size > 1) {
    throw new Error(`Ambiguous naming template mapping for "${context}"`);
  }

  return [...resolvedChildren][0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
