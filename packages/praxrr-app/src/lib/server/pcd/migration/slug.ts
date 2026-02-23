const DEFAULT_SLUG_FALLBACK = 'export-batch';
const DEFAULT_MAX_SLUG_LENGTH = 60;

export function entityNameToSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, DEFAULT_MAX_SLUG_LENGTH);

  return slug.length > 0 ? slug : DEFAULT_SLUG_FALLBACK;
}

export function resolveEntitySlug(name: string, existingSlugs: Iterable<string> = []): string {
  const baseSlug = entityNameToSlug(name);
  const slugSet = existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs);

  if (!slugSet.has(baseSlug)) {
    return baseSlug;
  }

  let collisionIndex = 2;
  while (true) {
    const collisionSlug = `${baseSlug}-${collisionIndex}`;
    if (!slugSet.has(collisionSlug)) {
      return collisionSlug;
    }
    collisionIndex += 1;
  }
}
