import { assertEquals } from '@std/assert';
import { processDependencies, syncDependencies } from '$pcd/git/dependencies.ts';
import { logger } from '$logger/logger.ts';

const SCHEMA_PATH_OVERRIDE_ENV = 'PRAXRR_SCHEMA_LOCAL_PATH';
const SCHEMA_DEPENDENCY_URL = 'https://github.com/yandy-r/praxrr-schema';

function tempPath(name: string): string {
  return `/tmp/praxrr-tests/${name}-${crypto.randomUUID()}`;
}

async function writePcdManifest(path: string): Promise<void> {
  await Deno.writeTextFile(
    `${path}/pcd.json`,
    JSON.stringify(
      {
        name: 'Local Dev PCD',
        version: '1.0.0',
        description: 'Local dev fixture',
        dependencies: {
          [SCHEMA_DEPENDENCY_URL]: '1.0.0',
        },
        praxrr: {
          minimum_version: '2.1.0',
        },
      },
      null,
      2
    )
  );
}

async function writeSchemaFixture(path: string, sqlContent: string): Promise<void> {
  await Deno.mkdir(`${path}/ops`, { recursive: true });
  await Deno.writeTextFile(
    `${path}/pcd.json`,
    JSON.stringify(
      {
        name: 'Local Schema',
        version: '1.0.0',
        description: 'Local schema fixture',
        praxrr: {
          minimum_version: '2.1.0',
        },
      },
      null,
      2
    )
  );
  await Deno.writeTextFile(`${path}/ops/0.schema.sql`, sqlContent);
}

Deno.test('schema dependency local path override installs and refreshes dependency ops', async () => {
  const root = tempPath('schema-local-override');
  const pcdPath = `${root}/pcd`;
  const schemaPath = `${root}/schema`;
  const depSchemaPath = `${pcdPath}/deps/praxrr-schema`;
  const previousEnv = Deno.env.get(SCHEMA_PATH_OVERRIDE_ENV);
  const originalInfo = logger.info;
  const originalDebug = logger.debug;
  const originalWarn = logger.warn;

  try {
    logger.info = (async () => {}) as typeof logger.info;
    logger.debug = (async () => {}) as typeof logger.debug;
    logger.warn = (async () => {}) as typeof logger.warn;

    await Deno.mkdir(pcdPath, { recursive: true });
    await writePcdManifest(pcdPath);
    await writeSchemaFixture(schemaPath, '-- schema v1\n');

    Deno.env.set(SCHEMA_PATH_OVERRIDE_ENV, schemaPath);

    await processDependencies(pcdPath);
    assertEquals(await Deno.readTextFile(`${depSchemaPath}/ops/0.schema.sql`), '-- schema v1\n');

    await Deno.writeTextFile(`${schemaPath}/ops/0.schema.sql`, '-- schema v2\n');

    await syncDependencies(pcdPath);
    assertEquals(await Deno.readTextFile(`${depSchemaPath}/ops/0.schema.sql`), '-- schema v2\n');
  } finally {
    logger.info = originalInfo;
    logger.debug = originalDebug;
    logger.warn = originalWarn;

    if (previousEnv === undefined) {
      Deno.env.delete(SCHEMA_PATH_OVERRIDE_ENV);
    } else {
      Deno.env.set(SCHEMA_PATH_OVERRIDE_ENV, previousEnv);
    }

    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
