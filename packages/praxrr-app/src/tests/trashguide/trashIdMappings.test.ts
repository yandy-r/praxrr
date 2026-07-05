import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
import {
  trashIdMappingsQueries,
  type TrashIdMapping,
  type TrashIdMappingInput,
} from '../../lib/server/db/queries/trashIdMappings.ts';

// These suites drive the module-private normalizeMappings + computeDiff helpers through the
// exported read-only trashIdMappingsQueries.diffSourceMappings(sourceId, arrType, next). That
// method runs normalizeMappings first (all throw/dedup branches, DB-free), then calls the
// singleton's getBySource for the `current` set, then computeDiff. We stub getBySource so no
// real SQLite is touched, and restore it in a finally block (shared module singleton).

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

function makeInput(overrides: Partial<TrashIdMappingInput> = {}): TrashIdMappingInput {
  return {
    sourceId: 1,
    arrType: 'radarr',
    entityType: 'custom_format',
    trashId: 'abc',
    entityName: 'X',
    ...overrides,
  };
}

function makeMapping(overrides: Partial<TrashIdMapping> = {}): TrashIdMapping {
  return {
    sourceId: 1,
    arrType: 'radarr',
    entityType: 'custom_format',
    trashId: 'abc',
    entityName: 'X',
    ...overrides,
  };
}

// Stub the singleton's getBySource to supply the `current` fixture with zero DB access.
function stubCurrent(current: readonly TrashIdMapping[], restores: Restore[]): void {
  patchTarget(
    trashIdMappingsQueries,
    'getBySource',
    (() => [...current]) as typeof trashIdMappingsQueries.getBySource,
    restores
  );
}

// ---------------------------------------------------------------------------
// normalizeMappings dedup + validation (via diffSourceMappings)
// ---------------------------------------------------------------------------

Deno.test('diffSourceMappings dedups duplicate identity with identical name (first-write-wins, trim/lowercase)', () => {
  const restores: Restore[] = [];
  stubCurrent([], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ trashId: 'ABC123', entityName: 'HDR' }),
      makeInput({ trashId: 'abc123', entityName: 'HDR' }),
    ]);

    assertEquals(diff.created.length, 1);
    assertEquals(diff.created[0].trashId, 'abc123');
    assertEquals(diff.created[0].entityName, 'HDR');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('diffSourceMappings throws on conflicting duplicate rows when entity_name diverges', () => {
  assertThrows(
    () => {
      trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
        makeInput({ trashId: 'abc', entityName: 'HDR' }),
        makeInput({ trashId: 'abc', entityName: 'HDR10' }),
      ]);
    },
    Error,
    'Conflicting TRaSH mapping rows for custom_format:abc (source=1)'
  );
});

Deno.test('diffSourceMappings keeps same trash_id under different entity_type as distinct rows', () => {
  const restores: Restore[] = [];
  stubCurrent([], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ trashId: 'abc', entityType: 'custom_format', entityName: 'X' }),
      makeInput({ trashId: 'abc', entityType: 'quality_profile', entityName: 'X' }),
    ]);

    assertEquals(diff.created.length, 2);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('diffSourceMappings throws on empty/whitespace trash_id', () => {
  assertThrows(
    () => {
      trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [makeInput({ trashId: '   ', entityName: 'X' })]);
    },
    Error,
    'TRaSH mapping trash_id must be non-empty (source=1)'
  );
});

Deno.test('diffSourceMappings throws on source id mismatch', () => {
  assertThrows(
    () => {
      trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [makeInput({ sourceId: 2 })]);
    },
    Error,
    'TRaSH mapping source mismatch: expected 1, received 2'
  );
});

Deno.test('diffSourceMappings throws on arr_type mismatch', () => {
  assertThrows(
    () => {
      trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [makeInput({ arrType: 'sonarr' })]);
    },
    Error,
    'TRaSH mapping arr_type mismatch: expected radarr, received sonarr'
  );
});

Deno.test('diffSourceMappings sorts normalized output by entityType, entityName, trashId', () => {
  const restores: Restore[] = [];
  stubCurrent([], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ entityType: 'quality_profile', entityName: 'zeta', trashId: 'zzz' }),
      makeInput({ entityType: 'custom_format', entityName: 'beta', trashId: 'bbb' }),
      makeInput({ entityType: 'custom_format', entityName: 'alpha', trashId: 'aaa' }),
    ]);

    assertEquals(
      diff.created.map((row) => row.trashId),
      ['aaa', 'bbb', 'zzz']
    );
    assertEquals(
      diff.created.map((row) => row.entityName),
      ['alpha', 'beta', 'zeta']
    );
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

// ---------------------------------------------------------------------------
// computeDiff classification: created / renamed / unchanged / removed
// ---------------------------------------------------------------------------

Deno.test('diffSourceMappings classifies created, renamed, unchanged, and removed rows', () => {
  const restores: Restore[] = [];
  const currentAaa = makeMapping({ trashId: 'aaa', entityName: 'X' });
  const currentBbb = makeMapping({ trashId: 'bbb', entityName: 'Y' });
  const currentDdd = makeMapping({ trashId: 'ddd', entityName: 'W' });
  stubCurrent([currentAaa, currentBbb, currentDdd], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ trashId: 'aaa', entityName: 'X' }),
      makeInput({ trashId: 'bbb', entityName: 'Y2' }),
      makeInput({ trashId: 'ccc', entityName: 'Z' }),
    ]);

    assertEquals(diff.created.length, 1);
    assertEquals(diff.created[0].trashId, 'ccc');
    assertEquals(diff.created[0].entityName, 'Z');

    assertEquals(diff.renamed, [
      {
        sourceId: 1,
        arrType: 'radarr',
        entityType: 'custom_format',
        trashId: 'bbb',
        previousName: 'Y',
        nextName: 'Y2',
      },
    ]);

    assertEquals(diff.unchanged.length, 1);
    assertStrictEquals(diff.unchanged[0], currentAaa);

    assertEquals(diff.removed.length, 1);
    assertEquals(diff.removed[0].trashId, 'ddd');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('diffSourceMappings unchanged bucket returns the persisted row, not the next input', () => {
  const restores: Restore[] = [];
  const currentRow = makeMapping({ trashId: 'aaa', entityName: 'X' });
  stubCurrent([currentRow], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ trashId: 'aaa', entityName: 'X' }),
    ]);

    assertEquals(diff.unchanged.length, 1);
    assertStrictEquals(diff.unchanged[0], currentRow);
    assertEquals(diff.created, []);
    assertEquals(diff.renamed, []);
    assertEquals(diff.removed, []);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('diffSourceMappings marks all current rows removed when next is empty', () => {
  const restores: Restore[] = [];
  stubCurrent([makeMapping({ trashId: 'aaa' }), makeMapping({ trashId: 'bbb' })], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', []);

    assertEquals(diff.removed.length, 2);
    assertEquals(diff.created, []);
    assertEquals(diff.renamed, []);
    assertEquals(diff.unchanged, []);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('diffSourceMappings marks all next rows created when current is empty', () => {
  const restores: Restore[] = [];
  stubCurrent([], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ trashId: 'aaa' }),
      makeInput({ trashId: 'bbb' }),
    ]);

    assertEquals(diff.created.length, 2);
    assertEquals(diff.removed, []);
    assertEquals(diff.renamed, []);
    assertEquals(diff.unchanged, []);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('diffSourceMappings detects a rename on entity_name-only change', () => {
  const restores: Restore[] = [];
  stubCurrent([makeMapping({ trashId: 'aaa', entityName: 'Old' })], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ trashId: 'aaa', entityName: 'New' }),
    ]);

    assertEquals(diff.renamed, [
      {
        sourceId: 1,
        arrType: 'radarr',
        entityType: 'custom_format',
        trashId: 'aaa',
        previousName: 'Old',
        nextName: 'New',
      },
    ]);
    assertEquals(diff.created, []);
    assertEquals(diff.removed, []);
    assertEquals(diff.unchanged, []);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

Deno.test('diffSourceMappings matches current vs next keys case-insensitively', () => {
  const restores: Restore[] = [];
  stubCurrent([makeMapping({ trashId: 'aaa', entityName: 'X' })], restores);
  try {
    const diff = trashIdMappingsQueries.diffSourceMappings(1, 'radarr', [
      makeInput({ trashId: 'AAA', entityName: 'X' }),
    ]);

    assertEquals(diff.unchanged.length, 1);
    assertEquals(diff.created, []);
    assertEquals(diff.removed, []);
    assertEquals(diff.renamed, []);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
