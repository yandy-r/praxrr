import { assert, assertEquals } from '@std/assert';
import { parse } from '@std/yaml';
import type { components } from '$api/v1.d.ts';
import { JOB_TYPES } from '$jobs/queueTypes.ts';
import {
  LIVE_EVENT_TYPES,
  type LiveCanaryUpdatedEvent,
  type LiveDriftUpdatedEvent,
  type LiveEvent,
  type LiveHelloEvent,
  type LiveJobFinishedEvent,
  type LiveJobQueuedEvent,
  type LiveJobRunningEvent,
  type LiveResyncEvent,
  type LiveSessionExpiredEvent,
  type LiveSyncRecordedEvent,
} from '$shared/events/types.ts';

type Schemas = components['schemas'];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Compile-time lockstep between the shared union and the generated OpenAPI declarations.
const _hello: Same<LiveHelloEvent, Schemas['LiveHelloEvent']> = true;
const _resync: Same<LiveResyncEvent, Schemas['LiveResyncEvent']> = true;
const _jobQueued: Same<LiveJobQueuedEvent, Schemas['LiveJobQueuedEvent']> = true;
const _jobRunning: Same<LiveJobRunningEvent, Schemas['LiveJobRunningEvent']> = true;
const _jobFinished: Same<LiveJobFinishedEvent, Schemas['LiveJobFinishedEvent']> = true;
const _syncRecorded: Same<LiveSyncRecordedEvent, Schemas['LiveSyncRecordedEvent']> = true;
const _canaryUpdated: Same<LiveCanaryUpdatedEvent, Schemas['LiveCanaryUpdatedEvent']> = true;
const _driftUpdated: Same<LiveDriftUpdatedEvent, Schemas['LiveDriftUpdatedEvent']> = true;
const _sessionExpired: Same<LiveSessionExpiredEvent, Schemas['LiveSessionExpiredEvent']> = true;
const _event: Same<LiveEvent, Schemas['LiveEvent']> = true;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

async function readEventSchemas(): Promise<Record<string, unknown>> {
  const url = new URL('../../../../../docs/api/v1/schemas/events.yaml', import.meta.url);
  return asRecord(parse(await Deno.readTextFile(url)), 'events.yaml');
}

Deno.test('LiveJobType enum matches JOB_TYPES', async () => {
  const schemas = await readEventSchemas();
  const jobType = asRecord(schemas.LiveJobType, 'LiveJobType');
  assertEquals(jobType.enum, [...JOB_TYPES]);
});

Deno.test('LiveEvent discriminator mapping keys match LIVE_EVENT_TYPES', async () => {
  const schemas = await readEventSchemas();
  const liveEvent = asRecord(schemas.LiveEvent, 'LiveEvent');
  const discriminator = asRecord(liveEvent.discriminator, 'LiveEvent.discriminator');
  assertEquals(discriminator.propertyName, 'type');
  const mapping = asRecord(discriminator.mapping, 'LiveEvent.discriminator.mapping');
  assertEquals(Object.keys(mapping), [...LIVE_EVENT_TYPES]);
});

Deno.test('openapi.yaml exposes the /events path', async () => {
  const url = new URL('../../../../../docs/api/v1/openapi.yaml', import.meta.url);
  const spec = asRecord(parse(await Deno.readTextFile(url)), 'openapi.yaml');
  const paths = asRecord(spec.paths, 'openapi.yaml paths');
  assert('/events' in paths, 'openapi.yaml must declare /events');
});
