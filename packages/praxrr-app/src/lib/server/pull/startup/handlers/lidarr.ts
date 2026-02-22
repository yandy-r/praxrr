import { logger } from '$logger/logger.ts';
import { pcdManager } from '$pcd/index.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type {
  ArrDelayProfile,
  RadarrQualityProfile,
  ArrMediaManagementConfig,
  ArrNamingConfig,
  ArrQualityDefinition,
  LidarrMetadataProfileListResponse,
} from '$arr/types.ts';
import {
  assertStartupArrType,
  createAdapterResultEnvelope,
  buildUnsupportedSectionResult,
  classifyStartupFetchError,
  getDelayProfileName,
  getStartupSectionSupportReason,
  incrementCounter,
  isStartupSectionSupported,
  type StartupAdapterResultEnvelope,
  incrementCountersFromMatchResult,
  sortStartupCandidates,
} from './shared.ts';
import { makeStartupMatchNoMatchResult } from '../matching.ts';
import { shouldSkipStartupDefault } from '../defaultFilters.ts';
import {
  buildRemoteNamingSnapshot,
  buildRemoteMediaSettingsSnapshot,
  buildRemoteQualityDefinitionsSnapshot,
  buildMatchRequestFromRemoteSnapshot,
  collectStartupMediaManagementCandidates,
  classifyMediaManagementMatch,
} from '../mediaManagement.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import * as delayProfileQueries from '$pcd/entities/delayProfiles/read.ts';
import {
  collectStartupMetadataProfileCandidates,
  buildRemoteMetadataProfileSnapshot,
  classifyMetadataProfileMatch,
} from './lidarrMetadata.ts';
import type {
  StartupPullArrType,
  StartupPullEntityDescriptor,
  StartupPullInstanceInput,
  StartupPullMatchRequest,
  StartupPullMatchResult,
  StartupPullSection,
} from '../types.ts';
import {
  buildDelayProfileFingerprintFromArr,
  buildDelayProfileFingerprintFromLocal,
  matchDelayProfileByFingerprint,
  matchManagedStartupProfileByNamespace,
  selectDefaultDelayProfileForStartup,
} from '../profileMatching.ts';

export type LidarrStartupFetchFailureKind = 'auth' | 'unreachable' | 'unknown';

export interface LidarrUnsupportedSection {
  readonly section: StartupPullSection;
  readonly reason: string;
}

export interface LidarrStartupRemoteSnapshot {
  readonly supportedSections: readonly StartupPullSection[];
  readonly unsupportedSections: readonly LidarrUnsupportedSection[];
  readonly resources: {
    readonly qualityProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly delayProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly naming: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly mediaSettings: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly qualityDefinitions: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly metadataProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
  };
}

export interface LidarrStartupFetchFailure {
  readonly success: false;
  readonly kind: LidarrStartupFetchFailureKind;
  readonly statusCode: number | null;
  readonly message: string;
}

export interface LidarrStartupFetchSuccess {
  readonly success: true;
  readonly snapshot: LidarrStartupRemoteSnapshot;
}

export type LidarrStartupFetchResult = LidarrStartupFetchSuccess | LidarrStartupFetchFailure;

export interface LidarrStartupCandidates {
  readonly qualityProfiles: readonly StartupPullEntityDescriptor[];
  readonly delayProfiles: readonly StartupPullEntityDescriptor[];
  readonly naming: readonly StartupPullEntityDescriptor[];
  readonly mediaSettings: readonly StartupPullEntityDescriptor[];
  readonly qualityDefinitions: readonly StartupPullEntityDescriptor[];
  readonly metadataProfiles: readonly StartupPullEntityDescriptor[];
}

export interface LidarrStartupMatchRunResult {
  readonly status: 'success' | 'failed';
  readonly failureKind: LidarrStartupFetchFailureKind | null;
  readonly envelope: StartupAdapterResultEnvelope;
  readonly matches: readonly StartupPullMatchResult[];
  readonly unsupportedSections: readonly LidarrUnsupportedSection[];
}

const LIDARR_SECTIONS: readonly StartupPullSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'naming',
  'mediaSettings',
  'qualityDefinitions',
  'metadataProfiles',
] as const;

interface LidarrStartupClient extends BaseArrClient {
  getQualityProfiles(): Promise<RadarrQualityProfile[]>;
  getDelayProfiles(): Promise<ArrDelayProfile[]>;
  getNamingConfig(): Promise<ArrNamingConfig>;
  getMediaManagementConfig(): Promise<ArrMediaManagementConfig>;
  getQualityDefinitions(): Promise<ArrQualityDefinition[]>;
  getMetadataProfiles(): Promise<LidarrMetadataProfileListResponse>;
}

function isLidarrStartupClient(client: BaseArrClient): client is LidarrStartupClient {
  return 'getMetadataProfiles' in client && typeof client.getMetadataProfiles === 'function';
}

function sortDescriptorSnapshots(
  items: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[]
): Omit<StartupPullEntityDescriptor, 'databaseId'>[] {
  return [...items].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) {
      return byName;
    }

    return String(left.id).localeCompare(String(right.id));
  });
}

function classifyLidarrManagedProfileMatch(input: StartupPullMatchRequest): StartupPullMatchResult {
  const skipDefault = shouldSkipStartupDefault(input.arrType, input.section, input.remote);
  if (skipDefault.skip) {
    return makeStartupMatchNoMatchResult(input, 'default_skip', {
      hasFingerprintAttempt: input.remote.fingerprint !== null,
    });
  }

  const result = matchManagedStartupProfileByNamespace(input);

  if (result.status !== 'matched') {
    return result;
  }

  const matchedCandidate = input.candidates.find((candidate) => candidate.id === result.matchedEntityId);
  if (!matchedCandidate) {
    return result;
  }

  return {
    ...result,
    databaseId: matchedCandidate.databaseId,
    matchedEntityId: matchedCandidate.id,
    matchedEntityName: matchedCandidate.name,
  };
}

function classifyLidarrDelayProfileMatch(input: StartupPullMatchRequest): StartupPullMatchResult {
  const result = matchDelayProfileByFingerprint(input);

  if (result.status !== 'matched') {
    return result;
  }

  const matchedCandidate = input.candidates.find((candidate) => candidate.id === result.matchedEntityId);
  if (!matchedCandidate) {
    return result;
  }

  return {
    ...result,
    databaseId: matchedCandidate.databaseId,
    matchedEntityId: matchedCandidate.id,
    matchedEntityName: matchedCandidate.name,
  };
}

export async function collectRemoteSectionSnapshots(client: BaseArrClient): Promise<LidarrStartupFetchResult> {
  if (!isLidarrStartupClient(client)) {
    throw new Error('Cannot collect Lidarr startup snapshots: client is not a Lidarr client');
  }

  const lidarrClient = client;
  const unsupportedSections: LidarrUnsupportedSection[] = [];
  const supportedSections: StartupPullSection[] = [];

  for (const section of LIDARR_SECTIONS) {
    const reason = getStartupSectionSupportReason('lidarr', section);
    if (reason === null) {
      supportedSections.push(section);
      continue;
    }

    unsupportedSections.push({ section, reason });
  }

  try {
    const [qualityProfiles, delayProfiles, naming, mediaSettings, qualityDefinitions, metadataProfiles] =
      await Promise.all([
        isStartupSectionSupported('lidarr', 'qualityProfiles')
          ? lidarrClient.getQualityProfiles()
          : Promise.resolve([] as const),
        isStartupSectionSupported('lidarr', 'delayProfiles')
          ? lidarrClient.getDelayProfiles()
          : Promise.resolve([] as const),
        isStartupSectionSupported('lidarr', 'naming')
          ? lidarrClient.getNamingConfig()
          : Promise.resolve(null as ArrNamingConfig | null),
        isStartupSectionSupported('lidarr', 'mediaSettings')
          ? lidarrClient.getMediaManagementConfig()
          : Promise.resolve(null as ArrMediaManagementConfig | null),
        isStartupSectionSupported('lidarr', 'qualityDefinitions')
          ? lidarrClient.getQualityDefinitions()
          : Promise.resolve([] as const),
        isStartupSectionSupported('lidarr', 'metadataProfiles')
          ? lidarrClient.getMetadataProfiles()
          : Promise.resolve([] as const),
      ]);

    const remoteQualityProfiles = sortDescriptorSnapshots(
      qualityProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        section: 'qualityProfiles',
        arrType: 'lidarr',
        databaseId: -1,
        fingerprint: null,
      }))
    );

    const remoteDelayProfiles = sortDescriptorSnapshots(
      (() => {
        const defaultDelayProfile = selectDefaultDelayProfileForStartup('lidarr', delayProfiles);
        if (!defaultDelayProfile) {
          return [];
        }

        return [
          {
            id: defaultDelayProfile.id,
            name: getDelayProfileName(defaultDelayProfile),
            section: 'delayProfiles' as const,
            arrType: 'lidarr' as const,
            databaseId: -1,
            fingerprint: buildDelayProfileFingerprintFromArr(defaultDelayProfile),
          },
        ];
      })()
    );

    const remoteMetadataProfiles = sortDescriptorSnapshots(
      metadataProfiles.map((profile) => buildRemoteMetadataProfileSnapshot(profile))
    );

    const resources = {
      qualityProfiles: remoteQualityProfiles,
      delayProfiles: remoteDelayProfiles,
      naming: naming ? sortDescriptorSnapshots([buildRemoteNamingSnapshot('lidarr', naming)]) : [],
      mediaSettings: mediaSettings
        ? sortDescriptorSnapshots([buildRemoteMediaSettingsSnapshot(mediaSettings, 'lidarr')])
        : [],
      qualityDefinitions: qualityDefinitions
        ? sortDescriptorSnapshots([buildRemoteQualityDefinitionsSnapshot(qualityDefinitions, 'lidarr')])
        : [],
      metadataProfiles: remoteMetadataProfiles,
    };

    return {
      success: true,
      snapshot: {
        supportedSections,
        unsupportedSections,
        resources,
      },
    };
  } catch (error) {
    await logger.errorWithTrace(
      'Failed to collect Lidarr startup snapshots',
      error instanceof Error ? error : undefined,
      {
        source: 'StartupPull',
        meta: {
          arrType: 'lidarr',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      }
    );
    return classifyStartupFetchError('Lidarr', error);
  }
}

export async function collectLidarrStartupCandidates(databaseIds: readonly number[]): Promise<LidarrStartupCandidates> {
  const qualityProfiles: StartupPullEntityDescriptor[] = [];
  const delayProfiles: StartupPullEntityDescriptor[] = [];
  const naming: StartupPullEntityDescriptor[] = [];
  const mediaSettings: StartupPullEntityDescriptor[] = [];
  const qualityDefinitions: StartupPullEntityDescriptor[] = [];
  const metadataProfiles: StartupPullEntityDescriptor[] = [];

  for (const databaseId of databaseIds) {
    const cache = pcdManager.getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}, skipping`, {
        source: 'StartupPull',
        meta: {
          arrType: 'lidarr',
          databaseId,
        },
      });
      continue;
    }

    const [qualityProfileRows, delayProfileRows, mediaManagementCandidates, metadataProfileCandidates] =
      await Promise.all([
        qualityProfileQueries.list(cache, 'lidarr'),
        delayProfileQueries.list(cache),
        collectStartupMediaManagementCandidates(cache, databaseId, 'lidarr'),
        collectStartupMetadataProfileCandidates(cache, databaseId),
      ]);

    for (const row of qualityProfileRows) {
      qualityProfiles.push({
        id: row.id,
        name: row.name,
        section: 'qualityProfiles',
        arrType: 'lidarr',
        databaseId,
      });
    }

    for (const row of delayProfileRows) {
      delayProfiles.push({
        id: row.id,
        name: row.name,
        section: 'delayProfiles',
        arrType: 'lidarr',
        databaseId,
        fingerprint: buildDelayProfileFingerprintFromLocal(row),
      });
    }

    naming.push(...mediaManagementCandidates.naming);
    mediaSettings.push(...mediaManagementCandidates.mediaSettings);
    qualityDefinitions.push(...mediaManagementCandidates.qualityDefinitions);
    metadataProfiles.push(...metadataProfileCandidates);
  }

  return {
    qualityProfiles: sortStartupCandidates(qualityProfiles),
    delayProfiles: sortStartupCandidates(delayProfiles),
    naming: sortStartupCandidates(naming),
    mediaSettings: sortStartupCandidates(mediaSettings),
    qualityDefinitions: sortStartupCandidates(qualityDefinitions),
    metadataProfiles: sortStartupCandidates(metadataProfiles),
  };
}

export function matchLidarrStartupResources(
  input: StartupPullInstanceInput,
  snapshot: LidarrStartupRemoteSnapshot,
  candidates: LidarrStartupCandidates
): LidarrStartupMatchRunResult {
  const arrType = assertStartupArrType(input.arrType, 'lidarr', 'Cannot process non-Lidarr instance in Lidarr adapter');
  const envelope = createAdapterResultEnvelope('skipped');
  const matches: StartupPullMatchResult[] = [];
  const fallbackDatabaseId = input.databaseIds[0];
  if (fallbackDatabaseId === undefined) {
    throw new Error('Cannot match startup resources with no database IDs');
  }

  for (const unsupportedSection of snapshot.unsupportedSections) {
    const result = buildUnsupportedSectionResult(input.instanceId, fallbackDatabaseId, unsupportedSection, 'lidarr');
    matches.push(result);
    incrementCountersFromMatchResult(envelope, result);
  }

  for (const section of snapshot.supportedSections) {
    if (section === 'qualityProfiles') {
      for (const remoteProfile of snapshot.resources.qualityProfiles) {
        const remoteSectionProfile = {
          ...remoteProfile,
          databaseId: fallbackDatabaseId,
        };
        const result = classifyLidarrManagedProfileMatch({
          instanceId: input.instanceId,
          databaseId: fallbackDatabaseId,
          section,
          arrType,
          remote: remoteSectionProfile,
          candidates: candidates.qualityProfiles,
        });
        matches.push(result);
        incrementCountersFromMatchResult(envelope, result);
      }
      continue;
    }

    if (section === 'delayProfiles') {
      for (const remoteProfile of snapshot.resources.delayProfiles) {
        const remoteSectionProfile = {
          ...remoteProfile,
          databaseId: fallbackDatabaseId,
        };
        const result = classifyLidarrDelayProfileMatch({
          instanceId: input.instanceId,
          databaseId: fallbackDatabaseId,
          section,
          arrType,
          remote: remoteSectionProfile,
          candidates: candidates.delayProfiles,
        });
        matches.push(result);
        incrementCountersFromMatchResult(envelope, result);
      }
      continue;
    }

    if (section === 'naming') {
      for (const remoteProfile of snapshot.resources.naming) {
        const result = classifyMediaManagementMatch(
          buildMatchRequestFromRemoteSnapshot(
            input.instanceId,
            fallbackDatabaseId,
            'naming',
            arrType,
            remoteProfile,
            candidates.naming
          )
        );
        matches.push(result);
        incrementCountersFromMatchResult(envelope, result);
      }
      continue;
    }

    if (section === 'mediaSettings') {
      for (const remoteProfile of snapshot.resources.mediaSettings) {
        const result = classifyMediaManagementMatch(
          buildMatchRequestFromRemoteSnapshot(
            input.instanceId,
            fallbackDatabaseId,
            'mediaSettings',
            arrType,
            remoteProfile,
            candidates.mediaSettings
          )
        );
        matches.push(result);
        incrementCountersFromMatchResult(envelope, result);
      }
      continue;
    }

    if (section === 'qualityDefinitions') {
      for (const remoteProfile of snapshot.resources.qualityDefinitions) {
        const result = classifyMediaManagementMatch(
          buildMatchRequestFromRemoteSnapshot(
            input.instanceId,
            fallbackDatabaseId,
            'qualityDefinitions',
            arrType,
            remoteProfile,
            candidates.qualityDefinitions
          )
        );
        matches.push(result);
        incrementCountersFromMatchResult(envelope, result);
      }
      continue;
    }

    if (section === 'metadataProfiles') {
      for (const remoteProfile of snapshot.resources.metadataProfiles) {
        const remoteMetadataProfile = {
          ...remoteProfile,
          databaseId: fallbackDatabaseId,
        };
        const result = classifyMetadataProfileMatch({
          instanceId: input.instanceId,
          databaseId: fallbackDatabaseId,
          section,
          arrType,
          remote: remoteMetadataProfile,
          candidates: candidates.metadataProfiles,
        });
        matches.push(result);
        incrementCountersFromMatchResult(envelope, result);
      }
      continue;
    }
  }

  envelope.status = matches.length === 0 ? 'skipped' : envelope.counters.failed > 0 ? 'failure' : 'success';

  return {
    status: envelope.status === 'failure' ? 'failed' : 'success',
    failureKind: null,
    envelope,
    matches,
    unsupportedSections: snapshot.unsupportedSections,
  };
}

export async function runLidarrStartupAdapter(
  input: StartupPullInstanceInput,
  client: BaseArrClient
): Promise<LidarrStartupMatchRunResult> {
  assertStartupArrType(input.arrType, 'lidarr', 'Cannot run non-Lidarr adapter');
  if (input.databaseIds.length === 0) {
    throw new Error('Cannot match startup resources with no database IDs');
  }

  const fetchResult = await collectRemoteSectionSnapshots(client);

  if (!fetchResult.success) {
    const envelope = createAdapterResultEnvelope('failure');
    incrementCounter(envelope, 'failed');
    envelope.error = `${fetchResult.message} (${fetchResult.kind})`;

    return {
      status: 'failed',
      failureKind: fetchResult.kind,
      envelope,
      matches: [],
      unsupportedSections: [],
    };
  }

  const candidates = await collectLidarrStartupCandidates(input.databaseIds);
  return matchLidarrStartupResources(input, fetchResult.snapshot, candidates);
}

export const lidarrStartupAdapter = {
  arrType: 'lidarr' as const,
  fetch: collectRemoteSectionSnapshots,
  collectCandidates: collectLidarrStartupCandidates,
  match: matchLidarrStartupResources,
  run: runLidarrStartupAdapter,
} as const;
