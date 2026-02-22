import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { ArrInstanceClientCache } from '$arr/arrInstanceClients.ts';
import { getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import type { ArrClientOptions } from '$arr/base.ts';
import type { BaseArrClient } from '$arr/base.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import {
  isSyncSectionSupported,
  getUnsupportedSyncSectionReason,
  isMediaManagementSubsectionSupported,
  getUnsupportedMediaManagementSubsectionReason,
  type MediaManagementSubsection,
  type SyncArrType,
} from '$sync/mappings.ts';
import { type JobRunStatus } from '$jobs/queueTypes.ts';
import type {
  StartupPullArrType,
  StartupPullSection,
  StartupPullInstanceInput,
  StartupPullCounters,
  StartupPullInstanceResult,
} from '$lib/server/pull/startup/types.ts';

function isStartupPullSection(section: string): section is StartupPullSection {
  return (
    section === 'qualityProfiles' ||
    section === 'delayProfiles' ||
    section === 'metadataProfiles' ||
    section === 'naming' ||
    section === 'mediaSettings' ||
    section === 'qualityDefinitions'
  );
}

function toSyncArrType(arrType: StartupPullArrType): SyncArrType {
  return arrType;
}

function toMediaManagementSubsection(section: StartupPullSection): MediaManagementSubsection | null {
  if (section === 'mediaSettings' || section === 'naming' || section === 'qualityDefinitions') {
    return section;
  }

  return null;
}

export function resolveStartupArrType(arrType: string): StartupPullArrType {
  if (!isArrAppType(arrType)) {
    throw new Error(`Unsupported startup arr_type '${arrType}'. Expected one of: radarr, sonarr, lidarr.`);
  }

  return arrType;
}

export function assertStartupArrType(
  arrType: string,
  expected: StartupPullArrType,
  context: string
): StartupPullArrType {
  const resolved = resolveStartupArrType(arrType);
  if (resolved !== expected) {
    throw new Error(`${context} unsupported for '${resolved}' instances; expected only '${expected}' instances.`);
  }

  return resolved;
}

export async function loadStartupInstanceAndClient(
  instance: ArrInstance,
  options?: ArrClientOptions,
  cache?: ArrInstanceClientCache
): Promise<{
  instance: ArrInstance & { type: StartupPullArrType };
  client: BaseArrClient;
}> {
  const resolvedType = resolveStartupArrType(instance.type);

  const client = await getArrInstanceClient(resolvedType, instance.id, instance.url, options, cache);

  return {
    instance: {
      ...instance,
      type: resolvedType,
    },
    client,
  };
}

export function getStartupSectionSupportReason(
  arrType: StartupPullArrType,
  section: StartupPullSection
): string | null {
  const syncType = toSyncArrType(arrType);

  if (section === 'naming' || section === 'mediaSettings' || section === 'qualityDefinitions') {
    const subsection = toMediaManagementSubsection(section);
    if (!subsection) {
      return `Unsupported media-management subsection mapping: ${section}`;
    }

    if (!isMediaManagementSubsectionSupported(syncType, subsection)) {
      return getUnsupportedMediaManagementSubsectionReason(syncType, subsection);
    }

    return null;
  }

  if (!isSyncSectionSupported(syncType, section)) {
    return getUnsupportedSyncSectionReason(syncType, section);
  }

  return null;
}

export function assertStartupSectionSupported(
  arrType: StartupPullArrType,
  section: StartupPullSection,
  context: string
): void {
  const reason = getStartupSectionSupportReason(arrType, section);
  if (reason !== null) {
    throw new Error(`${context}: ${reason}`);
  }
}

export function isStartupSectionSupported(arrType: StartupPullArrType, section: StartupPullSection): boolean {
  return getStartupSectionSupportReason(arrType, section) === null;
}

export interface StartupAdapterResultEnvelope {
  status: JobRunStatus;
  output?: string;
  error?: string;
  counters: StartupPullCounters;
}

function createEmptyCounters(): StartupPullCounters {
  return {
    imported: 0,
    skippedDefault: 0,
    skippedNoMatch: 0,
    conflicted: 0,
    failed: 0,
  };
}

export function createAdapterResultEnvelope(status: JobRunStatus = 'skipped'): StartupAdapterResultEnvelope {
  return {
    status,
    counters: createEmptyCounters(),
  };
}

export function incrementCounter(
  envelope: StartupAdapterResultEnvelope,
  counter: keyof StartupPullCounters,
  amount = 1
): void {
  envelope.counters[counter] += amount;
}

export function toStartupPullInstanceResult(
  input: Pick<StartupPullInstanceInput, 'instanceId' | 'instanceName' | 'arrType'>,
  envelope: StartupAdapterResultEnvelope
): StartupPullInstanceResult {
  return {
    instanceId: input.instanceId,
    instanceName: input.instanceName,
    arrType: input.arrType,
    status: envelope.status,
    ...envelope.counters,
  };
}

export function normalizeStartupSection(section: string): StartupPullSection {
  if (!isStartupPullSection(section)) {
    throw new Error(`Unknown startup section '${section}'`);
  }

  return section;
}
