/**
 * Create a quality profile operation
 */

import type { PCDCache } from '$pcd/index.ts';
import { writeOperation, type OperationLayer } from '$pcd/index.ts';
import { logger } from '$logger/logger.ts';
import type { ArrAppType } from '$shared/arr/capabilities.ts';
import { buildSeedItems, resolveSeedTarget } from './createSeed.ts';

// ============================================================================
// Input types
// ============================================================================

interface CreateQualityProfileInput {
  name: string;
  description: string | null;
  tags: string[];
  language: string | null;
  /**
   * Target Arr app for the seeded quality ladder. Only qualities this app supports are seeded
   * (Lidarr gets the audio ladder). When omitted, the video apps (Radarr + Sonarr) are inferred.
   */
  arrType?: ArrAppType;
}

interface CreateQualityProfileOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  input: CreateQualityProfileInput;
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Escape a string for SQL
 */
function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Create a quality profile by writing an operation to the specified layer
 */
export async function create(options: CreateQualityProfileOptions) {
  const { databaseId, cache, layer, input } = options;
  const db = cache.kb;

  const queries = [];

  const existing = await db
    .selectFrom('quality_profiles')
    .where((eb) => eb(eb.fn('lower', [eb.ref('name')]), '=', input.name.toLowerCase()))
    .select('name')
    .executeTakeFirst();

  if (existing) {
    await logger.warn(`Duplicate quality profile name "${input.name}"`, {
      source: 'QualityProfile',
      meta: { databaseId, name: input.name },
    });
    throw new Error(`A quality profile with name "${input.name}" already exists`);
  }

  // 1. Insert the quality profile with default values
  const insertProfile = db
    .insertInto('quality_profiles')
    .values({
      name: input.name,
      description: input.description,
      upgrades_allowed: 1,
      minimum_custom_format_score: 0,
      upgrade_until_score: 0,
      upgrade_score_increment: 1,
    })
    .compile();

  queries.push(insertProfile);

  const uniqueTags = Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)));

  // 2. Insert tags (create if not exist, then link)
  for (const tagName of uniqueTags) {
    // Insert tag if not exists
    const insertTag = db
      .insertInto('tags')
      .values({ name: tagName })
      .onConflict((oc) => oc.column('name').doNothing())
      .compile();

    queries.push(insertTag);

    // Link tag to quality profile using name-based FKs
    const linkTag = {
      sql: `INSERT INTO quality_profile_tags (quality_profile_name, tag_name) VALUES ('${esc(input.name)}', '${esc(tagName)}')`,
      parameters: [],
      query: {} as never,
    };

    queries.push(linkTag);
  }

  // 3. Seed the ladder with only the qualities the target Arr app(s) support
  const allQualities = await db.selectFrom('qualities').select(['id', 'name']).orderBy('id').execute();
  const { ladder, supportedQualityNames } = await resolveSeedTarget(cache, input.arrType);
  const orderedItems = buildSeedItems(ladder, allQualities, supportedQualityNames);

  for (const group of orderedItems) {
    if (group.type !== 'group') continue;
    const groupName = group.name;
    const insertGroup = {
      sql: `INSERT INTO quality_groups (quality_profile_name, name) VALUES ('${esc(input.name)}', '${esc(groupName)}')`,
      parameters: [],
      query: {} as never,
    };
    queries.push(insertGroup);

    for (const { name: memberName } of group.members ?? []) {
      const insertMember = {
        sql: `INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('${esc(input.name)}', '${esc(groupName)}', '${esc(memberName)}')`,
        parameters: [],
        query: {} as never,
      };
      queries.push(insertMember);
    }
  }

  // Insert each quality/group into quality_profile_qualities with defaults
  for (const item of orderedItems) {
    const enabled = item.enabled ? 1 : 0;
    const upgradeUntil = item.upgradeUntil ? 1 : 0;
    const insertQuality = {
      sql: `INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('${esc(input.name)}', ${
        item.type === 'quality' ? `'${esc(item.name)}'` : 'NULL'
      }, ${item.type === 'group' ? `'${esc(item.name)}'` : 'NULL'}, ${item.position}, ${enabled}, ${upgradeUntil})`,
      parameters: [],
      query: {} as never,
    };
    queries.push(insertQuality);
  }

  // 4. Insert language if one is selected
  if (input.language !== null) {
    const insertLanguage = {
      sql: `INSERT INTO quality_profile_languages (quality_profile_name, language_name, type) VALUES ('${esc(input.name)}', '${esc(input.language)}', 'simple')`,
      parameters: [],
      query: {} as never,
    };
    queries.push(insertLanguage);
  }

  // Write the operation
  const result = await writeOperation({
    databaseId,
    layer,
    description: `create-quality-profile-${input.name}`,
    queries,
    desiredState: {
      name: input.name,
      description: input.description ?? null,
      tags: uniqueTags,
      language: input.language ?? null,
    },
    metadata: {
      operation: 'create',
      entity: 'quality_profile',
      name: input.name,
      stableKey: { key: 'quality_profile_name', value: input.name },
      summary: 'Create quality profile',
      title: `Create quality profile "${input.name}"`,
    },
  });

  return result;
}
