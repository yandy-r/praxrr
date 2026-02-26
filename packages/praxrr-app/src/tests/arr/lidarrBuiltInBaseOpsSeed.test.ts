import { assertEquals } from '@std/assert';
import { BaseTest } from '../base/BaseTest.ts';
import { logger } from '$logger/logger.ts';
import { seedBuiltInBaseOps } from '$pcd/ops/seedBuiltInBaseOps.ts';

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
    this.test('returns no-op result because embedded built-in seed ops were removed', async () => {
      let logged = false;
      this.patch(logger, 'debug', async () => {
        logged = true;
      });

      const result = await seedBuiltInBaseOps(42);

      assertEquals(result, { created: 0, skipped: 0 });
      assertEquals(logged, true);
    });
  }
}

const test = new LidarrBuiltInBaseOpsSeedTest();
await test.runTests();
