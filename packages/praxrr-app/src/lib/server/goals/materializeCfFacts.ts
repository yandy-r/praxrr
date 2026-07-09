/**
 * Materialize {@link CfFacts} for the Quality Goals engine from a PCD cache (issue #20).
 *
 * The single read boundary between the cache and the pure engine. Profile-independent: it reads only
 * `custom_formats` (name + description) and their tags — deliberately NOT reusing the profile-scoped
 * `scoring()` read, which pulls per-profile score joins the classifier does not need.
 */

import type { PCDCache } from '$pcd/index.ts';
import type { CfFacts } from '$shared/goals/types.ts';

/** Read every custom format's name, description, and tags from the cache, ordered by name. */
export async function materializeCfFacts(cache: PCDCache): Promise<CfFacts[]> {
  const db = cache.kb;

  const formats = await db.selectFrom('custom_formats').select(['name', 'description']).orderBy('name').execute();
  if (formats.length === 0) return [];

  const names = formats.map((format) => format.name);
  const tagRows = await db
    .selectFrom('custom_format_tags')
    .select(['custom_format_name', 'tag_name'])
    .where('custom_format_name', 'in', names)
    .execute();

  const tagsByCf = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByCf.get(row.custom_format_name) ?? [];
    list.push(row.tag_name);
    tagsByCf.set(row.custom_format_name, list);
  }

  return formats.map((format) => ({
    name: format.name,
    description: format.description,
    tags: tagsByCf.get(format.name) ?? []
  }));
}
