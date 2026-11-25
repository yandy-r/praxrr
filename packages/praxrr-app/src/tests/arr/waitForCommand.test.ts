import { assertEquals, assertRejects } from '@std/assert';
import { ARR_COMMAND_POLL_INTERVAL_MS, BaseArrClient } from '$arr/base.ts';
import type { ArrCommand } from '$arr/types.ts';

/**
 * Test double that replays a fixed sequence of command statuses instead of
 * hitting an Arr instance. The last status repeats once the sequence runs out.
 */
class ScriptedCommandClient extends BaseArrClient {
  calls = 0;

  constructor(
    private readonly statuses: string[],
    private readonly message?: string
  ) {
    super('http://arr.invalid', 'test-key');
  }

  override getCommand(commandId: number): Promise<ArrCommand> {
    const status = this.statuses[Math.min(this.calls, this.statuses.length - 1)];
    this.calls++;
    return Promise.resolve({
      id: commandId,
      name: 'MoviesSearch',
      commandName: 'Movies Search',
      status,
      message: this.message,
    });
  }
}

const FAST = { pollIntervalMs: 1 };

Deno.test('waitForCommand resolves when the command completes', async () => {
  const client = new ScriptedCommandClient(['queued', 'started', 'completed']);
  const command = await client.waitForCommand(7, 5_000, FAST);
  assertEquals(command.status, 'completed');
  assertEquals(client.calls, 3);
});

for (const status of ['failed', 'aborted', 'cancelled', 'orphaned']) {
  Deno.test(`waitForCommand fails fast on terminal status "${status}"`, async () => {
    const client = new ScriptedCommandClient(['started', status], 'stopped by user');
    const error = await assertRejects(
      () => client.waitForCommand(42, 5_000, FAST),
      Error,
      `Command 42 ${status}: stopped by user`
    );
    // Stops on the terminal status poll: no further polling, no timeout.
    assertEquals(client.calls, 2);
    assertEquals(error.message.includes('timed out'), false);
  });
}

Deno.test('waitForCommand treats terminal statuses case-insensitively', async () => {
  const client = new ScriptedCommandClient(['Cancelled']);
  await assertRejects(() => client.waitForCommand(1, 5_000, FAST), Error, 'Command 1 cancelled');
  assertEquals(client.calls, 1);
});

Deno.test('waitForCommand resolves on a mixed-case "Completed" status', async () => {
  const client = new ScriptedCommandClient(['Completed']);
  const command = await client.waitForCommand(1, 5_000, FAST);
  assertEquals(command.status, 'Completed');
});

Deno.test('waitForCommand reports "Unknown error" when the Arr omits a message', async () => {
  const client = new ScriptedCommandClient(['aborted']);
  await assertRejects(() => client.waitForCommand(9, 5_000, FAST), Error, 'Command 9 aborted: Unknown error');
});

Deno.test('waitForCommand still times out for a command that never finishes', async () => {
  const client = new ScriptedCommandClient(['started']);
  await assertRejects(() => client.waitForCommand(3, 20, FAST), Error, 'timed out');
});

Deno.test('waitForCommand times out on an unrecognised status instead of hanging', async () => {
  const client = new ScriptedCommandClient(['unknown']);
  await assertRejects(() => client.waitForCommand(4, 20, FAST), Error, 'timed out');
});

Deno.test('waitForCommand never sleeps past the timeout deadline', async () => {
  const client = new ScriptedCommandClient(['started']);
  const started = Date.now();
  await assertRejects(() => client.waitForCommand(5, 25, { pollIntervalMs: 5_000 }), Error, 'timed out');
  assertEquals(Date.now() - started < 1_000, true);
});

Deno.test('waitForCommand default poll interval is seconds, not milliseconds', () => {
  assertEquals(ARR_COMMAND_POLL_INTERVAL_MS >= 1_000, true);
});
