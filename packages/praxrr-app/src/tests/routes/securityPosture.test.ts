// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { CHECK_IDS, SECURITY_POSTURE_ENGINE_VERSION } from '$shared/security/index.ts';
import { createDnsTransportResolver, overrideDnsTransportResolverForTest } from '$lib/server/security/dnsTransport.ts';
import type { DnsRecordType, DnsTransportResolver, ResolveDns } from '$lib/server/security/dnsTransport.ts';
import type { SecurityPostureSummaryResponse } from '$lib/server/security/responses.ts';
import { GET as GET_SUMMARY } from '../../routes/api/v1/security-posture/summary/+server.ts';

type SummaryGetEvent = Parameters<typeof GET_SUMMARY>[0];

/**
 * Mirrors configHealth.test.ts: point the db singleton at a scratch SQLite file under a fresh temp
 * base path, run the full migration chain (so arr_instances / arr_instance_credentials / auth_settings
 * exist in real context), invoke the handler, then tear down. No job dispatcher — security posture is
 * computed on demand with no persistence.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/security-posture-route-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

/** Minimal slice the summary handler actually reads (`event.url` / `event.request`); `{}` => unknown transport. */
type SummaryEventOverride = { url?: URL; request?: Request };

function summaryEvent(override: SummaryEventOverride = {}): SummaryGetEvent {
  return override as unknown as SummaryGetEvent;
}

function insertInstance(name: string, type: string, url: string): void {
  db.execute(
    `INSERT INTO arr_instances (name, type, url, external_url, api_key, api_key_fingerprint, tags, enabled, source)
     VALUES (?, ?, ?, NULL, '', NULL, NULL, 1, 'ui')`,
    name,
    type,
    url
  );
}

// prettier-ignore
async function getSummary(
  override: SummaryEventOverride = {}
): Promise<{ status: number; cacheControl: string | null; serialized: string; body: SecurityPostureSummaryResponse }> {
  const response = await GET_SUMMARY(summaryEvent(override));
	const serialized = await response.text();
	return {
		status: response.status,
		cacheControl: response.headers.get('cache-control'),
		serialized,
		body: JSON.parse(serialized) as SecurityPostureSummaryResponse,
	};
}

// prettier-ignore
async function withDnsResolver<T>(resolver: DnsTransportResolver, fn: () => Promise<T>): Promise<T> {
	const restore = overrideDnsTransportResolverForTest(resolver);
	try {
		return await fn();
	} finally {
		restore();
	}
}

// prettier-ignore
function rowByHost(body: SecurityPostureSummaryResponse, host: string) {
	const row = body.transport.find((candidate) => candidate.host === host);
	assert(row, `expected transport row for ${host}`);
	return row;
}

const ZERO_DNS_COUNTS = { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 };

migratedTest('GET /security-posture/summary returns a well-formed report with zero instances', async () => {
  const { status, body } = await getSummary();
  assertEquals(status, 200);
  assertEquals(body.engineVersion, SECURITY_POSTURE_ENGINE_VERSION);
  assert(body.score >= 0 && body.score <= 100);
  assert(['hardened', 'guarded', 'exposed', 'unknown'].includes(body.band));

  // All six checks are present, in the canonical order (proxy_trust joined in issue #228).
  assertEquals(
    body.checks.map((c) => c.id),
    [...CHECK_IDS]
  );
  // proxy_trust rides the wire contract; with TRUSTED_PROXY unset it is inert (null), so it must not
  // shift the score — this pins the OpenAPI enum + wire lockstep and the numeric-invariance guarantee.
  const proxyTrust = body.checks.find((c) => c.id === 'proxy_trust');
  assert(proxyTrust, 'proxy_trust must be present in the wire report');
  assertEquals(proxyTrust?.score, null);
  // Contributions sum EXACTLY to the score (the invariant survives the wire mapping).
  assertEquals(
    body.checks.reduce((total, c) => total + c.contribution, 0),
    body.score
  );

  // Encryption-at-rest is a verified assurance; the transport table is empty with no instances.
  assert(body.assurances.some((a) => a.id === 'arr_credentials_encrypted' && a.verified));
  assert(body.assurances.some((a) => a.id === 'log_redaction'));
  assertEquals(body.transport.length, 0);
});

migratedTest('GET /security-posture/summary grades a plaintext instance and carries a fix', async () => {
  insertInstance('Radarr LAN', 'radarr', 'http://10.0.0.5:7878');
  const { status, body } = await getSummary();
  assertEquals(status, 200);

  assertEquals(body.transport.length, 1);
  const row = body.transport[0];
  assertEquals(row.scheme, 'http');
  assertEquals(row.tier, 'private');
  assertEquals(row.host, '10.0.0.5');
  assertEquals(row.fix.kind, 'instance-link');

  const transport = body.checks.find((c) => c.id === 'arr_transport');
  assertEquals(transport?.score, 65);
  assert((transport?.recommendations.length ?? 0) >= 1);
});

migratedTest('GET /security-posture/summary grades transport from url, never external_url', async () => {
  // url is https+loopback (grades 100/encrypted); external_url is public http (would grade 30/public if
  // gather wrongly used it). The guardrail: the Arr API key never travels over external_url.
  db.execute(
    `INSERT INTO arr_instances (name, type, url, external_url, api_key, api_key_fingerprint, tags, enabled, source)
     VALUES ('Radarr', 'radarr', 'https://127.0.0.1:7878', 'http://8.8.8.8:7878', '', NULL, NULL, 1, 'ui')`
  );
  const { body } = await getSummary();
  const row = body.transport[0];
  assertEquals(row.scheme, 'https'); // from url, not external_url's http
  assertEquals(row.host, '127.0.0.1'); // from url, not the public external_url host
  assertEquals(row.tier, 'encrypted');
});

// prettier-ignore
migratedTest('GET /security-posture/summary emits bounded redacted DNS evidence without state leaks', async () => {
	let now = 1_000;
	const calls: { hostname: string; recordType: DnsRecordType }[] = [];
	const resolveDns: ResolveDns = (hostname, recordType) => {
		calls.push({ hostname, recordType });
		if (hostname === 'failed.example.com') {
			return Promise.reject(new Error('TOP_SECRET_RESOLVER_ERROR'));
		}
		if (hostname === 'partial.example.com' && recordType === 'AAAA') {
			return Promise.reject(new Error('TOP_SECRET_PARTIAL_ERROR'));
		}
		if (recordType === 'AAAA') {
			return Promise.resolve(hostname === 'mixed.example.com' ? ['fd00::1'] : []);
		}
		const answers: Readonly<Record<string, readonly string[]>> = {
			'public.example.com': ['8.8.8.8'],
			'mixed.example.com': ['10.0.0.1', '8.8.4.4'],
			'partial.example.com': ['1.1.1.1'],
			'cache.example.com': ['192.168.1.5'],
			'change.example.com': now < 61_000 ? ['10.1.2.3'] : ['9.9.9.9'],
		};
		return Promise.resolve(answers[hostname] ?? []);
	};
	const resolver = createDnsTransportResolver({
		resolveDns,
		now: () => now,
		setTimer: (callback, delayMs) => setTimeout(callback, Math.min(delayMs, 10_000))
	});

	await withDnsResolver(resolver, async () => {
		insertInstance(
			'Public',
			'radarr',
			'http://user:password@public.example.com:7878/secret/path?api_key=raw-secret'
		);
		insertInstance('Mixed', 'sonarr', 'http://mixed.example.com:8989');
		insertInstance('Partial', 'lidarr', 'http://partial.example.com:8686');
		insertInstance('Cache', 'radarr', 'http://cache.example.com:7878');
		insertInstance('Change', 'sonarr', 'http://change.example.com:8989');
		insertInstance('Failure', 'lidarr', 'http://failed.example.com:8686');
		db.execute(
			`UPDATE arr_instances SET external_url = ? WHERE name = 'Public'`,
			'http://external-only.example.com:7878/external/path?api_key=external-secret'
		);

		const first = await getSummary();
		assertEquals(first.status, 200);
		assertEquals(first.cacheControl, 'no-store');
		assertEquals(first.body.engineVersion, '4');

		const publicRow = rowByHost(first.body, 'public.example.com');
		assertEquals(publicRow.arrType, 'radarr');
		assertEquals(publicRow.tier, 'public');
		assertEquals(publicRow.score, 30);
		assertEquals(publicRow.status, 'action');
		assertEquals(publicRow.dns, {
			outcome: 'resolved',
			source: 'fresh',
			ipv4: { ...ZERO_DNS_COUNTS, public: 1 },
			ipv6: ZERO_DNS_COUNTS,
			retainedCount: 1,
			observedAt: '1970-01-01T00:00:01.000Z',
			incomplete: false,
			truncated: false,
			addressClassesChanged: false,
		});

		const mixedRow = rowByHost(first.body, 'mixed.example.com');
		assertEquals(mixedRow.arrType, 'sonarr');
		assertEquals(mixedRow.tier, 'mixed');
		assertEquals(mixedRow.score, 30);
		assertEquals(mixedRow.dns, {
			outcome: 'resolved',
			source: 'fresh',
			ipv4: { ...ZERO_DNS_COUNTS, private: 1, public: 1 },
			ipv6: { ...ZERO_DNS_COUNTS, private: 1 },
			retainedCount: 3,
			observedAt: '1970-01-01T00:00:01.000Z',
			incomplete: false,
			truncated: false,
			addressClassesChanged: false,
		});

		const partialRow = rowByHost(first.body, 'partial.example.com');
		assertEquals(partialRow.arrType, 'lidarr');
		assertEquals(partialRow.tier, 'mixed');
		assertEquals(partialRow.score, 30);
		assertEquals(partialRow.dns, {
			outcome: 'partial',
			source: 'fresh',
			ipv4: { ...ZERO_DNS_COUNTS, public: 1 },
			ipv6: ZERO_DNS_COUNTS,
			retainedCount: 1,
			observedAt: '1970-01-01T00:00:01.000Z',
			incomplete: true,
			truncated: false,
			addressClassesChanged: false
		});

		const failedRow = rowByHost(first.body, 'failed.example.com');
		assertEquals(failedRow.tier, 'unknown');
		assertEquals(failedRow.score, 65);
		assertEquals(failedRow.status, 'attention');
		assertEquals(failedRow.dns, {
			outcome: 'failed',
			source: 'fresh',
			ipv4: ZERO_DNS_COUNTS,
			ipv6: ZERO_DNS_COUNTS,
			retainedCount: 0,
			observedAt: '1970-01-01T00:00:01.000Z',
			incomplete: true,
			truncated: false,
			addressClassesChanged: false
		});

		const second = await getSummary();
		assertEquals(second.status, 200);
		assertEquals(second.cacheControl, 'no-store');
		const cachedRow = rowByHost(second.body, 'cache.example.com');
		assertEquals(cachedRow.dns, {
			outcome: 'resolved',
			source: 'cache',
			ipv4: { ...ZERO_DNS_COUNTS, private: 1 },
			ipv6: ZERO_DNS_COUNTS,
			retainedCount: 1,
			observedAt: '1970-01-01T00:00:01.000Z',
			incomplete: false,
			truncated: false,
			addressClassesChanged: false
		});

		const beforeChange = rowByHost(second.body, 'change.example.com');
		assertEquals(beforeChange.tier, 'private');
		assertEquals(beforeChange.dns.source, 'cache');
		assertEquals(beforeChange.dns.addressClassesChanged, false);

		now = 61_001;
		const third = await getSummary();
		assertEquals(third.status, 200);
		assertEquals(third.cacheControl, 'no-store');
		const changedRow = rowByHost(third.body, 'change.example.com');
		assertEquals(changedRow.tier, 'mixed');
		assertEquals(changedRow.score, 30);
		assertEquals(changedRow.status, 'action');
		assertEquals(changedRow.dns, {
			outcome: 'resolved',
			source: 'fresh',
			ipv4: { ...ZERO_DNS_COUNTS, public: 1 },
			ipv6: ZERO_DNS_COUNTS,
			retainedCount: 1,
			observedAt: '1970-01-01T00:01:01.001Z',
			incomplete: false,
			truncated: false,
			addressClassesChanged: true
		});

		for (const serialized of [first.serialized, second.serialized, third.serialized]) {
			for (const forbidden of [
				'8.8.8.8',
				'10.0.0.1',
				'fd00::1',
				'1.1.1.1',
				'TOP_SECRET_RESOLVER_ERROR',
				'TOP_SECRET_PARTIAL_ERROR',
				'user:password@',
				'/secret/path',
				'external-only.example.com',
				'/external/path',
				'raw-secret',
				'external-secret',
				'api_key',
			]) {
				assert(!serialized.includes(forbidden), `response leaked ${forbidden}`);
			}
		}

		const transportCopy = JSON.stringify(
			third.body.checks.find((check) => check.id === 'arr_transport')
		).toLowerCase();
		for (const overclaim of ['publicly reachable', 'attack detected', 'dns rebinding detected', 'exposed']) {
			assert(!transportCopy.includes(overclaim), `transport copy overclaimed ${overclaim}`);
		}
	});

	assert(calls.length > 0, 'the injected resolver must serve every DNS observation');
	assert(calls.every((call) => call.recordType === 'A' || call.recordType === 'AAAA'));
	assert(calls.every((call) => call.hostname !== 'external-only.example.com'));
});

migratedTest('GET /security-posture/summary never returns a secret value', async () => {
  insertInstance('Radarr', 'radarr', 'http://radarr:7878');
  const { body } = await getSummary();
  const serialized = JSON.stringify(body);
  // Host strings and presence booleans only — never an api key value or a masked field name.
  assert(!serialized.includes('"api_key"'));
  assert(!serialized.toLowerCase().includes('password'));
  // The redaction self-verify must not have leaked its own planted sentinel into the payload.
  assert(!serialized.includes('deadbeefdeadbeefdeadbeefdeadbeef'));
});

migratedTest(
  'GET /security-posture/summary reports unknown session transport and the secretless session assurance',
  async () => {
    const { status, body } = await getSummary();
    assertEquals(status, 200);
    // Report surface: '3' proxy trust (#228) → '4' DNS transport evidence (#229).
    assertEquals(body.engineVersion, '4');

    // A no-context ({}) event cannot observe transport, so it is reported unknown and never assumed safe.
    const transportAdvisory = body.advisories.find((a) => a.id === 'session_cookie_transport');
    assert(transportAdvisory, 'session_cookie_transport advisory present for an unobservable transport');
    assert(
      transportAdvisory.detail.join(' ').includes('could not be observed'),
      'the advisory reports the transport as unknown'
    );

    // The secretless session model is affirmed; the direct-HTTPS Secure assurance is withheld (transport unknown).
    assert(body.assurances.some((a) => a.id === 'session_secret' && a.verified));
    assert(!body.assurances.some((a) => a.id === 'session_cookie_secure'));
  }
);

migratedTest(
  'GET /security-posture/summary affirms Secure over a direct-HTTPS request and drops the transport advisory',
  async () => {
    const httpsUrl = 'https://praxrr.example/api/v1/security-posture/summary';
    const { status, body } = await getSummary({ url: new URL(httpsUrl), request: new Request(httpsUrl) });
    assertEquals(status, 200);

    // direct-secure transport (url.protocol === 'https:') + default auto => no advisory, verified Secure assurance.
    assert(!body.advisories.some((a) => a.id === 'session_cookie_transport'));
    assert(body.assurances.some((a) => a.id === 'session_cookie_secure' && a.verified));
  }
);
