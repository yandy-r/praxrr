import { assertEquals } from '@std/assert';
import { db } from '../../lib/server/db/db.ts';
import { aiSettingsQueries } from '../../lib/server/db/queries/aiSettings.ts';
import { tmdbSettingsQueries } from '../../lib/server/db/queries/tmdbSettings.ts';

type Restore = () => void;

function patchExecute(captured: { sql: string; params: unknown[] }[], restores: Restore[]): void {
  const original = db.execute;
  db.execute = (sql: string, ...params: unknown[]) => {
    captured.push({ sql, params: [...params] });
    return 1;
  };
  restores.push(() => {
    db.execute = original;
  });
}

Deno.test('aiSettingsQueries.update with apiKey empty string includes api_key in update', () => {
  const executed: { sql: string; params: unknown[] }[] = [];
  const restores: Restore[] = [];
  patchExecute(executed, restores);
  try {
    const result = aiSettingsQueries.update({ apiKey: '' });
    assertEquals(result, true);
    assertEquals(executed.length, 1);
    assertEquals(executed[0].sql.includes('api_key = ?'), true);
    assertEquals(executed[0].params.includes(''), true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('tmdbSettingsQueries.update with apiKey empty string includes api_key in update', () => {
  const executed: { sql: string; params: unknown[] }[] = [];
  const restores: Restore[] = [];
  patchExecute(executed, restores);
  try {
    const result = tmdbSettingsQueries.update({ apiKey: '' });
    assertEquals(result, true);
    assertEquals(executed.length, 1);
    assertEquals(executed[0].sql.includes('api_key = ?'), true);
    assertEquals(executed[0].params.includes(''), true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
