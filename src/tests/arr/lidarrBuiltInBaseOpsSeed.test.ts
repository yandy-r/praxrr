import { assertEquals, assertStringIncludes } from '@std/assert';
import { BaseTest } from '../base/BaseTest.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';
import { seedBuiltInBaseOps } from '$pcd/ops/seedBuiltInBaseOps.ts';
import {
  LIDARR_MEDIA_MANAGEMENT_OP_FILENAME,
  LIDARR_MEDIA_MANAGEMENT_OP_METADATA,
  LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
} from '$db/migrations/20260215_add_lidarr_media_management_entities.ts';
import { LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME } from '$db/migrations/20260216_enforce_native_lidarr_quality_mappings.ts';
import { LIDARR_NAMING_DEFAULTS_OP_FILENAME } from '$db/migrations/20260217_set_lidarr_naming_defaults.ts';

type Restore = () => void;

class LidarrBuiltInBaseOpsSeedTest extends BaseTest {
  private restores: Restore[] = [];

  private patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    this.restores.push(() => {
      target[key] = original;
    });
  }

  protected override afterEach(): void {
    while (this.restores.length > 0) {
      const restore = this.restores.pop();
      restore?.();
    }
  }

  runTests(): void {
    this.test('creates all built-in base ops when missing', async () => {
      const createdInputs: Array<Parameters<(typeof pcdOpsQueries)['create']>[0]> = [];

      this.patch(pcdOpsQueries, 'getBaseByFilename', () => undefined);
      this.patch(pcdOpsQueries, 'create', (input) => {
        createdInputs.push(input);
        return 1;
      });
      this.patch(logger, 'debug', async () => {});

      const result = await seedBuiltInBaseOps(42);

      assertEquals(result, { created: 3, skipped: 0 });
      assertEquals(createdInputs.length, 3);

      // First op: Lidarr media management entities
      assertEquals(createdInputs[0].databaseId, 42);
      assertEquals(createdInputs[0].origin, 'base');
      assertEquals(createdInputs[0].state, 'published');
      assertEquals(createdInputs[0].source, 'local');
      assertEquals(createdInputs[0].filename, LIDARR_MEDIA_MANAGEMENT_OP_FILENAME);
      assertEquals(createdInputs[0].opNumber, LIDARR_MEDIA_MANAGEMENT_OP_VERSION);
      assertEquals(createdInputs[0].sequence, LIDARR_MEDIA_MANAGEMENT_OP_VERSION);
      assertEquals(createdInputs[0].metadata, LIDARR_MEDIA_MANAGEMENT_OP_METADATA);
      assertStringIncludes(createdInputs[0].sql, 'CREATE TABLE IF NOT EXISTS lidarr_naming');

      // Second op: Lidarr native quality mappings
      assertEquals(createdInputs[1].filename, LIDARR_NATIVE_QUALITY_MAPPINGS_OP_FILENAME);

      // Third op: Lidarr naming defaults
      assertEquals(createdInputs[2].filename, LIDARR_NAMING_DEFAULTS_OP_FILENAME);
    });

    this.test('skips creation when built-in base op already exists', async () => {
      const existing: PcdOp = {
        id: 99,
        database_id: 42,
        origin: 'base',
        state: 'published',
        source: 'local',
        filename: LIDARR_MEDIA_MANAGEMENT_OP_FILENAME,
        op_number: LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
        sequence: LIDARR_MEDIA_MANAGEMENT_OP_VERSION,
        sql: '-- existing',
        metadata: null,
        desired_state: null,
        content_hash: null,
        last_seen_in_repo_at: null,
        superseded_by_op_id: null,
        pushed_at: null,
        pushed_commit: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      let createCalls = 0;
      this.patch(pcdOpsQueries, 'getBaseByFilename', () => existing);
      this.patch(pcdOpsQueries, 'create', () => {
        createCalls += 1;
        return 1;
      });

      const result = await seedBuiltInBaseOps(42);

      assertEquals(result, { created: 0, skipped: 3 });
      assertEquals(createCalls, 0);
    });
  }
}

const test = new LidarrBuiltInBaseOpsSeedTest();
await test.runTests();
