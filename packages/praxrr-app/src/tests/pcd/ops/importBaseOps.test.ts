import { assertEquals, assertThrows } from '@std/assert';
import { __testOnly_validateStableIdentityConflicts } from '$pcd/ops/importBaseOps.ts';

type TestStableIdentity = { key: string; value: string; kind: 'stable' };

const duplicateIdentity: TestStableIdentity = {
  key: 'quality_profile_name',
  value: 'Existing Profile',
  kind: 'stable',
};

const migrationEntry = (identity: TestStableIdentity | null, sourcePath: string) => ({
  stableIdentity: identity,
  sourcePath,
});

const sqlEntry = (identity: TestStableIdentity | null, name: string) => ({
  name,
  filepath: `/tmp/${name}`,
  opNumber: 1,
  sequence: 100,
  cleanedSql: 'SELECT 1',
  metadataJson: null,
  contentHash: 'hash',
  stableIdentity: identity,
});

Deno.test('importBaseOps: validateStableIdentityConflicts detects SQL/SQL duplicates', () => {
  assertThrows(
    () =>
      __testOnly_validateStableIdentityConflicts(
        [sqlEntry(duplicateIdentity, '001-base.sql'), sqlEntry(duplicateIdentity, '002-base.sql')],
        []
      ),
    Error,
    'sql/duplicate'
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts detects migration/migration duplicates', () => {
  assertThrows(
    () =>
      __testOnly_validateStableIdentityConflicts(
        [],
        [
          migrationEntry(duplicateIdentity, '/path/entity-1.yaml'),
          migrationEntry(duplicateIdentity, '/path/entity-2.yaml'),
        ]
      ),
    Error,
    'migration/duplicate'
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts detects cross-source duplicates', () => {
  assertThrows(
    () =>
      __testOnly_validateStableIdentityConflicts(
        [sqlEntry(duplicateIdentity, '001-base.sql')],
        [migrationEntry(duplicateIdentity, '/path/entity.yaml')]
      ),
    Error,
    'cross-source'
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts allows distinct identities', () => {
  const migrationIdentity: TestStableIdentity = { key: 'radarr_naming_name', value: 'Radarr naming', kind: 'stable' };
  const sqlIdentity: TestStableIdentity = { key: 'sonarr_naming_name', value: 'Sonarr naming', kind: 'stable' };

  __testOnly_validateStableIdentityConflicts(
    [sqlEntry(sqlIdentity, '001-base.sql')],
    [migrationEntry(migrationIdentity, '/path/entity.yaml')]
  );
});

Deno.test('importBaseOps: validateStableIdentityConflicts ignores null stable identities', () => {
  __testOnly_validateStableIdentityConflicts(
    [sqlEntry(null, '001-base.sql')],
    [migrationEntry(null, '/path/entity.yaml')]
  );
});
