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
