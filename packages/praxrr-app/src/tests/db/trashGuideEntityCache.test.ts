import { assertEquals } from '@std/assert';
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
    ((sql: string, ...params: unknown[]) => {
      capturedParams = params;
      return undefined;
    }) as typeof db.queryFirst,
    restores
  );

  try {
    const changed = trashGuideEntityCacheQueries.hasContentChanged(11, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'quality_profile', 'abc');
    assertEquals(changed, false);
    assertEquals(capturedParams, [11, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'quality_profile']);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('hasContentChanged returns false when row exists and content hash matches', () => {
  const restores: Restore[] = [];
  patchTarget(
    db,
    'queryFirst',
    (() => ({ content_hash: 'same-hash' })) as typeof db.queryFirst,
    restores
  );

  try {
    const changed = trashGuideEntityCacheQueries.hasContentChanged(22, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'custom_format', 'same-hash');
    assertEquals(changed, false);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('hasContentChanged returns true when row exists and content hash differs', () => {
  const restores: Restore[] = [];
  patchTarget(
    db,
    'queryFirst',
    (() => ({ content_hash: 'old-hash' })) as typeof db.queryFirst,
    restores
  );

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
