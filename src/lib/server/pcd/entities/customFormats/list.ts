/**
 * Custom format list queries
 */

import type { PCDCache } from '$pcd/index.ts';
import type { Tag, CustomFormatTableRow, ConditionRef } from '$shared/pcd/display.ts';
import type { ArrConditionTargetType } from '$shared/arr/capabilities.ts';

const ARR_TARGET_ORDER: ArrConditionTargetType[] = ['all', 'radarr', 'sonarr', 'lidarr'];

function isArrConditionTargetType(value: string): value is ArrConditionTargetType {
  return ARR_TARGET_ORDER.includes(value as ArrConditionTargetType);
}

/**
 * Get custom formats with full data for table/card views
 */
export async function list(cache: PCDCache): Promise<CustomFormatTableRow[]> {
  const db = cache.kb;

  // 1. Get all custom formats
  const formats = await db.selectFrom('custom_formats').select(['id', 'name', 'description']).orderBy('name').execute();

  if (formats.length === 0) return [];

  const formatNames = formats.map((f) => f.name);

  // 2. Get all tags for all custom formats
  const allTags = await db
    .selectFrom('custom_format_tags as cft')
    .innerJoin('tags as t', 't.name', 'cft.tag_name')
    .select(['cft.custom_format_name', 't.name as tag_name', 't.created_at as tag_created_at'])
    .where('cft.custom_format_name', 'in', formatNames)
    .orderBy('cft.custom_format_name')
    .orderBy('t.name')
    .execute();

  // 3. Get all conditions for all custom formats
  const allConditions = await db
    .selectFrom('custom_format_conditions')
    .select(['custom_format_name', 'name', 'type', 'arr_type', 'required', 'negate'])
    .where('custom_format_name', 'in', formatNames)
    .execute();

  // 4. Get score target mappings for all custom formats
  const allScoreMappings = await db
    .selectFrom('quality_profile_custom_formats')
    .select(['custom_format_name', 'arr_type'])
    .where('custom_format_name', 'in', formatNames)
    .execute();

  // 5. Get test counts for all custom formats
  const testCounts = await db
    .selectFrom('custom_format_tests')
    .select(['custom_format_name'])
    .select((eb) => eb.fn.count('title').as('count'))
    .where('custom_format_name', 'in', formatNames)
    .groupBy('custom_format_name')
    .execute();

  // Build test count map
  const testCountMap = new Map<string, number>();
  for (const tc of testCounts) {
    testCountMap.set(tc.custom_format_name, Number(tc.count));
  }

  // Build tags map
  const tagsMap = new Map<string, Tag[]>();
  for (const tag of allTags) {
    if (!tagsMap.has(tag.custom_format_name)) {
      tagsMap.set(tag.custom_format_name, []);
    }
    tagsMap.get(tag.custom_format_name)!.push({
      name: tag.tag_name,
      created_at: tag.tag_created_at,
    });
  }

  // Build conditions map
  const conditionsMap = new Map<string, ConditionRef[]>();
  const arrTargetsMap = new Map<string, Set<ArrConditionTargetType>>();
  for (const condition of allConditions) {
    if (!conditionsMap.has(condition.custom_format_name)) {
      conditionsMap.set(condition.custom_format_name, []);
    }
    conditionsMap.get(condition.custom_format_name)!.push({
      name: condition.name,
      type: condition.type,
      required: condition.required === 1,
      negate: condition.negate === 1,
    });

    if (isArrConditionTargetType(condition.arr_type)) {
      if (!arrTargetsMap.has(condition.custom_format_name)) {
        arrTargetsMap.set(condition.custom_format_name, new Set());
      }
      arrTargetsMap.get(condition.custom_format_name)!.add(condition.arr_type);
    }
  }

  // Also include arr targets from quality-profile score mappings.
  for (const mapping of allScoreMappings) {
    if (!isArrConditionTargetType(mapping.arr_type)) continue;
    if (!arrTargetsMap.has(mapping.custom_format_name)) {
      arrTargetsMap.set(mapping.custom_format_name, new Set());
    }
    arrTargetsMap.get(mapping.custom_format_name)!.add(mapping.arr_type);
  }

  function getArrTargets(customFormatName: string): ArrConditionTargetType[] {
    const targets = arrTargetsMap.get(customFormatName);
    if (!targets || targets.size === 0) return ['all'];

    const hasSpecificTargets = ARR_TARGET_ORDER.some((target) => target !== 'all' && targets.has(target));
    const orderedTargets = ARR_TARGET_ORDER.filter((target) => targets.has(target));

    // If specific arr targets are present, hide the redundant "all" marker.
    return hasSpecificTargets ? orderedTargets.filter((target) => target !== 'all') : orderedTargets;
  }

  // Build the final result
  return formats.map((format) => ({
    id: format.id,
    name: format.name,
    description: format.description,
    tags: tagsMap.get(format.name) || [],
    conditions: conditionsMap.get(format.name) || [],
    arrTargets: getArrTargets(format.name),
    testCount: testCountMap.get(format.name) || 0,
  }));
}
