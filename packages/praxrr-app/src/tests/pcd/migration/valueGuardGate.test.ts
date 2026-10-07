import { Database } from '@jsr/db__sqlite';
import { assertEquals } from '@std/assert';
import { evaluateValueGuardApply } from '$pcd/migration/valueGuardGate.ts';

function createQualityProfileDb(profileName: string): Database {
  const db = new Database(':memory:', { int64: true });

  db.exec(`
    CREATE TABLE quality_profile_qualities (
      quality_profile_name TEXT NOT NULL,
      quality_name TEXT,
      quality_group_name TEXT,
      position INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      upgrade_until INTEGER NOT NULL
    );
    CREATE TABLE quality_group_members (
      quality_profile_name TEXT NOT NULL,
      quality_group_name TEXT NOT NULL,
      quality_name TEXT NOT NULL
    );
  `);

  db.exec(
    `INSERT INTO quality_profile_qualities (
      quality_profile_name,
      quality_name,
      quality_group_name,
      position,
      enabled,
      upgrade_until
    ) VALUES (
      '${profileName.replace(/'/g, "''")}',
      'quality-1080p',
      NULL,
      0,
      1,
      0
    )`
  );

  return db;
}

Deno.test('valueGuard: evaluateValueGuardApply returns full_list_conflict', () => {
  const profileName = 'Profile full-list';
  const db = createQualityProfileDb(profileName);
  const metadataJson = JSON.stringify({
    operation: 'update',
    entity: 'quality_profile',
    stableKey: { key: 'quality_profile_name', value: profileName },
    name: profileName,
  });
  const desiredStateJson = JSON.stringify({
    ordered_items: {
      from: [
        {
          type: 'quality',
          name: 'quality-720p',
          position: 0,
          enabled: true,
          upgradeUntil: false,
        },
      ],
      to: [
        {
          type: 'quality',
          name: 'quality-2160p',
          position: 0,
          enabled: true,
          upgradeUntil: false,
        },
      ],
    },
  });

  try {
    const result = evaluateValueGuardApply({
      db,
      conflictStrategy: 'override',
      isUserOp: true,
      rowcount: 1,
      metadataJson,
      desiredStateJson,
      priorConflictReason: null,
    });

    assertEquals(result.decision, 'full_list_conflict');
    assertEquals(result.status, 'conflicted');
  } finally {
    db.close();
  }
});

Deno.test('valueGuard: evaluateValueGuardApply supports align strategy auto-alignment for zero-row updates', () => {
  const db = { prepare: () => ({ all: () => [] }) } as unknown as Database;
  const metadataJson = JSON.stringify({
    operation: 'create',
    entity: 'custom_format',
    name: 'AutoAlign CF',
  });
  const result = evaluateValueGuardApply({
    db,
    conflictStrategy: 'align',
    isUserOp: true,
    rowcount: 0,
    metadataJson,
    desiredStateJson: null,
    priorConflictReason: null,
  });

  assertEquals(result.decision, 'auto_align_rowcount_zero');
  assertEquals(result.status, 'dropped');
  assertEquals(result.fallbackStatus, 'conflicted');
  assertEquals(result.conflictReason, 'aligned');
});

Deno.test('valueGuard: evaluateValueGuardApply supports align strategy auto-alignment for full-list conflicts', () => {
  const profileName = 'Profile align full list';
  const db = createQualityProfileDb(profileName);
  const metadataJson = JSON.stringify({
    operation: 'update',
    entity: 'quality_profile',
    stableKey: { key: 'quality_profile_name', value: profileName },
    name: profileName,
  });
  const desiredStateJson = JSON.stringify({
    ordered_items: {
      from: [
        {
          type: 'quality',
          name: 'quality-1080p',
          position: 0,
          enabled: true,
          upgradeUntil: false,
        },
      ],
      to: [
        {
          type: 'quality',
          name: 'quality-2160p',
          position: 0,
          enabled: true,
          upgradeUntil: false,
        },
      ],
    },
  });

  try {
    const result = evaluateValueGuardApply({
      db,
      conflictStrategy: 'align',
      isUserOp: true,
      rowcount: 2,
      metadataJson,
      desiredStateJson,
      priorConflictReason: null,
    });

    assertEquals(result.decision, 'auto_align_full_list');
    assertEquals(result.status, 'dropped');
    assertEquals(result.autoAlignReason, 'forced');
  } finally {
    db.close();
  }
});

Deno.test('valueGuard: evaluateValueGuardApply uses ask conflict strategy for zero-row conflicts', () => {
  const db = { prepare: () => ({ all: () => [] }) } as unknown as Database;
  const metadataJson = JSON.stringify({
    operation: 'create',
    entity: 'delay_profile',
    name: 'Ask Strategy',
  });
  const result = evaluateValueGuardApply({
    db,
    conflictStrategy: 'ask',
    isUserOp: true,
    rowcount: 0,
    metadataJson,
    desiredStateJson: null,
    priorConflictReason: null,
  });

  assertEquals(result.decision, 'rowcount_zero_conflict');
  assertEquals(result.status, 'conflicted_pending');
});

// YAN-464: aggregate rowcount > 0 (side statements) must not mask a missed scalar guard.
for (const [label, currentPattern, desired, expected] of [
  ['flags missed scalar guard', 'a', { pattern: { from: 'b', to: 'c' } }, 'full_list_conflict'],
  ['applies when scalar guard hit', 'c', { pattern: { from: 'b', to: 'c' } }, 'applied'],
  ['ignores tags-only desired state', 'a', { tags: { add: ['NewTag'], remove: [] } }, 'applied'],
  [
    'resolves renames by the new name, not a reused old name',
    'a',
    { name: { from: 'Foo', to: 'Bar' }, pattern: { from: 'b', to: 'c' } },
    'applied',
  ],
] as const) {
  Deno.test(`valueGuard: evaluateValueGuardApply ${label}`, () => {
    const db = new Database(':memory:', { int64: true });
    try {
      db.exec('CREATE TABLE regular_expressions (name TEXT PRIMARY KEY, pattern TEXT)');
      // 'Foo' is the stable key; for the rename case it is now held by another entity.
      db.exec(`INSERT INTO regular_expressions VALUES ('Foo', '${currentPattern}'), ('Bar', 'c')`);
      const result = evaluateValueGuardApply({
        db,
        conflictStrategy: 'ask',
        isUserOp: true,
        rowcount: 1,
        metadataJson: JSON.stringify({
          operation: 'update',
          entity: 'regular_expression',
          name: 'Foo',
          stableKey: { key: 'regular_expression_name', value: 'Foo' },
        }),
        desiredStateJson: JSON.stringify(desired),
        priorConflictReason: null,
      });
      assertEquals(result.decision, expected);
    } finally {
      db.close();
    }
  });
}

Deno.test('valueGuard: evaluateValueGuardApply treats bigint 1 as boolean true', () => {
  const db = new Database(':memory:', { int64: true });
  try {
    db.exec('CREATE TABLE custom_formats (name TEXT PRIMARY KEY, include_in_rename INTEGER)');
    db.exec("INSERT INTO custom_formats VALUES ('Foo', 1)");
    const result = evaluateValueGuardApply({
      db,
      conflictStrategy: 'ask',
      isUserOp: true,
      rowcount: 1,
      metadataJson: JSON.stringify({
        operation: 'update',
        entity: 'custom_format',
        name: 'Foo',
        stableKey: { key: 'custom_format_name', value: 'Foo' },
      }),
      desiredStateJson: JSON.stringify({ include_in_rename: { from: false, to: true } }),
      priorConflictReason: null,
    });
    assertEquals(result.decision, 'applied');
  } finally {
    db.close();
  }
});

// CodeRabbit (#286): tag-link deletes must not mask a missed guarded parent DELETE.
for (const [label, rows, expected] of [
  ['flags delete whose guarded parent DELETE missed', "('Foo', 'x')", 'full_list_conflict'],
  ['applies delete that removed the row', "('Other', 'x')", 'applied'],
] as const) {
  Deno.test(`valueGuard: evaluateValueGuardApply ${label}`, () => {
    const db = new Database(':memory:', { int64: true });
    try {
      db.exec('CREATE TABLE regular_expressions (name TEXT PRIMARY KEY, pattern TEXT)');
      db.exec(`INSERT INTO regular_expressions VALUES ${rows}`);
      const result = evaluateValueGuardApply({
        db,
        conflictStrategy: 'ask',
        isUserOp: true,
        rowcount: 1,
        metadataJson: JSON.stringify({
          operation: 'delete',
          entity: 'regular_expression',
          name: 'Foo',
          stableKey: { key: 'regular_expression_name', value: 'Foo' },
        }),
        desiredStateJson: null,
        priorConflictReason: null,
      });
      assertEquals(result.decision, expected);
    } finally {
      db.close();
    }
  });
}
