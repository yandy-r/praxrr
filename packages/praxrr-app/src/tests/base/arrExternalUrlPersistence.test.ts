import { assertEquals } from '@std/assert';
import { db } from '../../lib/server/db/db.ts';
import { arrInstancesQueries } from '../../lib/server/db/queries/arrInstances.ts';

type SqlCall = {
  sql: string;
  params: unknown[];
};

function captureDbWrites(): {
  executeCalls: SqlCall[];
  queryFirstCalls: SqlCall[];
  restore: () => void;
} {
  const executeCalls: SqlCall[] = [];
  const queryFirstCalls: SqlCall[] = [];

  const originalExecute = db.execute;
  const originalQueryFirst = db.queryFirst;

  db.execute = ((sql: string, ...params: unknown[]) => {
    executeCalls.push({ sql, params });
    return 1;
  }) as typeof db.execute;

  db.queryFirst = ((sql: string, ...params: unknown[]) => {
    queryFirstCalls.push({ sql, params });
    return { id: 77 } as { id: number };
  }) as typeof db.queryFirst;

  return {
    executeCalls,
    queryFirstCalls,
    restore: () => {
      db.execute = originalExecute;
      db.queryFirst = originalQueryFirst;
    },
  };
}

Deno.test('arrInstances create stores NULL external_url when not provided', () => {
  const harness = captureDbWrites();

  try {
    const id = arrInstancesQueries.create({
      name: 'Lidarr Main',
      type: 'lidarr',
      url: 'http://lidarr.internal',
      apiKey: 'secret',
    });

    assertEquals(id, 77);
    assertEquals(harness.executeCalls.length, 1);
    const call = harness.executeCalls[0];
    assertEquals(call.params[3], null);
    assertEquals(harness.queryFirstCalls.length, 1);
    assertEquals(harness.queryFirstCalls[0].sql, 'SELECT last_insert_rowid() as id');
  } finally {
    harness.restore();
  }
});

Deno.test('arrInstances create stores explicit external_url when provided', () => {
  const harness = captureDbWrites();

  try {
    const id = arrInstancesQueries.create({
      name: 'Lidarr Main',
      type: 'lidarr',
      url: 'http://lidarr.internal',
      externalUrl: 'https://lidarr.example',
      apiKey: 'secret',
    });

    assertEquals(id, 77);
    const call = harness.executeCalls[0];
    assertEquals(call.params[3], 'https://lidarr.example');
  } finally {
    harness.restore();
  }
});

Deno.test('arrInstances update clears external_url when empty value is supplied', () => {
  const harness = captureDbWrites();

  try {
    const updated = arrInstancesQueries.update(44, {
      externalUrl: '   ',
    });

    assertEquals(updated, true);
    assertEquals(harness.executeCalls.length, 1);
    const call = harness.executeCalls[0];
    assertEquals(call.sql.includes('external_url = ?'), true);
    assertEquals(call.params[0], null);
  } finally {
    harness.restore();
  }
});
