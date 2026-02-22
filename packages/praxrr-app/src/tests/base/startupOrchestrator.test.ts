import { assertEquals, assertRejects } from '@std/assert';
import { processBatches, withTimeout } from '../../lib/server/pull/startup/orchestrator.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

Deno.test('withTimeout resolves when wrapped promise finishes in time', async () => {
  const result = await withTimeout(Promise.resolve('completed'), 25);
  assertEquals(result, 'completed');
});

Deno.test('withTimeout rejects with timeout error after elapsed ms', async () => {
  await assertRejects(
    () =>
      withTimeout(
        new Promise<never>(() => {
          // never resolves
        }),
        20
      ),
    Error,
    'Startup pull timed out after 20ms'
  );
});

Deno.test('processBatches respects concurrency limit', async () => {
  let active = 0;
  let maxActive = 0;

  const items = [1, 2, 3, 4];
  const results = await processBatches(
    items,
    async (value: number) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await wait(15);
      active--;
      return value * 2;
    },
    2
  );

  assertEquals(results, [2, 4, 6, 8]);
  assertEquals(maxActive, 2);
});
