import { assertEquals } from '@std/assert';
import type { ActionResult } from '@sveltejs/kit';
import { parse, stringify } from 'npm:devalue';
import {
  failedActionResponse,
  interpretActionResult,
  submitFormActionVia,
} from '../../lib/client/utils/formActionResult.ts';

const fallback = 'Unable to save sync config';

Deno.test('form action failures preserve server errors and status', () => {
  assertEquals(
    interpretActionResult(
      {
        type: 'failure',
        status: 409,
        data: { error: 'Source changed' },
      },
      fallback
    ),
    {
      ok: false,
      message: 'Source changed',
      status: 409,
    }
  );
});

Deno.test('form action failures without a non-empty error string use the fallback', () => {
  for (const data of [
    undefined,
    {},
    { error: '' },
    { error: '   ' },
    {
      error: 123,
    },
  ]) {
    assertEquals(interpretActionResult({ type: 'failure', status: 400, data }, fallback), {
      ok: false,
      message: fallback,
      status: 400,
    });
  }
});

Deno.test('successful form actions preserve their data and default absent data', () => {
  assertEquals(
    interpretActionResult(
      {
        type: 'success',
        status: 200,
        data: { message: 'Sync queued' },
      },
      fallback
    ),
    {
      ok: true,
      data: { message: 'Sync queued' },
    }
  );
  assertEquals(interpretActionResult({ type: 'success', status: 200 }, fallback), {
    ok: true,
    data: {},
  });
});

Deno.test('form action errors do not leak raw error messages', () => {
  assertEquals(
    interpretActionResult(
      {
        type: 'error',
        status: 500,
        error: { message: 'Secret details' },
      },
      fallback
    ),
    {
      ok: false,
      message: fallback,
      status: 500,
    }
  );
  assertEquals(
    interpretActionResult(
      {
        type: 'error',
        error: { message: 'Secret details' },
      },
      fallback
    ),
    {
      ok: false,
      message: fallback,
      status: 500,
    }
  );
});

Deno.test('unexpected form action redirects cannot report success', () => {
  assertEquals(interpretActionResult({ type: 'redirect', status: 303, location: '/arr' }, fallback), {
    ok: false,
    message: fallback,
    status: 303,
  });
});

Deno.test('non-envelope responses use the fallback and HTTP status', () => {
  assertEquals(failedActionResponse(fallback, 502), {
    ok: false,
    message: fallback,
    status: 502,
  });
});

Deno.test('HTTP 200 wire envelopes decode devalue data before interpretation', () => {
  // Equivalent to $app/forms deserialize, without importing SvelteKit browser internals.
  const body = JSON.stringify({
    type: 'failure',
    status: 422,
    data: stringify({ error: 'Select a compatible profile' }),
  });
  const decoded = JSON.parse(body) as {
    type: 'failure';
    status: number;
    data: string;
  };
  const result = { ...decoded, data: parse(decoded.data) } as ActionResult;
  assertEquals(interpretActionResult(result, fallback), {
    ok: false,
    message: 'Select a compatible profile',
    status: 422,
  });
});

Deno.test('submitFormActionVia decodes an HTTP 200 failure envelope end-to-end', async () => {
  const body = JSON.stringify({
    type: 'failure',
    status: 422,
    data: stringify({ error: 'Select a compatible profile' }),
  });
  const calls: string[] = [];
  const result = await submitFormActionVia(
    async (input, init) => {
      calls.push(`${init.method} ${input}`);
      assertEquals(init.body instanceof FormData, true);
      return new Response(body, { status: 200 });
    },
    (text) => {
      const envelope = JSON.parse(text) as { data: string };
      return {
        type: 'failure',
        status: 422,
        data: parse(envelope.data),
      } as ActionResult;
    },
    'saveSyncConfig',
    new FormData(),
    fallback
  );
  assertEquals(calls, ['POST ?/saveSyncConfig']);
  assertEquals(result, {
    ok: false,
    message: 'Select a compatible profile',
    status: 422,
  });
});

Deno.test('submitFormActionVia maps a non-envelope response to the fallback with HTTP status', async () => {
  const result = await submitFormActionVia(
    async () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    () => {
      throw new Error('not an envelope');
    },
    'saveSyncConfig',
    new FormData(),
    fallback
  );
  assertEquals(result, { ok: false, message: fallback, status: 502 });
});
