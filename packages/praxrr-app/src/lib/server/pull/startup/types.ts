import type { ArrAppType } from '$shared/pcd/types.ts';
import type { JobRunStatus } from '$jobs/queueTypes.ts';

export type StartupPullArrType = ArrAppType;

export type StartupPullSection =
  | 'qualityProfiles'
  | 'delayProfiles'
  | 'naming'
  | 'mediaSettings'
  | 'qualityDefinitions'
  | 'metadataProfiles';

export type StartupPullMatchStatus = 'matched' | 'no_match' | 'conflicted';

export type StartupPullMatchMethod = 'exact_name' | 'metadata_fingerprint';

export type StartupPullMatchReason =
  | 'matched_exact_name'
  | 'matched_fingerprint'
  | 'name_conflict'
  | 'namespace_conflict'
  | 'fingerprint_conflict'
  | 'default_skip'
  | 'unmanaged_remote'
  | 'no_match'
  | 'unsupported_section';

export type StartupPullRunStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'disabled';

export interface StartupPullInstanceInput {
  instanceId: number;
  instanceName: string;
  arrType: StartupPullArrType;
  url: string;
  databaseIds: readonly number[];
}

export interface StartupPullEntityDescriptor {
  id: number | string;
  name: string;
  section: StartupPullSection;
  arrType: StartupPullArrType;
  databaseId: number;
  fingerprint?: string | null;
}

export interface StartupPullMatchRequest {
	instanceId: number;
	databaseId: number;
	section: StartupPullSection;
	arrType: StartupPullArrType;
	remote: StartupPullEntityDescriptor;
	candidates: readonly StartupPullEntityDescriptor[];
}

interface StartupPullMatchResultBase {
  readonly instanceId: number;
  readonly databaseId: number;
  readonly section: StartupPullSection;
  readonly arrType: StartupPullArrType;
  readonly candidatesChecked: number;
}

export interface StartupPullMatchedResult extends StartupPullMatchResultBase {
  readonly status: 'matched';
  readonly reason: 'matched_exact_name' | 'matched_fingerprint';
  readonly matchMethod: StartupPullMatchMethod;
  readonly matchedEntityId: number | string;
  readonly matchedEntityName: string;
  readonly matchedCount: number;
}

export interface StartupPullUnmatchedResult extends StartupPullMatchResultBase {
  readonly status: 'no_match' | 'conflicted';
  readonly reason: StartupPullMatchReason;
  readonly matchMethod?: StartupPullMatchMethod;
  readonly matchedCount?: number;
}

export type StartupPullMatchResult = StartupPullMatchedResult | StartupPullUnmatchedResult;

export interface StartupPullCounters {
  imported: number;
  skipped_default: number;
  skipped_no_match: number;
  conflicted: number;
  failed: number;
}

export interface StartupPullInstanceResult extends StartupPullCounters {
  instanceId: number;
  instanceName: string;
  arrType: StartupPullArrType;
  status: JobRunStatus;
}

export interface StartupPullRunSummary extends StartupPullCounters {
  runId: string;
  status: StartupPullRunStatus;
  startedAt: string;
  finishedAt: string | null;
  instances: readonly StartupPullInstanceResult[];
}

export interface StartupPullPayload extends StartupPullRunSummary {}
