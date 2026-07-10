/**
 * Projection: resolved Portable payload -> flat list of `LeafRef`s.
 *
 * Each `LeafRef` names a serializer-emitted leaf's byte-identical `diffToFieldChanges` path
 * plus the SQLite `(table, rowValues, column)` that backs it. The engine turns each `LeafRef`
 * into a `FieldLineage` by looking up the capture index + schema defaults. Genuinely
 * unattributable leaves (`column: null`) are surfaced as `unavailable` rather than mis-mapped.
 *
 * Path rendering mirrors `sync/preview/diff.ts` exactly: object keys are dot-joined with no
 * leading dot; keyed-array items render `path[JSON.stringify(key)]`; plain/nested arrays render
 * `path[index]`. Ignored keys (`id`, timestamps, ...) that the diff engine strips are not
 * emitted here either, so lineage paths align 1:1 with `overrides`.
 */

import type {
  PortableCustomFormat,
  PortableDelayProfile,
  PortableLidarrMetadataProfile,
  PortableLidarrNaming,
  PortableMediaSettings,
  PortableQualityDefinitions,
  PortableQualityProfile,
  PortableRadarrNaming,
  PortableRegularExpression,
  PortableSonarrNaming,
} from '$shared/pcd/portable.ts';
import type { ArrAppType } from '$shared/arr/capabilities.ts';
import type { ResolvedEntityPayload, ResolvedEntityType } from '../types.ts';

/** One serializer-emitted leaf: its diff path + the SQLite cell that backs it. */
export interface LeafRef {
  readonly fieldPath: string;
  readonly table: string;
  /** Business-key column values identifying the backing row. */
  readonly rowValues: Record<string, unknown>;
  /** Backing column, or null when the leaf has no single backing column (-> `unavailable`). */
  readonly column: string | null;
}

// ============================================================================
// PATH HELPERS (mirror sync/preview/diff.ts)
// ============================================================================

function keyedPath(arrayPath: string, key: string): string {
  return `${arrayPath}[${JSON.stringify(key)}]`;
}

function indexPath(arrayPath: string, index: number): string {
  return `${arrayPath}[${index}]`;
}

function dot(base: string, field: string): string {
  return `${base}.${field}`;
}

// ============================================================================
// LEAF COLLECTOR
// ============================================================================

class LeafCollector {
  readonly leaves: LeafRef[] = [];

  scalar(fieldPath: string, table: string, rowValues: Record<string, unknown>, column: string): void {
    this.leaves.push({ fieldPath, table, rowValues, column });
  }

  unavailable(fieldPath: string): void {
    this.leaves.push({ fieldPath, table: '', rowValues: {}, column: null });
  }
}

// ============================================================================
// PER-ENTITY WALKERS
// ============================================================================

function collectDelayProfile(c: LeafCollector, p: PortableDelayProfile): void {
  const t = 'delay_profiles';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('preferredProtocol', t, rv, 'preferred_protocol');
  c.scalar('usenetDelay', t, rv, 'usenet_delay');
  c.scalar('torrentDelay', t, rv, 'torrent_delay');
  c.scalar('bypassIfHighestQuality', t, rv, 'bypass_if_highest_quality');
  c.scalar('bypassIfAboveCfScore', t, rv, 'bypass_if_above_custom_format_score');
  c.scalar('minimumCfScore', t, rv, 'minimum_custom_format_score');
}

function collectRegularExpression(c: LeafCollector, p: PortableRegularExpression): void {
  const t = 'regular_expressions';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('pattern', t, rv, 'pattern');
  c.scalar('description', t, rv, 'description');
  c.scalar('regex101Id', t, rv, 'regex101_id');
  p.tags.forEach((tag, i) => {
    c.scalar(
      indexPath('tags', i),
      'regular_expression_tags',
      { regular_expression_name: p.name, tag_name: tag },
      'tag_name'
    );
  });
}

function collectCustomFormat(c: LeafCollector, p: PortableCustomFormat): void {
  const t = 'custom_formats';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('description', t, rv, 'description');
  c.scalar('includeInRename', t, rv, 'include_in_rename');
  p.tags.forEach((tag, i) => {
    c.scalar(indexPath('tags', i), 'custom_format_tags', { custom_format_name: p.name, tag_name: tag }, 'tag_name');
  });

  for (const cond of p.conditions) {
    const base = keyedPath('conditions', cond.name);
    const condTable = 'custom_format_conditions';
    const condRow = { custom_format_name: p.name, name: cond.name };
    c.scalar(dot(base, 'name'), condTable, condRow, 'name');
    c.scalar(dot(base, 'type'), condTable, condRow, 'type');
    c.scalar(dot(base, 'arrType'), condTable, condRow, 'arr_type');
    c.scalar(dot(base, 'negate'), condTable, condRow, 'negate');
    c.scalar(dot(base, 'required'), condTable, condRow, 'required');
    collectConditionTypeData(c, p.name, cond, base);
  }

  for (const test of p.tests) {
    const base = keyedPath('tests', test.title);
    const testTable = 'custom_format_tests';
    const testRow = { custom_format_name: p.name, title: test.title, type: test.type };
    c.scalar(dot(base, 'title'), testTable, testRow, 'title');
    c.scalar(dot(base, 'type'), testTable, testRow, 'type');
    c.scalar(dot(base, 'shouldMatch'), testTable, testRow, 'should_match');
    c.scalar(dot(base, 'description'), testTable, testRow, 'description');
  }
}

function collectConditionTypeData(
  c: LeafCollector,
  cfName: string,
  cond: PortableCustomFormat['conditions'][number],
  base: string
): void {
  const condRow = { custom_format_name: cfName, condition_name: cond.name };
  if (cond.patterns) {
    cond.patterns.forEach((pat, i) => {
      const itemBase = indexPath(dot(base, 'patterns'), i);
      // The FK name is owned by the condition row; the pattern text is owned by the regex entity.
      c.scalar(dot(itemBase, 'name'), 'condition_patterns', condRow, 'regular_expression_name');
      c.scalar(dot(itemBase, 'pattern'), 'regular_expressions', { name: pat.name }, 'pattern');
    });
  }
  if (cond.languages) {
    cond.languages.forEach((lang, i) => {
      const itemBase = indexPath(dot(base, 'languages'), i);
      c.scalar(dot(itemBase, 'name'), 'condition_languages', condRow, 'language_name');
      c.scalar(dot(itemBase, 'except'), 'condition_languages', condRow, 'except_language');
    });
  }
  scalarArray(c, cond.sources, dot(base, 'sources'), 'condition_sources', condRow, 'source');
  scalarArray(c, cond.resolutions, dot(base, 'resolutions'), 'condition_resolutions', condRow, 'resolution');
  scalarArray(
    c,
    cond.qualityModifiers,
    dot(base, 'qualityModifiers'),
    'condition_quality_modifiers',
    condRow,
    'quality_modifier'
  );
  scalarArray(c, cond.releaseTypes, dot(base, 'releaseTypes'), 'condition_release_types', condRow, 'release_type');
  scalarArray(c, cond.indexerFlags, dot(base, 'indexerFlags'), 'condition_indexer_flags', condRow, 'flag');
  if (cond.size) {
    c.scalar(dot(dot(base, 'size'), 'minBytes'), 'condition_sizes', condRow, 'min_bytes');
    c.scalar(dot(dot(base, 'size'), 'maxBytes'), 'condition_sizes', condRow, 'max_bytes');
  }
  if (cond.years) {
    c.scalar(dot(dot(base, 'years'), 'minYear'), 'condition_years', condRow, 'min_year');
    c.scalar(dot(dot(base, 'years'), 'maxYear'), 'condition_years', condRow, 'max_year');
  }
}

function scalarArray(
  c: LeafCollector,
  values: string[] | undefined,
  arrayPath: string,
  table: string,
  rowValues: Record<string, unknown>,
  column: string
): void {
  if (!values) return;
  values.forEach((_, i) => c.scalar(indexPath(arrayPath, i), table, rowValues, column));
}

function collectQualityProfile(c: LeafCollector, p: PortableQualityProfile): void {
  const t = 'quality_profiles';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('description', t, rv, 'description');
  c.scalar('minimumScore', t, rv, 'minimum_custom_format_score');
  c.scalar('upgradeUntilScore', t, rv, 'upgrade_until_score');
  c.scalar('upgradeScoreIncrement', t, rv, 'upgrade_score_increment');
  p.tags.forEach((tag, i) => {
    c.scalar(indexPath('tags', i), 'quality_profile_tags', { quality_profile_name: p.name, tag_name: tag }, 'tag_name');
  });
  if (p.language !== null) {
    c.scalar(
      'language',
      'quality_profile_languages',
      { quality_profile_name: p.name, language_name: p.language },
      'language_name'
    );
  }

  for (const item of p.orderedItems) {
    const base = keyedPath('orderedItems', item.name);
    const isGroup = item.type === 'group';
    const qpqRow = {
      quality_profile_name: p.name,
      quality_name: isGroup ? null : item.name,
      quality_group_name: isGroup ? item.name : null,
    };
    // `type` and `name` are computed from which column is populated; anchor lineage to the
    // discriminator/value column of the quality_profile_qualities row.
    c.scalar(dot(base, 'type'), 'quality_profile_qualities', qpqRow, 'quality_group_name');
    c.scalar(dot(base, 'name'), 'quality_profile_qualities', qpqRow, isGroup ? 'quality_group_name' : 'quality_name');
    c.scalar(dot(base, 'position'), 'quality_profile_qualities', qpqRow, 'position');
    c.scalar(dot(base, 'enabled'), 'quality_profile_qualities', qpqRow, 'enabled');
    c.scalar(dot(base, 'upgradeUntil'), 'quality_profile_qualities', qpqRow, 'upgrade_until');
    if (item.members) {
      item.members.forEach((member, i) => {
        const memberPath = dot(indexPath(dot(base, 'members'), i), 'name');
        c.scalar(
          memberPath,
          'quality_group_members',
          { quality_profile_name: p.name, quality_group_name: item.name, quality_name: member.name },
          'quality_name'
        );
      });
    }
  }

  for (const score of p.customFormatScores) {
    const key = `${score.customFormatName}:${score.arrType}`;
    const base = keyedPath('customFormatScores', key);
    const scoreRow = {
      quality_profile_name: p.name,
      custom_format_name: score.customFormatName,
      arr_type: score.arrType,
    };
    c.scalar(dot(base, 'customFormatName'), 'quality_profile_custom_formats', scoreRow, 'custom_format_name');
    c.scalar(dot(base, 'arrType'), 'quality_profile_custom_formats', scoreRow, 'arr_type');
    c.scalar(dot(base, 'score'), 'quality_profile_custom_formats', scoreRow, 'score');
  }
}

function collectRadarrNaming(c: LeafCollector, p: PortableRadarrNaming): void {
  const t = 'radarr_naming';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('rename', t, rv, 'rename');
  c.scalar('movieFormat', t, rv, 'movie_format');
  c.scalar('movieFolderFormat', t, rv, 'movie_folder_format');
  c.scalar('replaceIllegalCharacters', t, rv, 'replace_illegal_characters');
  c.scalar('colonReplacementFormat', t, rv, 'colon_replacement_format');
}

function collectSonarrNaming(c: LeafCollector, p: PortableSonarrNaming): void {
  const t = 'sonarr_naming';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('rename', t, rv, 'rename');
  c.scalar('standardEpisodeFormat', t, rv, 'standard_episode_format');
  c.scalar('dailyEpisodeFormat', t, rv, 'daily_episode_format');
  c.scalar('animeEpisodeFormat', t, rv, 'anime_episode_format');
  c.scalar('seriesFolderFormat', t, rv, 'series_folder_format');
  c.scalar('seasonFolderFormat', t, rv, 'season_folder_format');
  c.scalar('replaceIllegalCharacters', t, rv, 'replace_illegal_characters');
  c.scalar('colonReplacementFormat', t, rv, 'colon_replacement_format');
  c.scalar('customColonReplacementFormat', t, rv, 'custom_colon_replacement_format');
  c.scalar('multiEpisodeStyle', t, rv, 'multi_episode_style');
}

function collectLidarrNaming(c: LeafCollector, p: PortableLidarrNaming): void {
  const t = 'lidarr_naming';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('rename', t, rv, 'rename');
  c.scalar('standardTrackFormat', t, rv, 'standard_track_format');
  c.scalar('artistName', t, rv, 'artist_name');
  c.scalar('multiDiscTrackFormat', t, rv, 'multi_disc_track_format');
  c.scalar('artistFolderFormat', t, rv, 'artist_folder_format');
  c.scalar('replaceIllegalCharacters', t, rv, 'replace_illegal_characters');
  c.scalar('colonReplacementFormat', t, rv, 'colon_replacement_format');
  c.scalar('customColonReplacementFormat', t, rv, 'custom_colon_replacement_format');
}

function collectMediaSettings(c: LeafCollector, p: PortableMediaSettings, table: string): void {
  const rv = { name: p.name };
  c.scalar('name', table, rv, 'name');
  c.scalar('propersRepacks', table, rv, 'propers_repacks');
  c.scalar('enableMediaInfo', table, rv, 'enable_media_info');
}

function collectQualityDefinitions(c: LeafCollector, p: PortableQualityDefinitions, table: string): void {
  // The config `name` is a grouping key spanning every entry row (PK is `(name, quality_name)`), so
  // it has no single backing cell — attribute honestly as unavailable rather than pick an arbitrary
  // entry row. Each `entries[...]` leaf below is a single row and IS attributable.
  c.unavailable('name');
  for (const entry of p.entries) {
    const base = keyedPath('entries', entry.quality_name);
    const row = { name: p.name, quality_name: entry.quality_name };
    c.scalar(dot(base, 'quality_name'), table, row, 'quality_name');
    c.scalar(dot(base, 'min_size'), table, row, 'min_size');
    c.scalar(dot(base, 'max_size'), table, row, 'max_size');
    c.scalar(dot(base, 'preferred_size'), table, row, 'preferred_size');
  }
}

function collectLidarrMetadataProfile(c: LeafCollector, p: PortableLidarrMetadataProfile): void {
  const t = 'lidarr_metadata_profiles';
  const rv = { name: p.name };
  c.scalar('name', t, rv, 'name');
  c.scalar('description', t, rv, 'description');
  collectMetadataTypes(c, p.name, p.primaryTypes, 'primaryTypes', 'lidarr_metadata_profile_primary_types', 'type_id');
  collectMetadataTypes(
    c,
    p.name,
    p.secondaryTypes,
    'secondaryTypes',
    'lidarr_metadata_profile_secondary_types',
    'type_id'
  );
  collectMetadataTypes(
    c,
    p.name,
    p.releaseStatuses,
    'releaseStatuses',
    'lidarr_metadata_profile_release_statuses',
    'status_id'
  );
}

function collectMetadataTypes(
  c: LeafCollector,
  profileName: string,
  items: PortableLidarrMetadataProfile['primaryTypes'],
  arrayPath: string,
  table: string,
  idColumn: string
): void {
  for (const item of items) {
    const base = keyedPath(arrayPath, item.name);
    const row = { metadata_profile_name: profileName, [idColumn]: item.id };
    // `id` is stripped by the diff engine, so it is not emitted here.
    c.scalar(dot(base, 'name'), table, row, 'name');
    c.scalar(dot(base, 'allowed'), table, row, 'allowed');
  }
}

// ============================================================================
// DISPATCH
// ============================================================================

/**
 * Collect the flat leaf list for a resolved entity. `arrType` selects the backing table for
 * per-Arr entity families. Throws for an unmapped `(entityType, arrType)` — callers validate
 * first via the readers dispatch, so this only fires on a programming error.
 */
export function collectEntityLeaves(
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  payload: ResolvedEntityPayload
): LeafRef[] {
  const c = new LeafCollector();
  switch (entityType) {
    case 'delayProfile':
      collectDelayProfile(c, payload as PortableDelayProfile);
      break;
    case 'regularExpression':
      collectRegularExpression(c, payload as PortableRegularExpression);
      break;
    case 'customFormat':
      collectCustomFormat(c, payload as PortableCustomFormat);
      break;
    case 'qualityProfile':
      collectQualityProfile(c, payload as PortableQualityProfile);
      break;
    case 'naming':
      if (arrType === 'radarr') collectRadarrNaming(c, payload as PortableRadarrNaming);
      else if (arrType === 'sonarr') collectSonarrNaming(c, payload as PortableSonarrNaming);
      else if (arrType === 'lidarr') collectLidarrNaming(c, payload as PortableLidarrNaming);
      else throw new Error(`naming lineage requires a supported arrType (got ${arrType})`);
      break;
    case 'mediaSettings':
      collectMediaSettings(c, payload as PortableMediaSettings, mediaSettingsTable(arrType));
      break;
    case 'qualityDefinitions':
      collectQualityDefinitions(c, payload as PortableQualityDefinitions, qualityDefinitionsTable(arrType));
      break;
    case 'lidarrMetadataProfile':
      collectLidarrMetadataProfile(c, payload as PortableLidarrMetadataProfile);
      break;
    default: {
      const exhaustive: never = entityType;
      throw new Error(`Unhandled resolved entity type: ${String(exhaustive)}`);
    }
  }
  return c.leaves;
}

function mediaSettingsTable(arrType: ArrAppType | undefined): string {
  if (arrType === 'radarr') return 'radarr_media_settings';
  if (arrType === 'sonarr') return 'sonarr_media_settings';
  if (arrType === 'lidarr') return 'lidarr_media_settings';
  throw new Error(`mediaSettings lineage requires a supported arrType (got ${arrType})`);
}

function qualityDefinitionsTable(arrType: ArrAppType | undefined): string {
  if (arrType === 'radarr') return 'radarr_quality_definitions';
  if (arrType === 'sonarr') return 'sonarr_quality_definitions';
  if (arrType === 'lidarr') return 'lidarr_quality_definitions';
  throw new Error(`qualityDefinitions lineage requires a supported arrType (got ${arrType})`);
}
