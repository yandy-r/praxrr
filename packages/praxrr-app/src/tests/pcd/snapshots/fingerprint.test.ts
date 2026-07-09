import { assert, assertEquals } from '@std/assert';
import {
  canonicalRecordForRow,
  computeStateFingerprint,
  sha256Hex,
  type FingerprintOpRow,
} from '$pcd/snapshots/fingerprint.ts';

function row(overrides: Partial<FingerprintOpRow> & { id: number }): FingerprintOpRow {
  return {
    origin: 'user',
    sequence: overrides.id,
    state: 'published',
    source: 'local',
    content_hash: `hash-${overrides.id}`,
    sql: `INSERT ${overrides.id}`,
    metadata: null,
    ...overrides,
  };
}

Deno.test('fingerprint: empty row set yields null', async () => {
  assertEquals(await computeStateFingerprint([], {}), null);
});

Deno.test('fingerprint: canonical record uses pipe layout with content_hash when present', async () => {
  const record = await canonicalRecordForRow(
    {
      id: 7,
      origin: 'base',
      sequence: 3,
      state: 'published',
      source: 'repo',
      content_hash: 'abc',
      sql: 'X',
      metadata: null,
    },
    false
  );
  assertEquals(record, '7|base|3|published|repo|abc');
});

Deno.test('fingerprint: NULL content_hash falls back to sha256(sql + \\n + metadata)', async () => {
  const expectedHash = await sha256Hex('SOME SQL\n{"k":1}');
  const record = await canonicalRecordForRow(
    {
      id: 9,
      origin: 'user',
      sequence: 9,
      state: 'published',
      source: 'local',
      content_hash: null,
      sql: 'SOME SQL',
      metadata: '{"k":1}',
    },
    false
  );
  assertEquals(record, `9|user|9|published|local|${expectedHash}`);
});

Deno.test(
  'fingerprint: NULL content_hash + NULL metadata uses empty-string metadata (not the literal "null")',
  async () => {
    const expectedHash = await sha256Hex('ONLY SQL\n');
    const record = await canonicalRecordForRow(
      {
        id: 1,
        origin: 'base',
        sequence: 1,
        state: 'published',
        source: 'repo',
        content_hash: null,
        sql: 'ONLY SQL',
        metadata: null,
      },
      false
    );
    assertEquals(record, `1|base|1|published|repo|${expectedHash}`);
  }
);

Deno.test('fingerprint: forceStatePublished overrides a non-published live state', async () => {
  const superseded = await canonicalRecordForRow(
    {
      id: 4,
      origin: 'user',
      sequence: 4,
      state: 'superseded',
      source: 'local',
      content_hash: 'h',
      sql: 'S',
      metadata: null,
    },
    true
  );
  assertEquals(superseded, '4|user|4|published|local|h');
});

Deno.test(
  'fingerprint: a set of currently-published rows hashes identically with and without forceStatePublished',
  async () => {
    const rows = [row({ id: 1, origin: 'base' }), row({ id: 2, origin: 'user' })];
    const capture = await computeStateFingerprint(rows, {});
    const reconstruct = await computeStateFingerprint(rows, { forceStatePublished: true });
    assert(capture !== null);
    assertEquals(capture, reconstruct);
  }
);

Deno.test('fingerprint: order matters and content changes flip the hash', async () => {
  const a = await computeStateFingerprint([row({ id: 1 }), row({ id: 2 })], {});
  const reordered = await computeStateFingerprint([row({ id: 2 }), row({ id: 1 })], {});
  const mutated = await computeStateFingerprint([row({ id: 1, content_hash: 'different' }), row({ id: 2 })], {});
  assert(a !== reordered, 'reordering rows must change the fingerprint');
  assert(a !== mutated, 'mutating a row content_hash must change the fingerprint');
});
