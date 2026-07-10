/**
 * Base syncer class
 * Provides common structure for syncing PCD data to arr instances
 */

import type { BaseArrClient } from '$arr/base.ts';
import { logger } from '$logger/logger.ts';
import type { SyncResult } from './types.ts';
import type {
  SyncPreviewEvidenceClass,
  SyncPreviewEvidenceRecorder,
  SyncPreviewPreparedExecutionContext,
  SyncPreviewSection,
  SyncPreviewSectionResult,
} from './preview/types.ts';

export type { SyncResult };

/**
 * Abstract base class for syncers
 * Each syncer type (quality profiles, delay profiles, media management) extends this
 */
export abstract class BaseSyncer {
  protected client: BaseArrClient;
  protected instanceId: number;
  protected instanceName: string;
  private previewConfig: unknown = null;
  private previewConfigProvided = false;
  private previewEvidenceRecorder: SyncPreviewEvidenceRecorder | null = null;
  private preparedExecutionContext: Readonly<SyncPreviewPreparedExecutionContext> | null = null;

  constructor(client: BaseArrClient, instanceId: number, instanceName: string) {
    this.client = client;
    this.instanceId = instanceId;
    this.instanceName = instanceName;
  }

  /**
   * Get the sync type name for logging
   */
  protected abstract get syncType(): string;

  /**
   * Fetch data from PCD based on sync config
   */
  protected abstract fetchFromPcd(): Promise<unknown[]>;

  /**
   * Transform PCD data to arr API format
   */
  protected abstract transformToArr(pcdData: unknown[]): unknown[];

  /**
   * Push transformed data to arr instance
   */
  protected abstract pushToArr(arrData: unknown[]): Promise<void>;

  /**
   * Main sync method - orchestrates fetch, transform, push
   */
  async sync(): Promise<SyncResult> {
    try {
      await logger.info(`Starting ${this.syncType} sync for "${this.instanceName}"`, {
        source: 'Syncer',
        meta: { instanceId: this.instanceId, syncType: this.syncType },
      });

      // Fetch from PCD
      const pcdData = await this.fetchFromPcd();

      if (pcdData.length === 0) {
        await logger.debug(`No ${this.syncType} to sync for "${this.instanceName}"`, {
          source: 'Syncer',
          meta: { instanceId: this.instanceId },
        });
        return { success: true, itemsSynced: 0, outcomes: [] };
      }

      // Transform to arr format
      const arrData = this.transformToArr(pcdData);

      // Push to arr
      await this.pushToArr(arrData);

      await logger.info(`Completed ${this.syncType} sync for "${this.instanceName}"`, {
        source: 'Syncer',
        meta: { instanceId: this.instanceId, itemsSynced: arrData.length },
      });

      return { success: true, itemsSynced: arrData.length, outcomes: [] };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await logger.error(`Failed ${this.syncType} sync for "${this.instanceName}"`, {
        source: 'Syncer',
        meta: { instanceId: this.instanceId, error: errorMsg },
      });

      return { success: false, itemsSynced: 0, error: errorMsg, outcomes: [] };
    }
  }

  protected getPreviewConfig(): unknown {
    return this.previewConfig;
  }

  /** Distinguish no override from an explicitly supplied null/undefined/invalid override. */
  protected hasPreviewConfig(): boolean {
    return this.previewConfigProvided;
  }

  public setPreviewConfig(previewConfig: unknown): void {
    this.previewConfig = previewConfig;
    this.previewConfigProvided = true;
  }

  public clearPreviewConfig(): void {
    this.previewConfig = null;
    this.previewConfigProvided = false;
  }

  /** Attach private reviewed-preview evidence capture for the lifetime of one materialization. */
  public setPreviewEvidenceRecorder(recorder: SyncPreviewEvidenceRecorder): void {
    this.previewEvidenceRecorder = recorder;
  }

  public clearPreviewEvidenceRecorder(): void {
    this.previewEvidenceRecorder = null;
  }

  /**
   * Record one bounded evidence value beside the authoritative read that produced it.
   * Ordinary preview, drift, history, and MCP callers do not attach a recorder, making this a no-op.
   */
  protected recordPreviewEvidence(
    section: SyncPreviewSection,
    source: SyncPreviewEvidenceClass,
    key: string,
    value: unknown
  ): void {
    this.previewEvidenceRecorder?.record(section, source, key, freezeContextValue(value));
  }

  /**
   * Freeze and retain the exact validated values that a reviewed writer must consume.
   * Concrete preview implementations call this only after their desired payload and guards exist.
   */
  protected preparePreviewExecution(context: SyncPreviewPreparedExecutionContext): void {
    const prepared = freezeContextValue(context) as Readonly<SyncPreviewPreparedExecutionContext>;
    this.preparedExecutionContext = prepared;
    this.previewEvidenceRecorder?.prepare(prepared);
  }

  /** Attach a previously revalidated prepared context to a reviewed writer. */
  public setPreparedExecutionContext(context: SyncPreviewPreparedExecutionContext): void {
    this.preparedExecutionContext = freezeContextValue(context) as Readonly<SyncPreviewPreparedExecutionContext>;
  }

  protected getPreparedExecutionContext<T extends SyncPreviewPreparedExecutionContext>(): Readonly<T> | null {
    return this.preparedExecutionContext as Readonly<T> | null;
  }

  public clearPreparedExecutionContext(): void {
    this.preparedExecutionContext = null;
  }

  /**
   * Generate a read-only preview diff payload for this section.
   *
   * Preview generation must never mutate Arr state; concrete syncers
   * should implement this method when they are ready to support read-only preview.
   */
  generatePreview(): Promise<Readonly<SyncPreviewSectionResult>> {
    return Promise.reject(new Error(`Preview generation is not implemented for ${this.syncType}`));
  }
}

/** Clone first so freezing reviewed state cannot mutate a caller-owned object. */
function freezeContextValue<T>(value: T): Readonly<T> {
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
  return cloned as Readonly<T>;
}
