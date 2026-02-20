import { assertEquals, assertFalse } from '@std/assert';
import { sanitizeLogMeta } from '../../lib/server/utils/logger/sanitizer.ts';
import { isMaskedValue, maskApiKey } from "../../lib/shared/utils/masking.ts";

Deno.test("maskApiKey handles null keys", () => {
  assertEquals(maskApiKey(null), "");
  assertEquals(maskApiKey(undefined), "");
});

Deno.test("maskApiKey handles empty keys", () => {
  assertEquals(maskApiKey(""), "");
});

Deno.test("maskApiKey handles short keys", () => {
  assertEquals(maskApiKey("a"), "••••••••");
  assertEquals(maskApiKey("1234"), "••••••••");
  assertEquals(maskApiKey("12345"), "••••••••");
  assertEquals(maskApiKey("1234567"), "••••••••");
  assertEquals(maskApiKey("abcdefgh"), "••••••••efgh");
});

Deno.test("maskApiKey handles normal keys", () => {
  assertEquals(maskApiKey("abcdefghijklmnopqrstuvwxyz"), "••••••••wxyz");
  assertEquals(maskApiKey("abcdefghijklmnopqrst", 6), "••••••••opqrst");
});

Deno.test("isMaskedValue detects masked values", () => {
  assertEquals(isMaskedValue("••••••••wxyz"), true);
  assertEquals(isMaskedValue("••••••••"), true);
  assertEquals(isMaskedValue(""), false);
  assertEquals(isMaskedValue("not-masked"), false);
});

Deno.test("sanitizeLogMeta redacts nested metadata values", () => {
  const nestedSensitiveMeta = {
    request: {
      headers: {
        api_key: '0123456789abcdef0123456789abcdef',
      },
      payload: [
        {
          api_token: 'sk-ABCDEFGHIJKLMNOPQRSTUV',
        },
        {
          details: {
            authorization: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
          },
        },
      ],
    },
    meta: {
      empty_api_key: '',
    },
  };

  const sanitized = sanitizeLogMeta(nestedSensitiveMeta) as {
    request: {
      headers: {
        api_key: string;
      };
      payload: Array<
        {
          api_token?: string;
        } & {
          details?: {
            authorization?: string;
          };
        }
      >;
    };
    meta: {
      empty_api_key: string;
    };
  };

  assertFalse(JSON.stringify(sanitized).includes('0123456789abcdef0123456789abcdef'));
  assertFalse(JSON.stringify(sanitized).includes('sk-ABCDEFGHIJKLMNOPQRSTUV'));
  assertFalse(
    JSON.stringify(sanitized).includes('eyJhbGciOiJIUzI1NiJ9.payload.signature')
  );
  assertEquals(sanitized.request.headers.api_key, '[REDACTED]');
  assertEquals(sanitized.request.payload[0].api_token, '[REDACTED]');
  assertEquals(
    sanitized.request.payload[1].details?.authorization,
    '[REDACTED]'
  );
  assertEquals(sanitized.meta.empty_api_key, '');
});
