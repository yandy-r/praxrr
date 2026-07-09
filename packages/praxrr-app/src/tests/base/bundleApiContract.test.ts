import { assert, assertEquals } from '@std/assert';

interface DiscriminatorMapping {
  readonly path: string;
  readonly target: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectDiscriminatorMappings(value: unknown, path = '$'): DiscriminatorMapping[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectDiscriminatorMappings(item, `${path}[${index}]`));
  }
  if (!isRecord(value)) return [];

  const mappings: DiscriminatorMapping[] = [];
  if (isRecord(value.discriminator) && isRecord(value.discriminator.mapping)) {
    for (const [name, target] of Object.entries(value.discriminator.mapping)) {
      if (typeof target === 'string' && target.startsWith('#/')) {
        mappings.push({ path: `${path}.discriminator.mapping.${name}`, target });
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    mappings.push(...collectDiscriminatorMappings(child, `${path}.${key}`));
  }
  return mappings;
}

function resolveLocalJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '#') return root;
  if (!pointer.startsWith('#/')) return undefined;

  let current = root;
  for (const encodedSegment of pointer.slice(2).split('/')) {
    if (!isRecord(current)) return undefined;
    const segment = decodeURIComponent(encodedSegment).replaceAll('~1', '/').replaceAll('~0', '~');
    current = current[segment];
  }
  return current;
}

Deno.test('bundled OpenAPI discriminator mapping pointers resolve to bundled schemas', async () => {
  const specUrl = new URL('../../../../praxrr-api/openapi.json', import.meta.url);
  const spec = JSON.parse(await Deno.readTextFile(specUrl)) as unknown;
  const mappings = collectDiscriminatorMappings(spec);

  assert(mappings.length > 0, 'expected at least one local discriminator mapping pointer');
  for (const mapping of mappings) {
    assertEquals(
      isRecord(resolveLocalJsonPointer(spec, mapping.target)),
      true,
      `${mapping.path} points to missing schema ${mapping.target}`
    );
  }
});
