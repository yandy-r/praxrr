import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  deliveryTiming,
  maskSecrets,
  MAX_RETRY_AFTER_MS,
  NotificationDeliveryError,
  postJson,
} from '$notifications/base/delivery.ts';

type Responder = (call: number) => Response | Promise<Response>;

/**
 * Stub fetch with `respond(callIndex)` and capture requested sleeps; restores both afterward.
 */
async function withStubs(
  respond: Responder,
  fn: (state: { calls: Array<{ url: string; init?: RequestInit }>; sleeps: number[] }) => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalSleep = deliveryTiming.sleep;
  const state = { calls: [] as Array<{ url: string; init?: RequestInit }>, sleeps: [] as number[] };
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    state.calls.push({ url: String(input), init });
    return Promise.resolve(respond(state.calls.length));
  };
  deliveryTiming.sleep = (ms: number) => {
    state.sleeps.push(ms);
    return Promise.resolve();
  };
  try {
    await fn(state);
  } finally {
    globalThis.fetch = originalFetch;
    deliveryTiming.sleep = originalSleep;
  }
}

const URL_WITH_TOKEN = 'https://hooks.example.com/notify/s3cr3t-t0ken';

Deno.test('postJson retries a transient 503 then succeeds with attempts 2 and exponential backoff', async () => {
  await withStubs(
    (call) => (call === 1 ? new Response('busy', { status: 503 }) : new Response(null, { status: 204 })),
    async ({ calls, sleeps }) => {
      const result = await postJson(URL_WITH_TOKEN, { hello: 'world' }, { secrets: [] });
      assertEquals(result, { attempts: 2 });
      assertEquals(calls.length, 2);
      assertEquals(sleeps, [1000]);
      assertEquals(calls[0].init?.method, 'POST');
      assertEquals(calls[0].init?.body, '{"hello":"world"}');
      assertEquals(new Headers(calls[0].init?.headers).get('content-type'), 'application/json');
    }
  );
});

Deno.test('postJson does not retry a 400 and reports attempts 1 with the status', async () => {
  await withStubs(
    () => new Response('bad payload', { status: 400, statusText: 'Bad Request' }),
    async ({ calls, sleeps }) => {
      const error = await assertRejects(() => postJson(URL_WITH_TOKEN, {}, { secrets: [] }), NotificationDeliveryError);
      assertEquals(error.attempts, 1);
      assertEquals(error.status, 400);
      assertEquals(calls.length, 1);
      assertEquals(sleeps, []);
    }
  );
});

Deno.test('postJson honors Retry-After on 429', async () => {
  await withStubs(
    (call) =>
      call === 1
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } })
        : new Response(null, { status: 204 }),
    async ({ sleeps }) => {
      const result = await postJson(URL_WITH_TOKEN, {}, { secrets: [] });
      assertEquals(result.attempts, 2);
      assertEquals(sleeps, [7000]);
    }
  );
});

Deno.test('postJson honors Telegram parameters.retry_after when no header is present', async () => {
  await withStubs(
    (call) =>
      call === 1
        ? Response.json({ ok: false, error_code: 429, parameters: { retry_after: 3 } }, { status: 429 })
        : new Response(null, { status: 204 }),
    async ({ sleeps }) => {
      await postJson(URL_WITH_TOKEN, {}, { secrets: [] });
      assertEquals(sleeps, [3000]);
    }
  );
});

Deno.test('postJson fails without sleeping when Retry-After exceeds the cap', async () => {
  const overCapSeconds = String(MAX_RETRY_AFTER_MS / 1000 + 1);
  await withStubs(
    () => new Response('later', { status: 503, headers: { 'Retry-After': overCapSeconds } }),
    async ({ calls, sleeps }) => {
      const error = await assertRejects(() => postJson(URL_WITH_TOKEN, {}, { secrets: [] }), NotificationDeliveryError);
      assertEquals(error.attempts, 1);
      assertEquals(calls.length, 1);
      assertEquals(sleeps, []);
    }
  );
});

Deno.test('postJson retries network errors up to maxAttempts', async () => {
  await withStubs(
    () => Promise.reject(new TypeError(`connection refused to ${URL_WITH_TOKEN}`)),
    async ({ calls, sleeps }) => {
      const error = await assertRejects(
        () => postJson(URL_WITH_TOKEN, {}, { secrets: [URL_WITH_TOKEN] }),
        NotificationDeliveryError
      );
      assertEquals(error.attempts, 3);
      assertEquals(error.status, 0);
      assertEquals(calls.length, 3);
      assertEquals(sleeps, [1000, 2000]);
      assert(!error.message.includes('s3cr3t-t0ken'));
    }
  );
});

Deno.test('postJson sends a pre-serialized bodyText verbatim with custom headers', async () => {
  const bodyText = '{"b":2,  "a":1}';
  await withStubs(
    () => new Response(null, { status: 204 }),
    async ({ calls }) => {
      await postJson(URL_WITH_TOKEN, { ignored: true }, { secrets: [], bodyText, headers: { 'X-Test': 'yes' } });
      assertEquals(calls[0].init?.body, bodyText);
      const headers = new Headers(calls[0].init?.headers);
      assertEquals(headers.get('x-test'), 'yes');
      assertEquals(headers.get('content-type'), 'application/json');
    }
  );
});

Deno.test('postJson masks raw and URL-encoded secrets in the error message', async () => {
  const token = 'tok/en+with space';
  await withStubs(
    () =>
      new Response(`rejected token ${token} (encoded ${encodeURIComponent(token)})`, {
        status: 401,
        statusText: 'Unauthorized',
      }),
    async () => {
      const error = await assertRejects(
        () => postJson(URL_WITH_TOKEN, {}, { secrets: [token] }),
        NotificationDeliveryError
      );
      assert(!error.message.includes(token));
      assert(!error.message.includes(encodeURIComponent(token)));
      assert(error.message.includes('***'));
    }
  );
});

Deno.test('maskSecrets ignores empty secrets and leaves other text intact', () => {
  assertEquals(maskSecrets('abc secret def', ['', 'secret']), 'abc *** def');
});
