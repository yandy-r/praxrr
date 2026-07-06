import { assertEquals, assertThrows } from '@std/assert';
import { db } from '../../lib/server/db/db.ts';
import { trashGuideEntityCacheQueries } from '../../lib/server/db/queries/trashGuideEntityCache.ts';

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('hasContentChanged returns false for missing cache rows', () => {
  const restores: Restore[] = [];
  let capturedParams: unknown[] = [];
  patchTarget(
    db,
    'queryFirst',
    ((_sql: string, ...params: unknown[]) => {
      capturedParams = params;
      return undefined;
    }) as typeof db.queryFirst,
    restores
  );

  try {
    const changed = trashGuideEntityCacheQueries.hasContentChanged(
      11,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'quality_profile',
      'abc'
    );
    assertEquals(changed, false);
    assertEquals(capturedParams, [11, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'quality_profile']);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('hasContentChanged throws for empty trashId', () => {
  assertThrows(
    () => {
      trashGuideEntityCacheQueries.hasContentChanged(11, '   ', 'quality_profile', 'abc');
    },
    Error,
    'TRaSH cache trash_id must be non-empty (source=11)'
  );
});

Deno.test('hasContentChanged returns false when row exists and content hash matches', () => {
  const restores: Restore[] = [];
  patchTarget(db, 'queryFirst', (() => ({ content_hash: 'same-hash' })) as typeof db.queryFirst, restores);

  try {
    const changed = trashGuideEntityCacheQueries.hasContentChanged(
      22,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'custom_format',
      'same-hash'
    );
    assertEquals(changed, false);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('hasContentChanged returns true when row exists and content hash differs', () => {
  const restores: Restore[] = [];
  patchTarget(db, 'queryFirst', (() => ({ content_hash: 'old-hash' })) as typeof db.queryFirst, restores);

  try {
    const changed = trashGuideEntityCacheQueries.hasContentChanged(
      33,
      'cccccccccccccccccccccccccccccccc',
      'naming',
      'new-hash'
    );
    assertEquals(changed, true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('getByKey normalizes trashId lookup to lowercase', () => {
  const restores: Restore[] = [];
  let capturedParams: unknown[] = [];
  patchTarget(
    db,
    'queryFirst',
    ((_sql: string, ...params: unknown[]) => {
      capturedParams = params;
      return {
        id: 1,
        source_id: 44,
        trash_id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        entity_type: 'custom_format',
        name: 'CF',
        json_data: '{}',
        file_path: 'custom-formats/cf.json',
        content_hash: 'hash-cf',
        fetched_at: '2026-02-27T00:00:00.000Z',
      };
    }) as typeof db.queryFirst,
    restores
  );

  try {
    const row = trashGuideEntityCacheQueries.getByKey(44, ' AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ', 'custom_format');
    assertEquals(capturedParams, [44, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'custom_format']);
    assertEquals(row?.trashId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('getByKey throws for empty trashId', () => {
  assertThrows(
    () => {
      trashGuideEntityCacheQueries.getByKey(44, '   ', 'custom_format');
    },
    Error,
    'TRaSH cache trash_id must be non-empty (source=44)'
  );
});

Deno.test('getBySourceTypeAndTrashIds normalizes and deduplicates id list', () => {
  const restores: Restore[] = [];
  let capturedSql = '';
  let capturedParams: unknown[] = [];
  patchTarget(
    db,
    'query',
    ((sql: string, ...params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return [
        {
          id: 1,
          source_id: 12,
          trash_id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          entity_type: 'custom_format',
          name: 'A',
          json_data: '{}',
          file_path: 'custom-formats/a.json',
          content_hash: 'hash-a',
          fetched_at: '2026-02-27T00:00:00.000Z',
        },
        {
          id: 2,
          source_id: 12,
          trash_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          entity_type: 'custom_format',
          name: 'B',
          json_data: '{}',
          file_path: 'custom-formats/b.json',
          content_hash: 'hash-b',
          fetched_at: '2026-02-27T00:00:00.000Z',
        },
      ];
    }) as typeof db.query,
    restores
  );

  try {
    const rows = trashGuideEntityCacheQueries.getBySourceTypeAndTrashIds(12, 'custom_format', [
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ' bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ',
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      ' ',
    ]);

    assertEquals(capturedSql.includes('trash_id IN (?, ?)'), true);
    assertEquals(capturedParams, [
      12,
      'custom_format',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]);
    assertEquals(
      rows.map((row) => row.trashId),
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
