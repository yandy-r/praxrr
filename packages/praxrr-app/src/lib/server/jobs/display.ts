import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import type { JobType } from './queueTypes.ts';

export type JobNameLookups = {
  arrNameById?: Map<number, string>;
  databaseNameById?: Map<number, string>;
};

export function formatJobTypeLabel(jobType: JobType): string {
  const rawJobType: string = jobType;

  switch (jobType) {
    case 'arr.sync':
      return 'Arr Sync';
    case 'arr.sync.qualityProfiles':
      return 'Arr Sync (Quality Profiles)';
    case 'arr.sync.delayProfiles':
      return 'Arr Sync (Delay Profiles)';
    case 'arr.sync.mediaManagement':
      return 'Arr Sync (Media Management)';
    case 'arr.sync.metadataProfiles':
      return 'Arr Sync (Metadata Profiles)';
    case 'arr.pull.startup':
      return 'Startup Arr Pull';
    case 'arr.rename':
      return 'Arr Rename';
    case 'arr.upgrade':
      return 'Arr Upgrade';
    case 'pcd.sync':
      return 'PCD Sync';
    case 'backup.create':
      return 'Backup Create';
    case 'backup.cleanup':
      return 'Backup Cleanup';
    case 'logs.cleanup':
      return 'Logs Cleanup';
    case 'drift.check':
      return 'Drift Check';
    case 'sync.history.cleanup':
      return 'Sync History Cleanup';
    case 'config-health.snapshot':
      return 'Config Health Snapshot';
    case 'config-health.cleanup':
      return 'Config Health Cleanup';
    default:
      return rawJobType
        .replace(/\./g, ' ')
        .split('_')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
  }
}

function readId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return null;
}

function readIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const ids: number[] = [];
  for (const item of raw) {
    const id = readId(item);
    if (id !== null) {
      ids.push(id);
    }
  }

  return ids;
}

export function buildJobDisplayName(
  jobType: JobType,
  payload: Record<string, unknown>,
  lookups?: JobNameLookups
): string {
  const base = formatJobTypeLabel(jobType);
  const instanceId = readId(payload.instanceId);
  const databaseId = readId(payload.databaseId);

  if (jobType === 'pcd.sync' && databaseId !== null) {
    const name = lookups?.databaseNameById?.get(databaseId) ?? databaseInstancesQueries.getById(databaseId)?.name;
    return name ? `${base} - ${name}` : base;
  }

  if (jobType === 'arr.pull.startup') {
    const instanceIds = readIdList(payload.instanceIds);
    if (instanceIds.length === 1) {
      const startupInstanceName =
        lookups?.arrNameById?.get(instanceIds[0]) ??
        arrInstancesQueries.getById(instanceIds[0])?.name ??
        `${instanceIds[0]}`;
      return `${base} - ${startupInstanceName}`;
    }

    if (instanceIds.length > 1) {
      return `${base} - ${instanceIds.length} Instances`;
    }

    if (databaseId !== null) {
      const name =
        lookups?.databaseNameById?.get(databaseId) ??
        databaseInstancesQueries.getById(databaseId)?.name ??
        `${databaseId}`;
      return `${base} - ${name}`;
    }
  }

  const isArrSync = jobType === 'arr.sync' || jobType.startsWith('arr.sync.');
  if ((isArrSync || jobType === 'arr.rename' || jobType === 'arr.upgrade') && instanceId !== null) {
    const name = lookups?.arrNameById?.get(instanceId) ?? arrInstancesQueries.getById(instanceId)?.name;
    return name ? `${base} - ${name}` : base;
  }

  return base;
}
