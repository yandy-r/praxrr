import { HttpError } from '$http/types.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrDelayProfile } from '$arr/types.ts';
import * as qualityProfileQueries from '$pcd/entities/qualityProfiles/index.ts';
import * as delayProfileQueries from '$pcd/entities/delayProfiles/index.ts';
import { pcdManager } from '$pcd/index.ts';
import {
  createAdapterResultEnvelope,
  incrementCounter,
  assertStartupArrType,
  getStartupSectionSupportReason,
  isStartupSectionSupported,
  type StartupAdapterResultEnvelope,
} from './shared.ts';
import {
  type StartupPullArrType,
  type StartupPullEntityDescriptor,
  type StartupPullInstanceInput,
  type StartupPullMatchResult,
  type StartupPullSection,
} from '../types.ts';
import {
  buildRemoteMediaSettingsSnapshot,
  buildRemoteNamingSnapshot,
  buildRemoteQualityDefinitionsSnapshot,
  buildMatchRequestFromRemoteSnapshot,
  classifyMediaManagementMatch,
  collectStartupMediaManagementCandidates,
} from '../mediaManagement.ts';
import {
  makeStartupMatchNoMatchResult,
} from '../matching.ts';
import { shouldSkipStartupDefault } from '../defaultFilters.ts';
import {
	buildDelayProfileFingerprintFromArr,
	buildDelayProfileFingerprintFromLocal,
	matchDelayProfileByFingerprint,
	matchManagedStartupProfileByNamespace,
	selectDefaultDelayProfileForStartup,
} from '../profileMatching.ts';

export type SonarrStartupFetchFailureKind = 'auth' | 'unreachable' | 'unknown';

export interface SonarrUnsupportedSection {
  readonly section: StartupPullSection;
  readonly reason: string;
}

export interface SonarrStartupRemoteSnapshot {
  readonly supportedSections: readonly StartupPullSection[];
  readonly unsupportedSections: readonly SonarrUnsupportedSection[];
  readonly resources: {
    qualityProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    delayProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    naming: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    mediaSettings: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    qualityDefinitions: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
    metadataProfiles: readonly Omit<StartupPullEntityDescriptor, 'databaseId'>[];
  };
}

export interface SonarrStartupFetchFailure {
  readonly success: false;
  readonly kind: SonarrStartupFetchFailureKind;
  readonly statusCode: number | null;
  readonly message: string;
}

export interface SonarrStartupFetchSuccess {
  readonly success: true;
  readonly snapshot: SonarrStartupRemoteSnapshot;
}

export type SonarrStartupFetchResult = SonarrStartupFetchSuccess | SonarrStartupFetchFailure;

export interface SonarrStartupCandidates {
  readonly qualityProfiles: readonly StartupPullEntityDescriptor[];
  readonly delayProfiles: readonly StartupPullEntityDescriptor[];
  readonly naming: readonly StartupPullEntityDescriptor[];
  readonly mediaSettings: readonly StartupPullEntityDescriptor[];
  readonly qualityDefinitions: readonly StartupPullEntityDescriptor[];
  readonly metadataProfiles: readonly StartupPullEntityDescriptor[];
}

export interface SonarrStartupMatchRunResult {
  readonly status: 'success' | 'failed';
  readonly failureKind: SonarrStartupFetchFailureKind | null;
  readonly envelope: StartupAdapterResultEnvelope;
  readonly matches: readonly StartupPullMatchResult[];
  readonly unsupportedSections: readonly SonarrUnsupportedSection[];
}

const SONARR_SECTIONS: readonly StartupPullSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'metadataProfiles',
  'naming',
  'mediaSettings',
  'qualityDefinitions',
] as const;

const SONARR_STARTUP_ERROR_MESSAGE_PREFIX = 'Sonarr startup adapter fetch failed';

function classifySonarrFetchError(error: unknown): SonarrStartupFetchFailure {
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return {
        success: false,
        kind: 'auth',
        statusCode: error.status,
        message: `${SONARR_STARTUP_ERROR_MESSAGE_PREFIX}: authentication rejected by Sonarr (HTTP ${error.status}).`,
      };
    }

    if (
      error.status === 0 ||
      error.status === 408 ||
      error.status === 500 ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504
    ) {
      return {
        success: false,
        kind: 'unreachable',
        statusCode: error.status,
        message: `${SONARR_STARTUP_ERROR_MESSAGE_PREFIX}: unable to reach Sonarr API (HTTP ${error.status}).`,
      };
    }

    return {
      success: false,
      kind: 'unknown',
      statusCode: error.status,
      message: `${SONARR_STARTUP_ERROR_MESSAGE_PREFIX}: Sonarr API returned HTTP ${error.status}.`,
    };
  }

  if (error instanceof Error) {
    return {
      success: false,
      kind: 'unreachable',
      statusCode: null,
      message: `${SONARR_STARTUP_ERROR_MESSAGE_PREFIX}: ${error.message}`,
    };
  }

  return {
    success: false,
    kind: 'unknown',
    statusCode: null,
    message: `${SONARR_STARTUP_ERROR_MESSAGE_PREFIX}.`,
  };
}

function toSectionSnapshot<T>(
  values: readonly T[],
  selector: (value: T) => StartupPullEntityDescriptor
): Omit<StartupPullEntityDescriptor, 'databaseId'>[] {
  return values
    .map((value) => selector(value))
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      if (byName !== 0) {
        return byName;
      }
      return String(left.id).localeCompare(String(right.id));
    });
}

function getDelayProfileName(profile: ArrDelayProfile): string {
	const rawName = (profile as { name?: unknown }).name;
	if (typeof rawName === 'string' && rawName.length > 0) {
		return rawName;
	}

	return `Delay Profile ${profile.id}`;
}

function sortStartupCandidates(items: readonly StartupPullEntityDescriptor[]): StartupPullEntityDescriptor[] {
  return [...items].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;

    const byDatabase = left.databaseId - right.databaseId;
    if (byDatabase !== 0) return byDatabase;

    return String(left.id).localeCompare(String(right.id));
  });
}

function incrementCountersFromMatchResult(
  envelope: StartupAdapterResultEnvelope,
  result: StartupPullMatchResult
): void {
  if (result.status === 'matched') {
    incrementCounter(envelope, 'imported');
    return;
  }

  if (result.status === 'conflicted') {
    incrementCounter(envelope, 'conflicted');
    return;
  }

  if (result.status === 'no_match' && result.reason === 'default_skip') {
    incrementCounter(envelope, 'skipped_default');
    return;
  }

  incrementCounter(envelope, 'skipped_no_match');
}

function buildUnsupportedSectionResult(
  instanceId: number,
  databaseId: number,
  reason: SonarrUnsupportedSection
): StartupPullMatchResult {
  return {
    ...makeStartupMatchNoMatchResult(
      {
        instanceId,
        databaseId,
        section: reason.section,
        arrType: 'sonarr',
        remote: {
          id: `unsupported:${reason.section}`,
          name: reason.section,
          section: reason.section,
          arrType: 'sonarr',
          databaseId,
        },
        candidates: [],
      },
      'unsupported_section',
      {
        hasFingerprintAttempt: false,
      }
    ),
    reason: 'unsupported_section',
  };
}

function buildSectionMatchRequest(
  instanceId: number,
  databaseId: number,
  section: Extract<StartupPullSection, 'qualityProfiles' | 'delayProfiles'>,
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

  if (section === 'qualityProfiles') {
		const skip = shouldSkipStartupDefault(request.arrType, request.section, request.remote);
		if (skip.skip) {
			return makeStartupMatchNoMatchResult(request, 'default_skip', {
				hasFingerprintAttempt: remote.fingerprint !== null,
			});
		}
	}

	const result =
		section === 'qualityProfiles'
			? matchManagedStartupProfileByNamespace(request)
			: matchDelayProfileByFingerprint(request);

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

function promiseIfSupported<T>(section: StartupPullSection, producer: () => Promise<T>): Promise<T> {
  if (!isStartupSectionSupported('sonarr', section)) {
    throw new Error(`Unsupported section requested for Sonarr: ${section}`);
  }

  return producer();
}

export async function collectRemoteSectionSnapshots(client: BaseArrClient): Promise<SonarrStartupFetchResult> {
  const unsupported: SonarrUnsupportedSection[] = [];
  const supported: StartupPullSection[] = [];

  for (const section of SONARR_SECTIONS) {
    const reason = getStartupSectionSupportReason('sonarr', section);
    if (reason === null) {
      supported.push(section);
      continue;
    }

    unsupported.push({ section, reason });
  }

  try {
    const [qualityProfiles, delayProfiles, naming, mediaManagement, qualityDefinitions] =
      await Promise.all([
        getStartupSectionSupportReason('sonarr', 'qualityProfiles') === null
          ? promiseIfSupported('qualityProfiles', () => client.getQualityProfiles())
          : Promise.resolve([] as const),
        getStartupSectionSupportReason('sonarr', 'delayProfiles') === null
          ? promiseIfSupported('delayProfiles', () => client.getDelayProfiles())
          : Promise.resolve([] as const),
        getStartupSectionSupportReason('sonarr', 'naming') === null
          ? promiseIfSupported('naming', () => client.getNamingConfig())
          : Promise.resolve(null as unknown as ReturnType<typeof client.getNamingConfig>),
        getStartupSectionSupportReason('sonarr', 'mediaSettings') === null
          ? promiseIfSupported('mediaSettings', () => client.getMediaManagementConfig())
          : Promise.resolve(null as unknown as ReturnType<typeof client.getMediaManagementConfig>),
        getStartupSectionSupportReason('sonarr', 'qualityDefinitions') === null
          ? promiseIfSupported('qualityDefinitions', () => client.getQualityDefinitions())
          : Promise.resolve([] as const),
      ]);

    const defaultDelayProfile = selectDefaultDelayProfileForStartup('sonarr', delayProfiles);

    const resources: SonarrStartupRemoteSnapshot['resources'] = {
      qualityProfiles: toSectionSnapshot(qualityProfiles, (remoteProfile) => ({
        id: remoteProfile.id,
        name: remoteProfile.name,
        section: 'qualityProfiles',
        arrType: 'sonarr',
        databaseId: -1,
      })),
      delayProfiles: defaultDelayProfile
        ? toSectionSnapshot([defaultDelayProfile], (remoteProfile) => ({
            id: remoteProfile.id,
            name: getDelayProfileName(remoteProfile),
            section: 'delayProfiles',
            arrType: 'sonarr',
            databaseId: -1,
            fingerprint: buildDelayProfileFingerprintFromArr(remoteProfile),
          }))
        : [],
      naming: naming ? [buildRemoteNamingSnapshot('sonarr', naming)] : [],
      mediaSettings: mediaManagement ? [buildRemoteMediaSettingsSnapshot(mediaManagement, 'sonarr')] : [],
      qualityDefinitions: qualityDefinitions
        ? [buildRemoteQualityDefinitionsSnapshot(qualityDefinitions, 'sonarr')]
        : [],
      metadataProfiles: [],
    };

    return {
      success: true,
      snapshot: {
        supportedSections: supported,
        unsupportedSections: unsupported,
        resources,
      },
    };
  } catch (error) {
    return classifySonarrFetchError(error);
  }
}

export async function collectSonarrStartupCandidates(databaseIds: readonly number[]): Promise<SonarrStartupCandidates> {
  const qualityProfiles: StartupPullEntityDescriptor[] = [];
  const delayProfiles: StartupPullEntityDescriptor[] = [];
  const naming: StartupPullEntityDescriptor[] = [];
  const mediaSettings: StartupPullEntityDescriptor[] = [];
  const qualityDefinitions: StartupPullEntityDescriptor[] = [];

  for (const databaseId of databaseIds) {
    const cache = pcdManager.getCache(databaseId);
    if (!cache) continue;

    const [qualityRows, delayRows, mediaManagementCandidates] = await Promise.all([
      qualityProfileQueries.list(cache, 'sonarr'),
      delayProfileQueries.list(cache),
      collectStartupMediaManagementCandidates(cache, databaseId, 'sonarr'),
    ]);

      qualityProfiles.push(
      ...qualityRows.map((profile): {
        id: number
        name: string
        section: 'qualityProfiles'
        arrType: 'sonarr'
        databaseId: number
      } => ({
        id: profile.id,
        name: profile.name,
        section: 'qualityProfiles',
        arrType: 'sonarr',
        databaseId,
      }))
    );

    delayProfiles.push(
      ...delayRows.map((profile): {
        id: number
        name: string
        section: 'delayProfiles'
        arrType: 'sonarr'
        databaseId: number
        fingerprint: string | null
      } => ({
        id: profile.id,
        name: profile.name,
        section: 'delayProfiles',
        arrType: 'sonarr',
        databaseId,
        fingerprint: buildDelayProfileFingerprintFromLocal(profile),
      }))
    );

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

export async function matchSonarrStartupResources(
  input: StartupPullInstanceInput,
  snapshot: SonarrStartupRemoteSnapshot,
  candidates: SonarrStartupCandidates
): Promise<SonarrStartupMatchRunResult> {
  const arrType = assertStartupArrType(input.arrType, 'sonarr', 'Cannot process non-Sonarr instance in sonarr adapter');
  const envelope = createAdapterResultEnvelope('skipped');
  const matches: StartupPullMatchResult[] = [];
  const fallbackDatabaseId = input.databaseIds[0] ?? 0;

  for (const unsupported of snapshot.unsupportedSections) {
    const result = buildUnsupportedSectionResult(input.instanceId, fallbackDatabaseId, unsupported);
    matches.push(result);
    incrementCountersFromMatchResult(envelope, result);
  }

  for (const section of snapshot.supportedSections) {
    if (section === 'qualityProfiles') {
      for (const remoteProfile of snapshot.resources.qualityProfiles) {
        const result = buildSectionMatchRequest(
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
        const result = buildSectionMatchRequest(
          input.instanceId,
          fallbackDatabaseId,
          'delayProfiles',
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

  envelope.status =
    matches.length === 0
      ? 'skipped'
      : envelope.counters.failed > 0
      ? 'failure'
      : 'success';

  return {
    status: envelope.status === 'failure' ? 'failed' : 'success',
    failureKind: null,
    envelope,
    matches,
    unsupportedSections: snapshot.unsupportedSections,
  };
}

export async function runSonarrStartupAdapter(input: StartupPullInstanceInput, client: BaseArrClient): Promise<SonarrStartupMatchRunResult> {
  assertStartupArrType(input.arrType, 'sonarr', 'Cannot run non-Sonarr adapter');

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

  const candidates = await collectSonarrStartupCandidates(input.databaseIds);
  return matchSonarrStartupResources(input, fetchResult.snapshot, candidates);
}

export const sonarrStartupAdapter = {
  arrType: 'sonarr' as const,
  fetch: collectRemoteSectionSnapshots,
  collectCandidates: collectSonarrStartupCandidates,
  match: matchSonarrStartupResources,
  run: runSonarrStartupAdapter,
};
