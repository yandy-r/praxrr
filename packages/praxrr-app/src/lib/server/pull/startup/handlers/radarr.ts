import { logger } from '$logger/logger.ts';
import type { BaseArrClient } from '$arr/base.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import * as delayProfileQueries from '$pcd/entities/delayProfiles/read.ts';
import { pcdManager } from '$pcd/index.ts';
import {
  assertStartupArrType,
  createAdapterResultEnvelope,
  buildUnsupportedSectionResult,
  classifyStartupFetchError,
  getDelayProfileName,
  getStartupSectionSupportReason,
  incrementCountersFromMatchResult,
  incrementCounter,
  type StartupAdapterResultEnvelope,
  sortStartupCandidates,
} from './shared.ts';
import {
  type StartupPullArrType,
  type StartupPullEntityDescriptor,
  type StartupPullInstanceInput,
  type StartupPullMatchResult,
  type StartupPullSection,
} from '../types.ts';
import {
  buildMatchRequestFromRemoteSnapshot,
  buildRemoteMediaSettingsSnapshot,
  buildRemoteNamingSnapshot,
  buildRemoteQualityDefinitionsSnapshot,
  classifyMediaManagementMatch,
  collectStartupMediaManagementCandidates,
} from '../mediaManagement.ts';
import { makeStartupMatchNoMatchResult } from '../matching.ts';
import { shouldSkipStartupDefault } from '../defaultFilters.ts';
import {
  buildDelayProfileFingerprintFromArr,
  buildDelayProfileFingerprintFromLocal,
  matchDelayProfileByFingerprint,
  matchManagedStartupProfileByNamespace,
  selectDefaultDelayProfileForStartup,
} from '../profileMatching.ts';

export type RadarrStartupFetchFailureKind = 'auth' | 'unreachable' | 'unknown';

export interface RadarrUnsupportedSection {
  readonly section: StartupPullSection;
  readonly reason: string;
}

export interface RadarrStartupRemoteSnapshot {
  readonly supportedSections: readonly StartupPullSection[];
  readonly unsupportedSections: readonly RadarrUnsupportedSection[];
  readonly resources: {
    readonly qualityProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly delayProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly naming: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly mediaSettings: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly qualityDefinitions: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    readonly metadataProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
  };
}

export interface RadarrStartupFetchFailure {
  readonly success: false;
  readonly kind: RadarrStartupFetchFailureKind;
  readonly statusCode: number | null;
  readonly message: string;
}

export interface RadarrStartupFetchSuccess {
  readonly success: true;
  readonly snapshot: RadarrStartupRemoteSnapshot;
}

export type RadarrStartupFetchResult = RadarrStartupFetchSuccess | RadarrStartupFetchFailure;

export interface RadarrStartupCandidates {
  readonly qualityProfiles: readonly StartupPullEntityDescriptor[];
  readonly delayProfiles: readonly StartupPullEntityDescriptor[];
  readonly naming: readonly StartupPullEntityDescriptor[];
  readonly mediaSettings: readonly StartupPullEntityDescriptor[];
  readonly qualityDefinitions: readonly StartupPullEntityDescriptor[];
  readonly metadataProfiles: readonly StartupPullEntityDescriptor[];
}

export interface RadarrStartupMatchRunResult {
  readonly status: 'success' | 'failed';
  readonly failureKind: RadarrStartupFetchFailureKind | null;
  readonly envelope: StartupAdapterResultEnvelope;
  readonly matches: readonly StartupPullMatchResult[];
  readonly unsupportedSections: readonly RadarrUnsupportedSection[];
}

const RADARR_SECTIONS: readonly StartupPullSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'metadataProfiles',
  'naming',
  'mediaSettings',
  'qualityDefinitions',
] as const;

function toSectionSnapshot(
  values: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[]
): readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[] {
  return [...values].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) {
      return byName;
    }

    return String(left.id).localeCompare(String(right.id));
  });
}

function matchManagedQualityProfiles(
  instanceId: number,
  databaseId: number,
  section: Extract<StartupPullSection, 'qualityProfiles'>,
  arrType: StartupPullArrType,
  remote: Omit<StartupPullEntityDescriptor, 'databaseId'>,
  candidates: readonly StartupPullEntityDescriptor[]
): StartupPullMatchResult {
  const request = {
    instanceId,
    databaseId,
    section,
    arrType,
    remote: {
      ...remote,
      databaseId,
    },
    candidates,
  };

  const skip = shouldSkipStartupDefault(request.arrType, request.section, request.remote);
  if (skip.skip) {
    return makeStartupMatchNoMatchResult(request, 'default_skip', {
      hasFingerprintAttempt: request.remote.fingerprint !== null,
    });
  }

  const result = matchManagedStartupProfileByNamespace(request);
  if (result.status !== 'matched') {
    return result;
  }

  const matchedCandidate = candidates.find((candidate) => candidate.id === result.matchedEntityId);
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

function matchDelayProfileFromDefaultSnapshot(
  instanceId: number,
  databaseId: number,
  arrType: StartupPullArrType,
  remote: Omit<StartupPullEntityDescriptor, 'databaseId'>,
  candidates: readonly StartupPullEntityDescriptor[]
): StartupPullMatchResult {
  const request = {
    instanceId,
    databaseId,
    section: 'delayProfiles' as const,
    arrType,
    remote: {
      ...remote,
      databaseId,
    },
    candidates,
  };

  const result = matchDelayProfileByFingerprint(request);
  if (result.status !== 'matched') {
    return result;
  }

  const matchedCandidate = candidates.find((candidate) => candidate.id === result.matchedEntityId);
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

export async function collectRemoteSectionSnapshots(client: BaseArrClient): Promise<RadarrStartupFetchResult> {
  const unsupportedSections: RadarrUnsupportedSection[] = [];
  const supportedSections: StartupPullSection[] = [];
  const supportLookup = new Map<StartupPullSection, string | null>();

  for (const section of RADARR_SECTIONS) {
    const reason = getStartupSectionSupportReason('radarr', section);
    supportLookup.set(section, reason);
    if (reason === null) {
      supportedSections.push(section);
      continue;
    }

    unsupportedSections.push({
      section,
      reason,
    });
  }

  try {
    const [qualityProfiles, delayProfiles, naming, mediaManagement, qualityDefinitions] = await Promise.all([
      supportLookup.get('qualityProfiles') === null
        ? client.getQualityProfiles()
        : Promise.resolve([] as Awaited<ReturnType<typeof client.getQualityProfiles>>),
      supportLookup.get('delayProfiles') === null
        ? client.getDelayProfiles()
        : Promise.resolve([] as Awaited<ReturnType<typeof client.getDelayProfiles>>),
      supportLookup.get('naming') === null
        ? client.getNamingConfig()
        : Promise.resolve(null as unknown as Awaited<ReturnType<typeof client.getNamingConfig>>),
      supportLookup.get('mediaSettings') === null
        ? client.getMediaManagementConfig()
        : Promise.resolve(null as unknown as Awaited<ReturnType<typeof client.getMediaManagementConfig>>),
      supportLookup.get('qualityDefinitions') === null
        ? client.getQualityDefinitions()
        : Promise.resolve([] as Awaited<ReturnType<typeof client.getQualityDefinitions>>),
    ]);

    const defaultDelayProfile = selectDefaultDelayProfileForStartup('radarr', delayProfiles);

    const resources: RadarrStartupRemoteSnapshot['resources'] = {
      qualityProfiles: toSectionSnapshot(
        qualityProfiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          section: 'qualityProfiles',
          arrType: 'radarr',
        }))
      ),
      delayProfiles: defaultDelayProfile
        ? toSectionSnapshot([
            {
              id: defaultDelayProfile.id,
              name: getDelayProfileName(defaultDelayProfile),
              section: 'delayProfiles',
              arrType: 'radarr',
              fingerprint: buildDelayProfileFingerprintFromArr(defaultDelayProfile),
            },
          ])
        : [],
      naming: naming ? toSectionSnapshot([buildRemoteNamingSnapshot('radarr', naming)]) : [],
      mediaSettings: mediaManagement
        ? toSectionSnapshot([buildRemoteMediaSettingsSnapshot(mediaManagement, 'radarr')])
        : [],
      qualityDefinitions: qualityDefinitions
        ? toSectionSnapshot([buildRemoteQualityDefinitionsSnapshot(qualityDefinitions, 'radarr')])
        : [],
      metadataProfiles: [],
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
      'Failed to collect Radarr startup snapshots',
      error instanceof Error ? error : undefined,
      {
        source: 'StartupPull',
        meta: {
          arrType: 'radarr',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      }
    );
    return classifyStartupFetchError('Radarr', error, {
      programmingErrorLabel: 'programming error',
      unknownErrorMessage: 'Radarr startup adapter fetch failed due to an unknown error.',
    });
  }
}

export async function collectRadarrStartupCandidates(databaseIds: readonly number[]): Promise<RadarrStartupCandidates> {
  const qualityProfiles: StartupPullEntityDescriptor[] = [];
  const delayProfiles: StartupPullEntityDescriptor[] = [];
  const naming: StartupPullEntityDescriptor[] = [];
  const mediaSettings: StartupPullEntityDescriptor[] = [];
  const qualityDefinitions: StartupPullEntityDescriptor[] = [];

  for (const databaseId of databaseIds) {
    const cache = pcdManager.getCache(databaseId);
    if (!cache) {
      await logger.warn(`PCD cache not found for database ${databaseId}, skipping`, {
        source: 'StartupPull',
        meta: {
          arrType: 'radarr',
          databaseId,
        },
      });
      continue;
    }

    const [qualityRows, delayRows, mediaManagementCandidates] = await Promise.all([
      qualityProfileQueries.list(cache, 'radarr'),
      delayProfileQueries.list(cache),
      collectStartupMediaManagementCandidates(cache, databaseId, 'radarr'),
    ]);

    for (const profile of qualityRows) {
      qualityProfiles.push({
        id: profile.id,
        name: profile.name,
        section: 'qualityProfiles',
        arrType: 'radarr',
        databaseId,
      });
    }

    for (const profile of delayRows) {
      delayProfiles.push({
        id: profile.id,
        name: profile.name,
        section: 'delayProfiles',
        arrType: 'radarr',
        databaseId,
        fingerprint: buildDelayProfileFingerprintFromLocal(profile),
      });
    }

    naming.push(...mediaManagementCandidates.naming);
    mediaSettings.push(...mediaManagementCandidates.mediaSettings);
    qualityDefinitions.push(...mediaManagementCandidates.qualityDefinitions);
  }

  return {
    qualityProfiles: sortStartupCandidates(qualityProfiles),
    delayProfiles: sortStartupCandidates(delayProfiles),
    naming: sortStartupCandidates(naming),
    mediaSettings: sortStartupCandidates(mediaSettings),
    qualityDefinitions: sortStartupCandidates(qualityDefinitions),
    metadataProfiles: [],
  };
}

export function matchRadarrStartupResources(
  input: StartupPullInstanceInput,
  snapshot: RadarrStartupRemoteSnapshot,
  candidates: RadarrStartupCandidates
): RadarrStartupMatchRunResult {
  const arrType = assertStartupArrType(input.arrType, 'radarr', 'Cannot process non-Radarr instance in radarr adapter');
  const envelope = createAdapterResultEnvelope('skipped');
  const matches: StartupPullMatchResult[] = [];
  const fallbackDatabaseId = input.databaseIds[0];
  if (fallbackDatabaseId === undefined) {
    throw new Error('Cannot match startup resources with no database IDs');
  }

  for (const unsupported of snapshot.unsupportedSections) {
    const result = buildUnsupportedSectionResult(input.instanceId, fallbackDatabaseId, unsupported, 'radarr');
    matches.push(result);
    incrementCountersFromMatchResult(envelope, result);
  }

  for (const section of snapshot.supportedSections) {
    if (section === 'qualityProfiles') {
      for (const remoteProfile of snapshot.resources.qualityProfiles) {
        const result = matchManagedQualityProfiles(
          input.instanceId,
          fallbackDatabaseId,
          'qualityProfiles',
          arrType,
          remoteProfile,
          candidates.qualityProfiles
        );
        matches.push(result);
        incrementCountersFromMatchResult(envelope, result);
      }

      continue;
    }

    if (section === 'delayProfiles') {
      for (const remoteProfile of snapshot.resources.delayProfiles) {
        const result = matchDelayProfileFromDefaultSnapshot(
          input.instanceId,
          fallbackDatabaseId,
          arrType,
          remoteProfile,
          candidates.delayProfiles
        );
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

export async function runRadarrStartupAdapter(
  input: StartupPullInstanceInput,
  client: BaseArrClient
): Promise<RadarrStartupMatchRunResult> {
  assertStartupArrType(input.arrType, 'radarr', 'Cannot run non-Radarr adapter');
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

  const candidates = await collectRadarrStartupCandidates(input.databaseIds);
  return matchRadarrStartupResources(input, fetchResult.snapshot, candidates);
}

export const radarrStartupAdapter = {
  arrType: 'radarr' as const,
  fetch: collectRemoteSectionSnapshots,
  collectCandidates: collectRadarrStartupCandidates,
  match: matchRadarrStartupResources,
  run: runRadarrStartupAdapter,
};
