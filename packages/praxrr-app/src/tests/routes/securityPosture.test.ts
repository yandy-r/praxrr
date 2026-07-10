// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { CHECK_IDS, SECURITY_POSTURE_ENGINE_VERSION } from '$shared/security/index.ts';
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

function summaryEvent(): SummaryGetEvent {
  return {} as unknown as SummaryGetEvent;
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

async function getSummary(): Promise<{ status: number; body: SecurityPostureSummaryResponse }> {
  const response = await GET_SUMMARY(summaryEvent());
  return { status: response.status, body: (await response.json()) as SecurityPostureSummaryResponse };
}

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
