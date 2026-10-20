// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { aiSettingsQueries } from '$db/queries/aiSettings.ts';
import { tmdbSettingsQueries } from '$db/queries/tmdbSettings.ts';
import { actions } from '../../routes/settings/general/+page.server.ts';

type ActionEvent = Parameters<NonNullable<(typeof actions)['updateAI']>>[0];
type ActionFailure = { status: number; data?: { error?: string } };

const STORED_AI_KEY = 'sk-stored-ai-key';
const STORED_TMDB_KEY = 'stored-tmdb-token';

/** Real scratch SQLite DB per test with the full migration chain (seeds singleton rows). */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/settings-general-keys-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function seedAI(enabled: boolean): void {
  assert(
    aiSettingsQueries.update({
      enabled,
      apiUrl: 'http://localhost:11434/v1',
      apiKey: STORED_AI_KEY,
      model: 'llama3',
    })
  );
}

function seedTMDB(): void {
  assert(tmdbSettingsQueries.update({ apiKey: STORED_TMDB_KEY }));
}

function formEvent(form: (fd: FormData) => void): ActionEvent {
  const fd = new FormData();
  form(fd);
  return {
    request: new Request('http://localhost/settings/general', { method: 'POST', body: fd }),
  } as unknown as ActionEvent;
}

function run(name: keyof typeof actions, event: ActionEvent) {
  const action = actions[name];
  assert(action, `action ${String(name)} must exist`);
  return action(event);
}

migratedTest('updateAI: empty api_key keeps stored key while updating model', async () => {
  seedAI(true);

  const result = await run(
    'updateAI',
    formEvent((fd) => {
      fd.set('enabled', 'on');
      fd.set('api_url', 'http://localhost:11434/v1');
      fd.set('model', 'llama3.1');
      fd.set('api_key', '');
    })
  );

  assertEquals(result, { success: true });
  const row = aiSettingsQueries.get();
  assertEquals(row?.api_key, STORED_AI_KEY);
  assertEquals(row?.model, 'llama3.1');
  assertEquals(row?.enabled, 1);
});

migratedTest('updateAI: non-empty api_key replaces stored key (trimmed)', async () => {
  seedAI(true);

  const result = await run(
    'updateAI',
    formEvent((fd) => {
      fd.set('enabled', 'on');
      fd.set('api_url', 'http://localhost:11434/v1');
      fd.set('model', 'llama3');
      fd.set('api_key', '  sk-new-key  ');
    })
  );

  assertEquals(result, { success: true });
  assertEquals(aiSettingsQueries.get()?.api_key, 'sk-new-key');
});

migratedTest('updateAI: disabling without url/model/key fields preserves stored values', async () => {
  seedAI(true);

  // AISettings.svelte does not render api_url/model/api_key when AI is disabled.
  const result = await run(
    'updateAI',
    formEvent(() => {})
  );

  assertEquals(result, { success: true });
  const row = aiSettingsQueries.get();
  assertEquals(row?.enabled, 0);
  assertEquals(row?.api_url, 'http://localhost:11434/v1');
  assertEquals(row?.model, 'llama3');
  assertEquals(row?.api_key, STORED_AI_KEY);
});

migratedTest('updateAI: disabled save with default url/model persists defaults, key untouched', async () => {
  seedAI(true);

  // Reset to Defaults + Save while disabled: hidden api_url/model inputs carry the defaults.
  const result = await run(
    'updateAI',
    formEvent((fd) => {
      fd.set('enabled', '');
      fd.set('api_url', 'https://api.openai.com/v1');
      fd.set('model', 'gpt-4o-mini');
    })
  );

  assertEquals(result, { success: true });
  const row = aiSettingsQueries.get();
  assertEquals(row?.enabled, 0);
  assertEquals(row?.api_url, 'https://api.openai.com/v1');
  assertEquals(row?.model, 'gpt-4o-mini');
  assertEquals(row?.api_key, STORED_AI_KEY);
});

migratedTest('updateAI: enabling with absent url/model uses stored values; empty url fails', async () => {
  seedAI(false);

  const enableResult = await run(
    'updateAI',
    formEvent((fd) => fd.set('enabled', 'on'))
  );
  assertEquals(enableResult, { success: true });
  let row = aiSettingsQueries.get();
  assertEquals(row?.enabled, 1);
  assertEquals(row?.api_url, 'http://localhost:11434/v1');
  assertEquals(row?.model, 'llama3');
  assertEquals(row?.api_key, STORED_AI_KEY);

  const emptyUrlResult = (await run(
    'updateAI',
    formEvent((fd) => {
      fd.set('enabled', 'on');
      fd.set('api_url', '');
      fd.set('model', 'llama3');
    })
  )) as ActionFailure;
  assertEquals(emptyUrlResult.status, 400);
  assertEquals(emptyUrlResult.data?.error, 'API URL is required when AI is enabled');
  row = aiSettingsQueries.get();
  assertEquals(row?.api_url, 'http://localhost:11434/v1');
  assertEquals(row?.api_key, STORED_AI_KEY);
});

migratedTest('updateTMDB: empty token keeps stored token; non-empty replaces it', async () => {
  seedTMDB();

  const emptyResult = await run(
    'updateTMDB',
    formEvent((fd) => fd.set('api_key', '   '))
  );
  assertEquals(emptyResult, { success: true });
  assertEquals(tmdbSettingsQueries.get()?.api_key, STORED_TMDB_KEY);

  const missingResult = await run(
    'updateTMDB',
    formEvent(() => {})
  );
  assertEquals(missingResult, { success: true });
  assertEquals(tmdbSettingsQueries.get()?.api_key, STORED_TMDB_KEY);

  const replaceResult = await run(
    'updateTMDB',
    formEvent((fd) => fd.set('api_key', 'new-tmdb-token'))
  );
  assertEquals(replaceResult, { success: true });
  assertEquals(tmdbSettingsQueries.get()?.api_key, 'new-tmdb-token');
});

migratedTest('clearAIKey / clearTMDBKey explicitly empty the stored keys', async () => {
  seedAI(true);
  seedTMDB();

  const aiResult = await run(
    'clearAIKey',
    formEvent(() => {})
  );
  assertEquals(aiResult, { success: true, cleared: true });
  const aiRow = aiSettingsQueries.get();
  assertEquals(aiRow?.api_key, '');
  assertEquals(aiRow?.model, 'llama3');
  assertEquals(aiRow?.enabled, 1);

  const tmdbResult = await run(
    'clearTMDBKey',
    formEvent(() => {})
  );
  assertEquals(tmdbResult, { success: true, cleared: true });
  assertEquals(tmdbSettingsQueries.get()?.api_key, '');
});
