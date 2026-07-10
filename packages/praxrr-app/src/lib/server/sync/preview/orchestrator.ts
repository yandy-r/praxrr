/**
 * Preview orchestrator
 * Coordinates read-only section preview generation with ordered dispatch
 * and partial-failure accumulation.
 */

import { createArrInstanceClientCache, getArrInstanceClient } from '$arr/arrInstanceClients.ts';
import { logger } from '$logger/logger.ts';
import { SYNC_SECTION_ORDER, type SyncArrType } from '../mappings.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { getSection } from '../registry.ts';
import { PREVIEW_STATUS_READY } from './store.ts';
import { classifyPreviewFailure } from './failureReason.ts';
import { SyncPreviewSectionSkipped } from './sectionSkip.ts';
import type { BaseSyncer, SectionType } from '../types.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type {
  DelayProfilesPreview,
  EntityChange,
  MediaManagementPreview,
  MetadataProfilesPreview,
  QualityProfilesPreview,
  SyncPreviewArrType,
  SyncPreviewEvidenceClass,
  SyncPreviewEvidenceRecorder,
  SyncPreviewPreparedExecutionContext,
  SyncPreviewReviewMaterialization,
  SyncPreviewSection,
  SyncPreviewSectionMaterializedEvidence,
  SyncPreviewSectionOutcome,
  SyncPreviewSectionResult,
  SyncPreviewSummary,
} from './types.ts';
import type { SyncPreviewStatus } from './types.ts';

const SOURCE = 'PreviewOrchestrator';

type SectionOutcome = SyncPreviewSectionOutcome & {
  result: SyncPreviewSectionResult | null;
};

interface MutableSyncPreviewSummary {
  totalCreates: number;
  totalUpdates: number;
  totalDeletes: number;
  totalUnchanged: number;
}

export interface GeneratePreviewInput {
  instance: ArrInstance;
  sections?: SectionType[];
  sectionConfigs?: Partial<Record<SectionType, unknown>>;
  nowMs?: number;
}

export interface GeneratePreviewResult {
  instanceId: number;
  instanceName: string;
  arrType: SyncPreviewArrType;
  status: SyncPreviewStatus;
  createdAtMs: number;
  sections: SectionType[];
  sectionOutcomes: SyncPreviewSectionOutcome[];
  qualityProfiles: QualityProfilesPreview | null;
  delayProfiles: DelayProfilesPreview | null;
  mediaManagement: MediaManagementPreview | null;
  metadataProfiles: MetadataProfilesPreview | null;
  summary: SyncPreviewSummary;
}

export interface GeneratePreviewReviewOptions {
  readonly captureReviewContext: true;
  /** Reuse the exact explicitly typed client at the reviewed execution boundary. */
  readonly client?: BaseArrClient;
}

export interface GeneratePreviewWithReviewContextResult {
  readonly preview: GeneratePreviewResult;
  readonly reviewContext: SyncPreviewReviewMaterialization;
}

interface ReviewContextAwareSyncer extends BaseSyncer {
  setPreviewEvidenceRecorder?(recorder: SyncPreviewEvidenceRecorder): void;
  clearPreviewEvidenceRecorder?(): void;
  clearPreparedExecutionContext?(): void;
}

interface CapturedSectionReviewContext {
  readonly evidence: SyncPreviewSectionMaterializedEvidence;
  readonly effectiveConfig?: unknown;
  readonly preparedExecutionContext?: SyncPreviewPreparedExecutionContext;
}

class SectionReviewRecorder implements SyncPreviewEvidenceRecorder {
  private readonly evidence: Record<SyncPreviewEvidenceClass, Map<string, unknown>> = {
    pcd: new Map(),
    arr: new Map(),
  };
  private preparedExecutionContext: SyncPreviewPreparedExecutionContext | null = null;

  constructor(private readonly section: SyncPreviewSection) {}

  record(section: SyncPreviewSection, source: SyncPreviewEvidenceClass, key: string, value: unknown): void {
    this.assertSection(section);
    if (key.length === 0 || key.length > 128 || key.trim() !== key) {
      throw new TypeError('Reviewed preview evidence keys must be non-empty stable labels');
    }

    const sourceEvidence = this.evidence[source];
    if (sourceEvidence.has(key)) {
      throw new TypeError(`Duplicate reviewed preview evidence key: ${source}.${key}`);
    }
    sourceEvidence.set(key, cloneAndFreeze(value));
  }

  prepare(context: SyncPreviewPreparedExecutionContext): void {
    this.assertSection(context.section);
    if (this.preparedExecutionContext) {
      throw new TypeError(`Duplicate reviewed preview preparation for ${this.section}`);
    }
    this.preparedExecutionContext = cloneAndFreeze(context);
  }

  snapshot(result: SyncPreviewSectionResult): CapturedSectionReviewContext {
    const preparedExecutionContext = this.preparedExecutionContext ?? undefined;
    return {
      evidence: Object.freeze({
        section: this.section,
        pcd: this.toEvidenceObject('pcd'),
        arr: this.toEvidenceObject('arr'),
        plan: cloneAndFreeze({
          result,
          outcome: {
            section: this.section,
            failure: null,
            skipped: false,
          },
        }),
      }),
      effectiveConfig: preparedExecutionContext?.config,
      preparedExecutionContext,
    };
  }

  private assertSection(section: SyncPreviewSection): void {
    if (section !== this.section) {
      throw new TypeError(`Reviewed preview recorder for ${this.section} cannot capture ${section}`);
    }
  }

  private toEvidenceObject(source: SyncPreviewEvidenceClass): Readonly<Record<string, unknown>> {
    const record: Record<string, unknown> = Object.create(null);
    for (const [key, value] of this.evidence[source]) {
      record[key] = value;
    }
    return Object.freeze(record);
  }
}

function cloneAndFreeze<T>(value: T): T {
  const cloned = structuredClone(value);
  const seen = new WeakSet<object>();

  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || seen.has(candidate)) {
      return;
    }

    seen.add(candidate);
    for (const child of Object.values(candidate)) {
      freeze(child);
    }
    Object.freeze(candidate);
  };

  freeze(cloned);
  return cloned;
}

function toSyncArrType(value: string): SyncArrType | null {
  if (value === 'radarr' || value === 'sonarr' || value === 'lidarr') {
    return value;
  }

  return null;
}

function dedupeRequestedSections(requestedSections: SectionType[]): SectionType[] {
  const seen = new Set<SectionType>();
  const sections: SectionType[] = [];
  for (const section of requestedSections) {
    if (seen.has(section)) {
      continue;
    }

    seen.add(section);
    sections.push(section);
  }

  return sections;
}

function resolveSections(instanceId: number, requestedSections: SectionType[] | undefined): SectionType[] {
  if (!requestedSections || requestedSections.length === 0) {
    return SYNC_SECTION_ORDER.filter((section) => {
      const handler = getSection(section);
      return handler.hasConfig(instanceId);
    });
  }

  return dedupeRequestedSections(requestedSections).filter((section) => SYNC_SECTION_ORDER.includes(section));
}

function addActionToSummary(summary: MutableSyncPreviewSummary, action: EntityChange['action']): void {
  switch (action) {
    case 'create':
      summary.totalCreates += 1;
      return;
    case 'update':
      summary.totalUpdates += 1;
      return;
    case 'delete':
      summary.totalDeletes += 1;
      return;
    case 'unchanged':
      summary.totalUnchanged += 1;
      return;
  }
}

function accumulateEntityChanges(summary: SyncPreviewSummary, entities: readonly EntityChange[] | null): void {
  if (!entities) {
    return;
  }

  for (const entity of entities) {
    addActionToSummary(summary, entity.action);
  }
}

function buildEmptySummary(): MutableSyncPreviewSummary {
  return {
    totalCreates: 0,
    totalUpdates: 0,
    totalDeletes: 0,
    totalUnchanged: 0,
  };
}

function accumulateSectionSummary(summary: SyncPreviewSummary, sectionResult: SyncPreviewSectionResult): void {
  switch (sectionResult.section) {
    case 'qualityProfiles':
      accumulateEntityChanges(summary, sectionResult.customFormats);
      accumulateEntityChanges(summary, sectionResult.qualityProfiles);
      return;
    case 'delayProfiles':
      accumulateEntityChanges(summary, sectionResult.profile ? [sectionResult.profile] : null);
      return;
    case 'mediaManagement':
      accumulateEntityChanges(summary, sectionResult.naming ? [sectionResult.naming] : null);
      accumulateEntityChanges(summary, sectionResult.mediaSettings ? [sectionResult.mediaSettings] : null);
      accumulateEntityChanges(summary, sectionResult.qualityDefinitions);
      return;
    case 'metadataProfiles':
      accumulateEntityChanges(summary, sectionResult.profile ? [sectionResult.profile] : null);
      return;
  }
}

function buildSectionPayloads(sectionOutcomes: readonly SectionOutcome[]): {
  qualityProfiles: QualityProfilesPreview | null;
  delayProfiles: DelayProfilesPreview | null;
  mediaManagement: MediaManagementPreview | null;
  metadataProfiles: MetadataProfilesPreview | null;
  summary: SyncPreviewSummary;
} {
  let qualityProfiles: QualityProfilesPreview | null = null;
  let delayProfiles: DelayProfilesPreview | null = null;
  let mediaManagement: MediaManagementPreview | null = null;
  let metadataProfiles: MetadataProfilesPreview | null = null;
  const summary = buildEmptySummary();

  for (const outcome of sectionOutcomes) {
    if (!outcome.result || outcome.failure || outcome.skipped) {
      continue;
    }

    accumulateSectionSummary(summary, outcome.result);

    switch (outcome.result.section) {
      case 'qualityProfiles':
        qualityProfiles = outcome.result;
        break;
      case 'delayProfiles':
        delayProfiles = outcome.result;
        break;
      case 'mediaManagement':
        mediaManagement = outcome.result;
        break;
      case 'metadataProfiles':
        metadataProfiles = outcome.result;
        break;
    }
  }

  return {
    qualityProfiles,
    delayProfiles,
    mediaManagement,
    metadataProfiles,
    summary,
  };
}

export function generatePreview(
  input: GeneratePreviewInput,
  options: GeneratePreviewReviewOptions
): Promise<GeneratePreviewWithReviewContextResult>;
export function generatePreview(input: GeneratePreviewInput): Promise<GeneratePreviewResult>;
export async function generatePreview(
  input: GeneratePreviewInput,
  options?: GeneratePreviewReviewOptions
): Promise<GeneratePreviewResult | GeneratePreviewWithReviewContextResult> {
  const arrType = toSyncArrType(input.instance.type);
  if (!arrType) {
    throw new Error(`Unsupported arr type: ${input.instance.type}`);
  }

  const nowMs = input.nowMs ?? Date.now();
  const sectionsToRun = resolveSections(input.instance.id, input.sections);

  if (sectionsToRun.length === 0) {
    await logger.debug('No preview sections to run for instance', {
      source: SOURCE,
      meta: {
        instanceId: input.instance.id,
        instanceName: input.instance.name,
        arrType,
      },
    });
  }

  const sectionOutcomes: SectionOutcome[] = [];
  const materializedEvidence: SyncPreviewSectionMaterializedEvidence[] = [];
  const materializedConfigs: Partial<Record<SyncPreviewSection, unknown>> = {};
  const preparedExecutionContexts: Partial<Record<SyncPreviewSection, SyncPreviewPreparedExecutionContext>> = {};

  const ownsClient = options?.client === undefined;
  const client =
    options?.client ??
    (await getArrInstanceClient(
      arrType,
      input.instance.id,
      input.instance.url,
      undefined,
      createArrInstanceClientCache()
    ));
  const { id: instanceId, name: instanceName, type: instanceType } = input.instance;

  try {
    for (const section of sectionsToRun) {
      const handler = getSection(section);
      const hasSectionPreviewConfig =
        input.sectionConfigs !== undefined && Object.prototype.hasOwnProperty.call(input.sectionConfigs, section);
      let syncer: BaseSyncer | null = null;
      let reviewRecorder: SectionReviewRecorder | null = null;

      if (!handler.hasConfig(input.instance.id) && !hasSectionPreviewConfig) {
        sectionOutcomes.push({
          section,
          result: null,
          failure: null,
          skipped: true,
        });
        continue;
      }

      try {
        syncer = handler.createSyncer(client, input.instance);
        const contextAwareSyncer = syncer as ReviewContextAwareSyncer;
        if (input.sectionConfigs?.[section] !== undefined) {
          syncer.setPreviewConfig(input.sectionConfigs[section]);
        }
        if (options?.captureReviewContext) {
          reviewRecorder = new SectionReviewRecorder(section);
          if (!contextAwareSyncer.setPreviewEvidenceRecorder) {
            throw new Error(`Preview evidence capture is not supported for ${section}`);
          }
          contextAwareSyncer.setPreviewEvidenceRecorder(reviewRecorder);
        }

        const result = await syncer.generatePreview();
        sectionOutcomes.push({
          section,
          result,
          failure: null,
          skipped: false,
        });
        if (reviewRecorder) {
          const captured = reviewRecorder.snapshot(result);
          materializedEvidence.push(captured.evidence);
          if (captured.effectiveConfig !== undefined) {
            materializedConfigs[section] = captured.effectiveConfig;
          } else if (input.sectionConfigs?.[section] !== undefined) {
            materializedConfigs[section] = cloneAndFreeze(input.sectionConfigs[section]);
          }
          if (captured.preparedExecutionContext) {
            preparedExecutionContexts[section] = captured.preparedExecutionContext;
          }
        }
      } catch (error) {
        if (error instanceof SyncPreviewSectionSkipped && error.section === section) {
          sectionOutcomes.push({
            section,
            result: null,
            failure: null,
            skipped: true,
          });
          continue;
        }

        // Classify by error TYPE only; the raw message stays out of the outcome and is
        // recorded solely on the sanitized logger boundary below.
        const failure = classifyPreviewFailure(error, arrType);
        sectionOutcomes.push({
          section,
          result: null,
          failure,
          skipped: false,
        });
        await logger.error(`Preview section ${section} failed for ${input.instance.name}`, {
          source: SOURCE,
          meta: {
            instanceId,
            instanceName,
            instanceType,
            section,
            failureCode: failure.code,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        if (syncer) {
          syncer.clearPreviewConfig();
          const contextAwareSyncer = syncer as ReviewContextAwareSyncer;
          contextAwareSyncer.clearPreviewEvidenceRecorder?.();
          contextAwareSyncer.clearPreparedExecutionContext?.();
        }
      }
    }
  } finally {
    if (ownsClient) client.close();
  }

  const payloads = buildSectionPayloads(sectionOutcomes);

  const preview: GeneratePreviewResult = {
    instanceId,
    instanceName,
    arrType,
    status: PREVIEW_STATUS_READY,
    createdAtMs: nowMs,
    sections: sectionsToRun,
    sectionOutcomes: sectionOutcomes.map(({ section, failure, skipped }) => ({
      section,
      failure,
      skipped,
    })),
    qualityProfiles: payloads.qualityProfiles,
    delayProfiles: payloads.delayProfiles,
    mediaManagement: payloads.mediaManagement,
    metadataProfiles: payloads.metadataProfiles,
    summary: payloads.summary,
  };

  if (!options?.captureReviewContext) {
    return preview;
  }

  return {
    preview,
    reviewContext: Object.freeze({
      sectionConfigs: Object.freeze(materializedConfigs),
      evidence: Object.freeze(materializedEvidence),
      preparedExecutionContexts: Object.freeze(preparedExecutionContexts),
    }),
  };
}
