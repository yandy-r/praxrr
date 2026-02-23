import { assertEquals } from '@std/assert';
import { PORTABLE_MIGRATION_MIN_VERSION, validatePortableMigrationMetadata } from '$shared/pcd/portable.ts';

Deno.test('portable migration metadata validates a canonical payload', () => {
  assertEquals(
    validatePortableMigrationMetadata({
      format: 'json',
      version: PORTABLE_MIGRATION_MIN_VERSION,
      source: 'unit-test',
    }),
    null
  );
});

Deno.test('portable migration metadata rejects payload with missing required fields', () => {
  assertEquals(
    validatePortableMigrationMetadata({
      format: 'json',
      source: 'unit-test',
    }),
    'migration is missing required fields: version'
  );
});

Deno.test('portable migration metadata rejects unsupported format values', () => {
  assertEquals(
    validatePortableMigrationMetadata({
      format: 'ini',
      version: PORTABLE_MIGRATION_MIN_VERSION,
      source: 'unit-test',
    }),
    'migration.format must be one of: json, yaml'
  );
});

Deno.test('portable migration metadata rejects version values below minimum', () => {
  assertEquals(
    validatePortableMigrationMetadata({
      format: 'json',
      version: 0,
      source: 'unit-test',
    }),
    `migration.version must be an integer >= ${PORTABLE_MIGRATION_MIN_VERSION}`
  );
});

Deno.test('portable migration metadata rejects unsupported extra fields', () => {
  assertEquals(
    validatePortableMigrationMetadata({
      format: 'json',
      version: PORTABLE_MIGRATION_MIN_VERSION,
      source: 'unit-test',
      legacy: true,
    }),
    'migration contains unsupported fields: legacy'
  );
});
