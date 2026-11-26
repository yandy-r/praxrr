import { assert, assertEquals } from '@std/assert';
import { Database } from '@jsr/db__sqlite';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { RequestEvent } from '@sveltejs/kit';
import { deleteCache, setCache } from '$pcd/database/registry.ts';
import { GET as exportGet, _serializeDependencies } from '../../routes/api/v1/pcd/export/+server.ts';
import { logger } from '$logger/logger.ts';
import type { LogOptions } from '$logger/types.ts';
import { PORTABLE_MIGRATION_MIN_VERSION, PORTABLE_MIGRATION_SOURCE_EXPORT } from '$shared/pcd/portable.ts';
import type { PCDCache } from '$pcd/index.ts';
import type { PCDDatabase } from '$shared/pcd/types.ts';

const DATABASE_ID = 9321;

Deno.test('pcd export: includes migration source and schema metadata', async () => {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });

  try {
    db.exec(`
CREATE TABLE IF NOT EXISTS delay_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  preferred_protocol TEXT NOT NULL,
  usenet_delay INTEGER,
  torrent_delay INTEGER,
  bypass_if_highest_quality INTEGER NOT NULL DEFAULT 0,
  bypass_if_above_custom_format_score INTEGER NOT NULL DEFAULT 0,
  minimum_custom_format_score INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
    db.exec(
      "INSERT INTO delay_profiles (name, preferred_protocol, usenet_delay, torrent_delay) VALUES ('Export-Delay', 'both', 120, 240)"
    );

    const cache = { kb, getRawDb: () => db } as PCDCache;
    setCache(DATABASE_ID, cache);

    const response = await exportGet({
      url: new URL(
        `http://localhost/api/v1/pcd/export?databaseId=${DATABASE_ID}&entityType=delay_profile&name=Export-Delay`
      ),
      request: new Request(
        `http://localhost/api/v1/pcd/export?databaseId=${DATABASE_ID}&entityType=delay_profile&name=Export-Delay`
      ),
    } as unknown as RequestEvent);
    const body = (await response.json()) as {
      migration: {
        source: string;
        format: string;
        version: number;
      };
      entityType: string;
      data: { name: string };
    };

    assertEquals(response.status, 200);

    assertEquals(body.entityType, 'delay_profile');
    assertEquals(body.data.name, 'Export-Delay');
    assertEquals(body.migration.source, PORTABLE_MIGRATION_SOURCE_EXPORT);
    assertEquals(body.migration.format, 'json');
    assertEquals(body.migration.version, PORTABLE_MIGRATION_MIN_VERSION);
  } finally {
    await kb.destroy();
    db.close();
    deleteCache(DATABASE_ID);
  }
});

async function withDelayProfileCache<T>(names: string[], run: () => Promise<T>): Promise<T> {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: db }) });
  try {
    db.exec(`
CREATE TABLE IF NOT EXISTS delay_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  preferred_protocol TEXT NOT NULL,
  usenet_delay INTEGER,
  torrent_delay INTEGER,
  bypass_if_highest_quality INTEGER NOT NULL DEFAULT 0,
  bypass_if_above_custom_format_score INTEGER NOT NULL DEFAULT 0,
  minimum_custom_format_score INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
    for (const name of names) {
      db.exec(
        `INSERT INTO delay_profiles (name, preferred_protocol, usenet_delay, torrent_delay) VALUES ('${name}', 'both', 120, 240)`
      );
    }
    setCache(DATABASE_ID, { kb, getRawDb: () => db } as PCDCache);
    return await run();
  } finally {
    await kb.destroy();
    db.close();
    deleteCache(DATABASE_ID);
  }
}

async function callExport(query: string): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/pcd/export?${query}`);
  return await exportGet({ url, request: new Request(url) } as unknown as RequestEvent);
}

Deno.test('pcd export: format=bundle flips a single-name export to the bundle shape', async () => {
  await withDelayProfileCache(['Delay-A'], async () => {
    const response = await callExport(`databaseId=${DATABASE_ID}&entityType=delay_profile&name=Delay-A&format=bundle`);
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.bundle.version, 1);
    assertEquals(body.bundle.entities.length, 1);
    assertEquals(body.bundle.entities[0].entityType, 'delay_profile');
    assertEquals(body.bundle.entities[0].data.name, 'Delay-A');
    assertEquals('entityType' in body, false);
  });
});

Deno.test(
  'pcd export: repeated name without includeDependencies returns only the named entities as a bundle',
  async () => {
    await withDelayProfileCache(['Delay-A', 'Delay-B', 'Delay-C'], async () => {
      const response = await callExport(`databaseId=${DATABASE_ID}&entityType=delay_profile&name=Delay-A&name=Delay-C`);
      const body = await response.json();
      assertEquals(response.status, 200);
      assertEquals(
        body.bundle.entities.map((entry: { data: { name: string } }) => entry.data.name),
        ['Delay-A', 'Delay-C']
      );
    });
  }
);

Deno.test('pcd export: single name keeps the legacy shape and an unknown name is 404', async () => {
  await withDelayProfileCache(['Delay-A'], async () => {
    const legacy = await (await callExport(`databaseId=${DATABASE_ID}&entityType=delay_profile&name=Delay-A`)).json();
    assertEquals(legacy.entityType, 'delay_profile');
    assertEquals(legacy.migration.version, PORTABLE_MIGRATION_MIN_VERSION);
    assertEquals('bundle' in legacy, false);

    const missing = await callExport(`databaseId=${DATABASE_ID}&entityType=delay_profile&name=Nope&format=bundle`);
    assertEquals(missing.status, 404);
  });
});

// YAN-2473: unexpected export failures are 500 with a fixed message and stable code; only known
// client errors (validation, limits, by-name misses) keep their 4xx status and specific message.

const SECRET = 'apikey=sk_live_SECRET123';
const SECRET_MARKER = 'SECRET123';

/** Capture `logger.error` calls for the duration of `run` instead of writing them. */
async function withCapturedErrorLogs<T>(
  run: (logged: { message: string; options?: LogOptions }[]) => Promise<T>
): Promise<T> {
  const logged: { message: string; options?: LogOptions }[] = [];
  const original = logger.error;
  logger.error = (async (message: string, options?: LogOptions) => {
    logged.push({ message, options });
  }) as typeof logger.error;
  try {
    return await run(logged);
  } finally {
    logger.error = original;
  }
}

function loggedRawError(logged: { options?: LogOptions }[]): boolean {
  return logged.some((entry) => {
    const error = (entry.options?.meta as Record<string, unknown> | undefined)?.error;
    const text = error instanceof Error ? error.message : String(error);
    return text.includes(SECRET_MARKER);
  });
}

async function assertExportFailed(response: Response): Promise<void> {
  const text = await response.text();
  assertEquals(response.status, 500);
  assert(!text.includes(SECRET_MARKER), `response echoed raw error text: ${text}`);
  assertEquals(JSON.parse(text), { error: 'Export failed', code: 'export_failed' });
}

/** Replace the delay-profile serializer for the duration of `run` (the seam is `as const`). */
async function withFailingSerializer<T>(failure: unknown, run: () => Promise<T>): Promise<T> {
  const deps = _serializeDependencies as {
    -readonly [K in keyof typeof _serializeDependencies]: (typeof _serializeDependencies)[K];
  };
  const original = deps.serializeDelayProfile;
  deps.serializeDelayProfile = () => Promise.reject(failure);
  try {
    return await run();
  } finally {
    deps.serializeDelayProfile = original;
  }
}

Deno.test('pcd export: an unexpected serializer error is a sanitized 500, logged raw', async () => {
  await withFailingSerializer(new Error(`db read failed: ${SECRET}`), async () => {
    await withDelayProfileCache(['Delay-A'], async () => {
      await withCapturedErrorLogs(async (logged) => {
        await assertExportFailed(await callExport(`databaseId=${DATABASE_ID}&entityType=delay_profile&name=Delay-A`));
        assert(loggedRawError(logged), 'raw error must be logged server-side');
      });
    });
  });
});

Deno.test('pcd export: a non-Error throw is a sanitized 500', async () => {
  await withFailingSerializer(SECRET, async () => {
    await withDelayProfileCache(['Delay-A'], async () => {
      await withCapturedErrorLogs(async (logged) => {
        await assertExportFailed(await callExport(`databaseId=${DATABASE_ID}&entityType=delay_profile&name=Delay-A`));
        assert(loggedRawError(logged));
      });
    });
  });
});

Deno.test(
  'pcd export: a bundle-path failure mentioning "not found" that is not a by-name miss is a sanitized 500',
  async () => {
    // A cache-level helper miss (`Tag not found: X`) or similar data-integrity failure must not be
    // reported as a 404 for the requested entity, nor echo its raw text.
    const failingKb = {
      selectFrom: () => {
        throw new Error(`Tag not found: ${SECRET}`);
      },
    };
    setCache(DATABASE_ID, { kb: failingKb } as unknown as PCDCache);
    try {
      await withCapturedErrorLogs(async (logged) => {
        await assertExportFailed(
          await callExport(
            `databaseId=${DATABASE_ID}&entityType=delay_profile&name=Delay-A&name=Delay-B&includeDependencies=true`
          )
        );
        assert(loggedRawError(logged));
      });
    } finally {
      deleteCache(DATABASE_ID);
    }
  }
);

Deno.test('pcd export: a by-name miss keeps its 404 and specific message on both response shapes', async () => {
  await withDelayProfileCache(['Delay-A'], async () => {
    const legacy = await callExport(`databaseId=${DATABASE_ID}&entityType=delay_profile&name=Nope`);
    assertEquals(legacy.status, 404);
    assertEquals(await legacy.json(), { error: 'Delay profile "Nope" not found' });

    const bundle = await callExport(
      `databaseId=${DATABASE_ID}&entityType=delay_profile&name=Delay-A&name=Nope&includeDependencies=true`
    );
    assertEquals(bundle.status, 404);
    assertEquals(await bundle.json(), { error: 'Delay profile "Nope" not found' });
  });
});

Deno.test('pcd export: invalid parameters keep their 400 and specific message', async () => {
  const response = await callExport(`databaseId=${DATABASE_ID}&entityType=not_a_type&name=Delay-A`);
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: 'Invalid entityType: not_a_type' });
});
