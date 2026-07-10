import { assertEquals, assertInstanceOf, assertThrows } from '@std/assert';
import { ConfigHealthTrendQueryError, parseConfigHealthTrendFilters } from '$lib/server/health/trendFilters.ts';

const NOW = '2026-07-10T12:34:56.789Z';

function trendUrl(query = ''): URL {
  return new URL(`http://localhost/api/v1/config-health/1/trends${query ? `?${query}` : ''}`);
}

function assertQueryError(query: string, message: string): void {
  const error = assertThrows(
    () => parseConfigHealthTrendFilters(trendUrl(query), () => Date.parse(NOW)),
    ConfigHealthTrendQueryError,
    message
  );
  assertInstanceOf(error, ConfigHealthTrendQueryError);
  assertEquals(error.status, 400);
}

Deno.test('trend filters capture one clock value and bound omitted all-history through that instant', () => {
  let calls = 0;
  const result = parseConfigHealthTrendFilters(trendUrl(), () => {
    calls += 1;
    return new Date(NOW);
  });

  assertEquals(calls, 1);
  assertEquals(result, { from: undefined, to: NOW, profile: undefined });
});

Deno.test('trend filters treat empty absolute bounds as all-history with a captured upper bound', () => {
  const result = parseConfigHealthTrendFilters(trendUrl('from=&to='), () => Date.parse(NOW));
  assertEquals(result, { from: undefined, to: NOW, profile: undefined });
});

Deno.test('trend filters normalize relative days to a deterministic absolute UTC window', () => {
  const result = parseConfigHealthTrendFilters(trendUrl('days=30'), () => Date.parse(NOW));
  assertEquals(result, {
    from: '2026-06-10T12:34:56.789Z',
    to: NOW,
    profile: undefined,
  });
});

Deno.test('trend filters expand inclusive date-only bounds', () => {
  const result = parseConfigHealthTrendFilters(trendUrl('from=2026-06-01&to=2026-06-30'), () => Date.parse(NOW));
  assertEquals(result, {
    from: '2026-06-01T00:00:00.000Z',
    to: '2026-06-30T23:59:59.999Z',
    profile: undefined,
  });
});

Deno.test('trend filters normalize ISO offsets and allow equal inclusive bounds', () => {
  const result = parseConfigHealthTrendFilters(
    trendUrl('from=2026-07-10T14%3A34%3A56.789%2B02%3A00&to=2026-07-10T12%3A34%3A56.789Z'),
    () => Date.parse(NOW)
  );
  assertEquals(result, { from: NOW, to: NOW, profile: undefined });
});

Deno.test('trend filters use the captured clock for an omitted upper absolute bound', () => {
  const result = parseConfigHealthTrendFilters(trendUrl('from=2026-07-01'), () => Date.parse(NOW));
  assertEquals(result, {
    from: '2026-07-01T00:00:00.000Z',
    to: NOW,
    profile: undefined,
  });
});

Deno.test('trend filters preserve exact decoded profile bytes including whitespace, case, and punctuation', () => {
  const url = trendUrl();
  const profile = '  WEB-DL / UHD + Anime?!  ';
  url.searchParams.set('profile', profile);

  const result = parseConfigHealthTrendFilters(url, () => Date.parse(NOW));
  assertEquals(result.profile, profile);
});

Deno.test('trend filters reject invalid day values with a typed 400 error', () => {
  for (const value of ['', '0', '3651', '-1', '1.5', 'seven']) {
    assertQueryError(`days=${encodeURIComponent(value)}`, 'Invalid days');
  }
});

Deno.test('trend filters reject relative and absolute parameter combinations, including empty bounds', () => {
  assertQueryError('days=7&from=2026-07-01', 'days cannot be combined with from or to');
  assertQueryError('days=7&to=', 'days cannot be combined with from or to');
});

Deno.test('trend filters reject malformed and impossible calendar bounds', () => {
  for (const query of ['from=2026-07', 'from=2026-02-30', 'to=2025-13-01', 'to=2026-07-10T24%3A00%3A00Z']) {
    assertQueryError(query, query.startsWith('from=') ? 'Invalid from' : 'Invalid to');
  }
});

Deno.test('trend filters reject reversed normalized bounds', () => {
  assertQueryError('from=2026-07-11&to=2026-07-10', 'from cannot be after to');
  assertQueryError('from=2026-07-11', 'from cannot be after to');
});

Deno.test('trend filters reject only the empty profile and retain whitespace-only identity', () => {
  assertQueryError('profile=', 'Invalid profile');

  const result = parseConfigHealthTrendFilters(trendUrl('profile=%20%20%20'), () => Date.parse(NOW));
  assertEquals(result.profile, '   ');
});
