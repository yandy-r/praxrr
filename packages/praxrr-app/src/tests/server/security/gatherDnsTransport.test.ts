/** Deterministic gatherer integration tests for bounded DNS transport evidence. No live DNS. */

import { assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { buildPostureInputs } from '$lib/server/security/gather.ts';
import { computeShield } from '$lib/server/security/service.ts';
import type { DnsObservationOptions, DnsTransportResolver } from '$lib/server/security/dnsTransport.ts';
import type { DnsTransportEvidence } from '$shared/security/index.ts';

interface ResolverCall {
  readonly hostname: string;
  readonly deadlineAt: number | undefined;
}

const PRIVATE_EVIDENCE: DnsTransportEvidence = {
  outcome: 'resolved',
  source: 'fresh',
  ipv4: { loopback: 0, private: 1, linkLocal: 0, public: 0, special: 0 },
  ipv6: { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 },
  retainedCount: 1,
  observedAt: '2026-07-10T00:00:00.000Z',
  incomplete: false,
  truncated: false,
  addressClassesChanged: false,
};

const DEADLINE_EVIDENCE: DnsTransportEvidence = {
  outcome: 'budget-exceeded',
  source: 'none',
  ipv4: { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 },
  ipv6: { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 },
  retainedCount: 0,
  observedAt: null,
  incomplete: true,
  truncated: false,
  addressClassesChanged: false,
};

class FakeResolver implements DnsTransportResolver {
  readonly calls: ResolverCall[] = [];
  readonly failingHosts = new Set<string>();
  readonly evidenceByHostname = new Map<string, DnsTransportEvidence>();

  observe(hostname: string, options: DnsObservationOptions = {}): Promise<DnsTransportEvidence> {
    this.calls.push({ hostname, deadlineAt: options.deadlineAt });
    if (this.failingHosts.has(hostname)) return Promise.reject(new Error('synthetic resolver failure'));
    return Promise.resolve(this.evidenceByHostname.get(hostname) ?? PRIVATE_EVIDENCE);
  }

  reset(): void {
    this.calls.length = 0;
    this.failingHosts.clear();
    this.evidenceByHostname.clear();
  }
}

function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/security-gather-dns-${crypto.randomUUID()}`;
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

interface InstanceInput {
  readonly name: string;
  readonly url: string;
  readonly externalUrl?: string;
  readonly enabled?: boolean;
  readonly type?: string;
}

function insertInstance({ name, url, externalUrl = '', enabled = true, type = 'radarr' }: InstanceInput): void {
  db.execute(
    `INSERT INTO arr_instances
			(name, type, url, external_url, api_key, api_key_fingerprint, tags, enabled, source)
		 VALUES (?, ?, ?, ?, '', NULL, NULL, ?, 'ui')`,
    name,
    type,
    url,
    externalUrl || null,
    enabled ? 1 : 0
  );
}

migratedTest('gather resolves only eligible stored HTTP hostnames and normalizes the DNS key', async () => {
  insertInstance({
    name: '01 eligible',
    url: 'http://Example.COM.:7878',
    externalUrl: 'http://external.example.net:7878',
  });
  insertInstance({ name: '02 encrypted', url: 'https://encrypted.example.com:7878' });
  insertInstance({ name: '03 public literal', url: 'http://8.8.8.8:7878' });
  insertInstance({ name: '04 private suffix', url: 'http://media.internal:7878' });
  insertInstance({ name: '05 single label', url: 'http://radarr:7878' });
  insertInstance({ name: '06 malformed', url: 'not a url' });
  insertInstance({ name: '07 disabled', url: 'http://disabled.example.com:7878', enabled: false });

  const resolver = new FakeResolver();
  const inputs = await buildPostureInputs(undefined, { resolver, now: () => 1_000 });

  assertEquals(resolver.calls, [{ hostname: 'example.com', deadlineAt: 3_000 }]);
  assertEquals(inputs.instances.length, 6);
  assertEquals(inputs.instances[0].dns, PRIVATE_EVIDENCE);
  for (const instance of inputs.instances.slice(1)) assertEquals(instance.dns, undefined);
});

migratedTest('gather deduplicates hostnames and projects one observation to every matching Arr row', async () => {
  insertInstance({ name: '01 radarr', type: 'radarr', url: 'http://shared.example.com:7878' });
  insertInstance({ name: '02 sonarr', type: 'sonarr', url: 'http://SHARED.EXAMPLE.COM.:8989' });
  insertInstance({ name: '03 lidarr', type: 'lidarr', url: 'http://shared.example.com:8686' });

  const resolver = new FakeResolver();
  const inputs = await buildPostureInputs(undefined, { resolver, now: () => 5_000 });

  assertEquals(resolver.calls, [{ hostname: 'shared.example.com', deadlineAt: 7_000 }]);
  assertEquals(
    inputs.instances.map(({ arrType, dns }) => ({ arrType, dns })),
    [
      { arrType: 'radarr', dns: PRIVATE_EVIDENCE },
      { arrType: 'sonarr', dns: PRIVATE_EVIDENCE },
      { arrType: 'lidarr', dns: PRIVATE_EVIDENCE },
    ]
  );
});

migratedTest('gather caps unique DNS candidates at 32 and marks only overflow rows', async () => {
  for (let index = 0; index < 34; index += 1) {
    const padded = String(index).padStart(2, '0');
    insertInstance({ name: `instance-${padded}`, url: `http://host-${padded}.example.com:7878` });
  }

  const resolver = new FakeResolver();
  const inputs = await buildPostureInputs(undefined, { resolver, now: () => 10_000 });

  assertEquals(
    resolver.calls.map(({ hostname }) => hostname),
    Array.from({ length: 32 }, (_, index) => `host-${String(index).padStart(2, '0')}.example.com`)
  );
  assertEquals(inputs.instances[31].dns, PRIVATE_EVIDENCE);
  assertEquals(inputs.instances[32].dns?.outcome, 'budget-exceeded');
  assertEquals(inputs.instances[32].dns?.source, 'none');
  assertEquals(inputs.instances[33].dns?.outcome, 'budget-exceeded');
});

migratedTest('gather contains deadline and resolver failures to matching rows while computeShield awaits', async () => {
  insertInstance({ name: '01 deadline', url: 'http://deadline.example.com:7878' });
  insertInstance({ name: '02 failed', url: 'http://failed.example.com:7878' });
  insertInstance({ name: '03 healthy', url: 'http://healthy.example.com:7878' });

  const resolver = new FakeResolver();
  resolver.evidenceByHostname.set('deadline.example.com', DEADLINE_EVIDENCE);
  resolver.failingHosts.add('failed.example.com');
  const report = await computeShield(undefined, { resolver, now: () => 20_000 });

  assertEquals(report.transport[0].dns, DEADLINE_EVIDENCE);
  assertEquals(report.transport[1].dns.outcome, 'failed');
  assertEquals(report.transport[1].dns.source, 'none');
  assertEquals(report.transport[2].dns, PRIVATE_EVIDENCE);
  assertEquals(report.transport[2].tier, 'private');
});
