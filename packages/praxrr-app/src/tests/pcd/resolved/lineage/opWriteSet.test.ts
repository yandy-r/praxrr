// Adversarial op-SQL write-set analyzer tests (issue #231). The analyzer must extract table +
// explicit columns + kind + WHERE without literal values ever leaking into columns, and must fall
// back to `parseStatus: 'ambiguous'` on anything it cannot confidently parse.

import { assertEquals } from '@std/assert';
import { analyzeOpWriteSets } from '$pcd/resolved/lineage/opWriteSet.ts';

Deno.test('opWriteSet: INSERT with explicit column list', () => {
  const r = analyzeOpWriteSets("INSERT INTO custom_formats (name, include_in_rename) VALUES ('CF', 0)");
  assertEquals(r.parseStatus, 'parsed');
  assertEquals(r.writeSets.length, 1);
  assertEquals(r.writeSets[0], {
    table: 'custom_formats',
    columns: ['name', 'include_in_rename'],
    kind: 'insert',
    whereExpr: null,
  });
});

Deno.test('opWriteSet: INSERT without a column list is ambiguous (cannot attribute columns)', () => {
  const r = analyzeOpWriteSets("INSERT INTO t VALUES ('a', 1)");
  assertEquals(r.parseStatus, 'ambiguous');
});

Deno.test('opWriteSet: multi-row VALUES shares one column list', () => {
  const r = analyzeOpWriteSets(
    "INSERT INTO lidarr_metadata_profile_primary_types (metadata_profile_name, type_id, name, allowed) VALUES ('P', 0, 'Album', 1), ('P', 1, 'EP', 1) ON CONFLICT(metadata_profile_name, type_id) DO NOTHING"
  );
  assertEquals(r.parseStatus, 'parsed');
  assertEquals(r.writeSets[0].columns, ['metadata_profile_name', 'type_id', 'name', 'allowed']);
  assertEquals(r.writeSets[0].kind, 'insert');
});

Deno.test('opWriteSet: Kysely-shaped quoted-identifier UPDATE captures SET columns + WHERE', () => {
  const r = analyzeOpWriteSets(
    'update "delay_profiles" set "usenet_delay" = 30, "torrent_delay" = 10 where "name" = \'DP\''
  );
  assertEquals(r.parseStatus, 'parsed');
  assertEquals(r.writeSets[0].table, 'delay_profiles');
  assertEquals(r.writeSets[0].columns, ['usenet_delay', 'torrent_delay']);
  assertEquals(r.writeSets[0].kind, 'update');
  assertEquals(r.writeSets[0].whereExpr, '"name" = \'DP\'');
});

Deno.test('opWriteSet: string literal with commas/parens/escaped quotes never leaks into columns', () => {
  // A custom-format regex pattern literal with embedded commas, parens and an escaped quote.
  const r = analyzeOpWriteSets(
    "INSERT INTO regular_expressions (name, pattern) VALUES ('RE', '\\b(x264|x265),(720p),it''s\\b')"
  );
  assertEquals(r.parseStatus, 'parsed');
  assertEquals(r.writeSets[0].columns, ['name', 'pattern']);
});

Deno.test('opWriteSet: UPDATE with function call in SET value does not leak into columns', () => {
  const r = analyzeOpWriteSets('update "t" set "a" = 1, "b" = coalesce("b", 0) where "name" = \'x\'');
  assertEquals(r.writeSets[0].columns, ['a', 'b']);
});

Deno.test('opWriteSet: multi-statement DELETE then INSERT are analyzed independently', () => {
  const r = analyzeOpWriteSets(
    "DELETE FROM condition_sources WHERE custom_format_name = 'CF'; INSERT INTO condition_sources (custom_format_name, condition_name, source) VALUES ('CF', 'c', 'web')"
  );
  assertEquals(r.parseStatus, 'parsed');
  assertEquals(r.writeSets.length, 2);
  assertEquals(r.writeSets[0].kind, 'delete');
  assertEquals(r.writeSets[0].table, 'condition_sources');
  assertEquals(r.writeSets[1].kind, 'insert');
  assertEquals(r.writeSets[1].columns, ['custom_format_name', 'condition_name', 'source']);
});

Deno.test('opWriteSet: depth-0 WHERE extraction handles parenthesized and compound predicates', () => {
  const r = analyzeOpWriteSets('DELETE FROM t WHERE (a = 1 AND b = 2) OR c = 3');
  assertEquals(r.writeSets[0].kind, 'delete');
  assertEquals(r.writeSets[0].whereExpr, '(a = 1 AND b = 2) OR c = 3');
});

Deno.test('opWriteSet: unparseable statement -> ambiguous, CREATE/PRAGMA are skipped silently', () => {
  assertEquals(analyzeOpWriteSets('MERGE INTO t USING s ON (t.id = s.id)').parseStatus, 'ambiguous');
  // Schema-layer DDL is not a lineage write path; it must not mark the op ambiguous.
  assertEquals(analyzeOpWriteSets('CREATE TABLE t (id INTEGER)').parseStatus, 'parsed');
  assertEquals(analyzeOpWriteSets('CREATE TABLE t (id INTEGER)').writeSets.length, 0);
});
