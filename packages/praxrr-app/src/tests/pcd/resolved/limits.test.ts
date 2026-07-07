import { assertEquals } from '@std/assert';
import { resetRateLimitForTests } from '$utils/rateLimit.ts';
import { COMPARE_MAX_INSTANCES, isInstanceCountWithinCap, registerCompareAttempt } from '$pcd/resolved/limits.ts';

Deno.test('isInstanceCountWithinCap allows exactly the cap', () => {
  assertEquals(isInstanceCountWithinCap(COMPARE_MAX_INSTANCES), true);
});

Deno.test('isInstanceCountWithinCap rejects one past the cap', () => {
  assertEquals(isInstanceCountWithinCap(COMPARE_MAX_INSTANCES + 1), false);
});

Deno.test('isInstanceCountWithinCap rejects zero and negative counts', () => {
  assertEquals(isInstanceCountWithinCap(0), false);
  assertEquals(isInstanceCountWithinCap(-1), false);
});

Deno.test('isInstanceCountWithinCap rejects non-integer counts', () => {
  assertEquals(isInstanceCountWithinCap(1.5), false);
});

Deno.test('registerCompareAttempt allows attempts up to the window max then rejects', () => {
  resetRateLimitForTests();
  try {
    const key = 'user-1';
    // DEFAULT_RATE_LIMIT_MAX_REQUESTS from $utils/rateLimit.ts is 8: the first 8 attempts
    // in the window are allowed, the 9th is throttled.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assertEquals(registerCompareAttempt(key), true, `attempt ${attempt} should be allowed`);
    }

    assertEquals(registerCompareAttempt(key), false);
  } finally {
    resetRateLimitForTests();
  }
});

Deno.test('registerCompareAttempt tracks distinct keys independently', () => {
  resetRateLimitForTests();
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assertEquals(registerCompareAttempt('user-a'), true);
    }
    assertEquals(registerCompareAttempt('user-a'), false);

    // A different key has its own window and is unaffected by 'user-a' being throttled.
    assertEquals(registerCompareAttempt('user-b'), true);
  } finally {
    resetRateLimitForTests();
  }
});
