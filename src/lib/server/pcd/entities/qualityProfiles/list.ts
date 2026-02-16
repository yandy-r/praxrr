/**
 * Quality profile list queries
 */

import type { PCDCache } from '$pcd/index.ts';
import type {
  CustomFormatCounts,
  CustomFormatCountsByArrType,
  ProfileLanguage,
  QualityItem,
  QualityProfileOption,
  QualityProfileTableRow,
  Tag,
} from '$shared/pcd/display.ts';
import { ARR_APP_TYPES, type ArrAppType, isArrAppType } from '$shared/arr/capabilities.ts';
import { QUALITIES } from '$sync/mappings.ts';
import { parseMarkdown } from '$utils/markdown/markdown.ts';

function createEmptyArrTypeCounts(): CustomFormatCountsByArrType {
  const counts: Partial<CustomFormatCountsByArrType> = {};
  for (const arrType of ARR_APP_TYPES) {
    counts[arrType] = 0;
  }
  return counts as CustomFormatCountsByArrType;
}

function createEmptyCustomFormatCounts(): Omit<CustomFormatCounts, 'total'> {
  return {
    all: 0,
    ...createEmptyArrTypeCounts(),
  };
}

/**
 * Get quality profiles with full data for table/card views
 * Optimized to minimize database queries
 */
export async function list(cache: PCDCache, arrType?: ArrAppType): Promise<QualityProfileTableRow[]> {
  const db = cache.kb;
  const applicableArrTypes: Array<'all' | ArrAppType> | null = arrType ? ['all', arrType] : null;

  // 1. Get all quality profiles
  let profiles = await db
    .selectFrom('quality_profiles')
    .select([
      'id',
      'name',
      'description',
      'upgrades_allowed',
      'minimum_custom_format_score',
      'upgrade_until_score',
      'upgrade_score_increment',
    ])
    .orderBy('name')
    .execute();

  if (profiles.length === 0) return [];

  if (arrType) {
    const supportedRows = await db
      .selectFrom('quality_api_mappings')
      .select(['quality_name', 'api_name'])
      .where('arr_type', '=', arrType)
      .execute();

    const supportedApiNames = new Set(Object.keys(QUALITIES[arrType]));
    const supportedQualityNames = new Set<string>([...supportedApiNames].map((name) => name.toLowerCase()));

    for (const row of supportedRows) {
      const qualityName = row.quality_name?.trim();
      const apiName = row.api_name?.trim();

      if (!qualityName || !apiName) {
        continue;
      }

      if (!supportedApiNames.has(apiName)) {
        continue;
      }

      supportedQualityNames.add(qualityName.toLowerCase());
    }

    if (supportedQualityNames.size === 0) {
      return [];
    }

    const allProfileNames = profiles.map((profile) => profile.name);

    const directEnabledRows = await db
      .selectFrom('quality_profile_qualities')
      .select(['quality_profile_name', 'quality_name'])
      .where('quality_profile_name', 'in', allProfileNames)
      .where('enabled', '=', 1)
      .where('quality_name', 'is not', null)
      .execute();

    const groupEnabledRows = await db
      .selectFrom('quality_profile_qualities as qpq')
      .innerJoin('quality_group_members as qgm', (join) =>
        join
          .onRef('qgm.quality_profile_name', '=', 'qpq.quality_profile_name')
          .onRef('qgm.quality_group_name', '=', 'qpq.quality_group_name')
      )
      .select(['qpq.quality_profile_name', 'qgm.quality_name'])
      .where('qpq.quality_profile_name', 'in', allProfileNames)
      .where('qpq.enabled', '=', 1)
      .where('qpq.quality_group_name', 'is not', null)
      .execute();

    const arrSpecificScoreRows = await db
      .selectFrom('quality_profile_custom_formats')
      .select(['quality_profile_name'])
      .where('quality_profile_name', 'in', allProfileNames)
      .where('arr_type', '=', arrType)
      .execute();
    const hasArrSpecificScores = new Set(arrSpecificScoreRows.map((row) => row.quality_profile_name));

    const enabledQualityNamesByProfile = new Map<string, Set<string>>();
    const addEnabledQualityName = (profileName: string, qualityName: string | null) => {
      if (!qualityName) return;
      if (!enabledQualityNamesByProfile.has(profileName)) {
        enabledQualityNamesByProfile.set(profileName, new Set());
      }
      enabledQualityNamesByProfile.get(profileName)!.add(qualityName.toLowerCase());
    };

    for (const row of directEnabledRows) {
      addEnabledQualityName(row.quality_profile_name, row.quality_name);
    }
    for (const row of groupEnabledRows) {
      addEnabledQualityName(row.quality_profile_name, row.quality_name);
    }

    const compatibleProfileNames = new Set<string>();
    for (const profile of profiles) {
      const enabledQualityNames = enabledQualityNamesByProfile.get(profile.name);
      if (!enabledQualityNames || enabledQualityNames.size === 0) {
        // Fallback for profiles without enabled qualities: require explicit arr-specific score ownership.
        if (hasArrSpecificScores.has(profile.name)) {
          compatibleProfileNames.add(profile.name);
        }
        continue;
      }

      let isCompatible = true;
      for (const qualityName of enabledQualityNames) {
        if (!supportedQualityNames.has(qualityName)) {
          isCompatible = false;
          break;
        }
      }

      if (isCompatible) {
        compatibleProfileNames.add(profile.name);
      }
    }

    profiles = profiles.filter((profile) => compatibleProfileNames.has(profile.name));
    if (profiles.length === 0) {
      return [];
    }
  }

  const profileNames = profiles.map((profile) => profile.name);

  // 2. Get all tags for all profiles
  const allTags = await db
    .selectFrom('quality_profile_tags as qpt')
    .innerJoin('tags as t', 't.name', 'qpt.tag_name')
    .select(['qpt.quality_profile_name', 't.name as tag_name', 't.created_at as tag_created_at'])
    .where('qpt.quality_profile_name', 'in', profileNames)
    .orderBy('qpt.quality_profile_name')
    .orderBy('t.name')
    .execute();

  // 3. Get custom format counts grouped by arr_type
  const formatCountsBaseQuery = db
    .selectFrom('quality_profile_custom_formats')
    .select(['quality_profile_name', 'arr_type'])
    .select((eb) => eb.fn.count('quality_profile_name').as('count'))
    .where('quality_profile_name', 'in', profileNames);

  const formatCounts = applicableArrTypes
    ? await formatCountsBaseQuery
        .where('arr_type', 'in', applicableArrTypes)
        .groupBy(['quality_profile_name', 'arr_type'])
        .execute()
    : await formatCountsBaseQuery.groupBy(['quality_profile_name', 'arr_type']).execute();

  // 4. Get all qualities for all profiles with names
  const allQualities = await db
    .selectFrom('quality_profile_qualities as qpq')
    .leftJoin('qualities as q', 'qpq.quality_name', 'q.name')
    .leftJoin('quality_groups as qg', (join) =>
      join
        .onRef('qpq.quality_group_name', '=', 'qg.name')
        .onRef('qpq.quality_profile_name', '=', 'qg.quality_profile_name')
    )
    .select([
      'qpq.quality_profile_name',
      'qpq.position',
      'qpq.upgrade_until',
      'qpq.quality_name',
      'qpq.quality_group_name',
      'q.name as resolved_quality_name',
      'qg.name as group_name',
    ])
    .where('qpq.quality_profile_name', 'in', profileNames)
    .where('qpq.enabled', '=', 1)
    .orderBy('qpq.quality_profile_name')
    .orderBy('qpq.position')
    .execute();

  // 5. Get languages for all profiles
  const allLanguages = await db
    .selectFrom('quality_profile_languages as qpl')
    .innerJoin('languages as l', 'qpl.language_name', 'l.name')
    .select(['qpl.quality_profile_name', 'l.name as language_name', 'qpl.type'])
    .where('qpl.quality_profile_name', 'in', profileNames)
    .execute();

  // Build maps for efficient lookup
  const tagsMap = new Map<string, Tag[]>();
  for (const tag of allTags) {
    if (!tagsMap.has(tag.quality_profile_name)) {
      tagsMap.set(tag.quality_profile_name, []);
    }
    tagsMap.get(tag.quality_profile_name)!.push({
      name: tag.tag_name,
      created_at: tag.tag_created_at,
    });
  }

  const formatCountsMap = new Map<string, Omit<CustomFormatCounts, 'total'>>();
  for (const fc of formatCounts) {
    if (!formatCountsMap.has(fc.quality_profile_name)) {
      formatCountsMap.set(fc.quality_profile_name, createEmptyCustomFormatCounts());
    }
    const counts = formatCountsMap.get(fc.quality_profile_name)!;
    const count = Number(fc.count);
    if (fc.arr_type === 'all') counts.all = count;
    else if (isArrAppType(fc.arr_type)) counts[fc.arr_type] = count;
  }

  const qualitiesMap = new Map<string, QualityItem[]>();
  for (const qual of allQualities) {
    if (!qualitiesMap.has(qual.quality_profile_name)) {
      qualitiesMap.set(qual.quality_profile_name, []);
    }

    qualitiesMap.get(qual.quality_profile_name)!.push({
      position: qual.position,
      type: qual.quality_name ? 'quality' : 'group',
      name: qual.quality_name || qual.group_name!,
      is_upgrade_until: qual.upgrade_until === 1,
    });
  }

  const languagesMap = new Map<string, ProfileLanguage>();
  for (const lang of allLanguages) {
    languagesMap.set(lang.quality_profile_name, {
      name: lang.language_name,
      type: lang.type as 'must' | 'only' | 'not' | 'simple',
    });
  }

  // Build the final result
  const results = profiles.map((profile) => {
    const counts = formatCountsMap.get(profile.name) || createEmptyCustomFormatCounts();
    const totalCount = counts.all + ARR_APP_TYPES.reduce((sum, arrType) => sum + (counts[arrType] ?? 0), 0);

    const result: QualityProfileTableRow = {
      id: profile.id,
      name: profile.name,
      description: parseMarkdown(profile.description),
      tags: tagsMap.get(profile.name) || [],
      upgrades_allowed: profile.upgrades_allowed === 1,
      minimum_custom_format_score: profile.minimum_custom_format_score,
      custom_formats: {
        ...counts,
        total: totalCount,
      },
      qualities: qualitiesMap.get(profile.name) || [],
      language: languagesMap.get(profile.name),
    };

    // Only include upgrade settings if upgrades are allowed
    if (profile.upgrades_allowed === 1) {
      result.upgrade_until_score = profile.upgrade_until_score;
      result.upgrade_score_increment = profile.upgrade_score_increment;
    }

    return result;
  });

  return results;
}

/**
 * Get all quality profile names from a cache
 */
export async function names(cache: PCDCache): Promise<string[]> {
  const db = cache.kb;

  const profiles = await db.selectFrom('quality_profiles').select(['name']).orderBy('name').execute();

  return profiles.map((p) => p.name);
}

/**
 * Get quality profile options for select/dropdown components
 */
export async function select(cache: PCDCache): Promise<QualityProfileOption[]> {
  const db = cache.kb;

  const profiles = await db.selectFrom('quality_profiles').select(['id', 'name']).orderBy('name').execute();

  return profiles;
}
