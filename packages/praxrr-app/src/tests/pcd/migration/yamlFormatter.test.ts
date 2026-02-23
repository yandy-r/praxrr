import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { formatDeterministicYaml } from '$pcd/migration/yamlFormatter.ts';

Deno.test('yamlFormatter: rejects payloads with reserved top-level migration key', () => {
  assertThrows(
    () =>
      formatDeterministicYaml({
        migration: {
          format: 'yaml',
          version: 1,
          source: 'unit',
        },
        name: 'ignored',
      }),
    Error,
    'portable payload must not include top-level migration metadata'
  );
});

Deno.test('yamlFormatter: omits undefined top-level values and normalizes array undefined to null', () => {
  const yaml = formatDeterministicYaml({
    name: 'Alpha Regex',
    description: undefined,
    flags: ['alpha', undefined, null, true],
  });

  assertStringIncludes(yaml, 'name: Alpha Regex');
  assertStringIncludes(yaml, 'flags:');
  assertEquals(yaml.includes('description:'), false);
  assertStringIncludes(yaml, '- alpha');
  assertStringIncludes(yaml, '- null');
});

Deno.test('yamlFormatter: rejects non-finite numbers with a path-aware error', () => {
  assertThrows(
    () => formatDeterministicYaml({ score: Number.NaN }),
    Error,
    'portable.score must be a finite number'
  );

  assertThrows(
    () => formatDeterministicYaml({ score: Number.POSITIVE_INFINITY }),
    Error,
    'portable.score must be a finite number'
  );
});

Deno.test('yamlFormatter: enforces migration metadata validation and output ordering', () => {
  const yaml = formatDeterministicYaml(
    { a: 1, b: 2 },
    {
      migration: {
        format: 'yaml',
        version: 1,
        source: 'pcd-export',
      },
    }
  );

  assertStringIncludes(yaml, 'migration:');
  assertStringIncludes(yaml, '  format: yaml');
  assertStringIncludes(yaml, '  version: 1');
  assertStringIncludes(yaml, '  source: pcd-export');
  assertStringIncludes(yaml, 'a: 1');
  assertStringIncludes(yaml, 'b: 2');

  assertThrows(
    () =>
      formatDeterministicYaml({ a: 1 }, { migration: { format: 'yaml', version: 0, source: '' } }),
    Error,
    'migration.version must be an integer >= 1'
  );
});
