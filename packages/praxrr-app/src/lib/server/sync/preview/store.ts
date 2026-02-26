/**
 * In-memory TTL store for sync preview snapshots.
 *
 * Previews are intentionally ephemeral. They never touch the database
 * and are cleaned up when expired.
 */

import type { SyncPreviewResult, SyncPreviewStatus } from './types.ts';

export const DEFAULT_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const PREVIEW_STALE_WARNING_MS = 5 * 60 * 1000;
export const PREVIEW_STALE_BLOCK_MS = 30 * 60 * 1000;

export const PREVIEW_STATUS_GENERATING = 'generating';
export const PREVIEW_STATUS_READY = 'ready';
export const PREVIEW_STATUS_APPLYING = 'applying';
export const PREVIEW_STATUS_APPLIED = 'applied';
export const PREVIEW_STATUS_FAILED = 'failed';
export const PREVIEW_STATUS_EXPIRED = 'expired';

/**
 * Valid status transitions for preview lifecycle.
 *
 * Snapshot matrix:
 * generating -> ready | failed
 * ready     -> applying | failed
 * applying  -> applied | failed
 * applied   -> (terminal)
 * failed    -> (terminal)
 * expired   -> (terminal)
 */
export const PREVIEW_STATUS_TRANSITIONS: Record<SyncPreviewStatus, readonly SyncPreviewStatus[]> = {
  generating: ['ready', 'failed'],
  ready: ['applying', 'failed'],
  applying: ['applied', 'failed'],
  applied: [],
  failed: [],
  expired: [],
};

/**
 * Derive the effective status of a preview snapshot, returning `expired` when the TTL has elapsed.
 *
 * @param snapshot - The stored preview snapshot
 * @param nowMs - Current time in milliseconds (defaults to Date.now())
 * @returns The resolved lifecycle status
 * @throws {Error} When `snapshot.expiresAt` cannot be parsed as a date
 */
export function derivePreviewStatus(snapshot: SyncPreviewResult, nowMs: number = Date.now()): SyncPreviewStatus {
  const expiresAtMs = Date.parse(snapshot.expiresAt);

  if (Number.isNaN(expiresAtMs)) {
    throw new Error(`Invalid preview expiresAt value: ${snapshot.expiresAt}`);
  }

  if (nowMs >= expiresAtMs) {
    return PREVIEW_STATUS_EXPIRED;
  }

  return snapshot.status;
}

/**
 * Returns true when a preview snapshot has passed its expiry time.
 *
 * @param snapshot - The stored preview snapshot
 * @param nowMs - Current time in milliseconds (defaults to Date.now())
 * @returns Whether the snapshot is expired
 */
export function isPreviewExpired(snapshot: SyncPreviewResult, nowMs: number = Date.now()): boolean {
  return derivePreviewStatus(snapshot, nowMs) === PREVIEW_STATUS_EXPIRED;
}

export interface PreviewStalenessState {
  ageMs: number;
  shouldWarn: boolean;
  shouldBlock: boolean;
}

/**
 * Evaluate how stale a preview snapshot is relative to warn/block thresholds.
 *
 * @param snapshot - The stored preview snapshot
 * @param nowMs - Current time in milliseconds (defaults to Date.now())
 * @returns Age and staleness flags for warn/block decisions
 */
export function evaluatePreviewStaleness(
  snapshot: SyncPreviewResult,
  nowMs: number = Date.now()
): PreviewStalenessState {
  const ageMs = Math.max(0, nowMs - Date.parse(snapshot.createdAt));
  return {
    ageMs,
    shouldWarn: ageMs >= PREVIEW_STALE_WARNING_MS,
    shouldBlock: ageMs >= PREVIEW_STALE_BLOCK_MS,
  };
}

export interface SyncPreviewCreateInput extends Omit<SyncPreviewResult, 'createdAt' | 'expiresAt'> {}

export type SyncPreviewUpdatePatch = Omit<Partial<SyncPreviewResult>, 'createdAt' | 'expiresAt'>;

export interface SyncPreviewStoreApi {
  create(input: SyncPreviewCreateInput, nowMs?: number): SyncPreviewResult;
  get(id: string, nowMs?: number): SyncPreviewResult | null;
  updateResult(id: string, patch: SyncPreviewUpdatePatch, nowMs?: number): SyncPreviewResult | null;
  /**
   * Returns null when the preview is missing or expired.
   */
  transition(id: string, status: SyncPreviewStatus, nowMs?: number): SyncPreviewResult | null;
  delete(id: string): boolean;
  cleanup(nowMs?: number): number;
  getSize(): number;
}

interface StoredPreview {
  snapshot: SyncPreviewResult;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface SyncPreviewStoreOptions {
  ttlMs?: number;
}

export class SyncPreviewStore {
  private readonly ttlMs: number;
  private readonly previews = new Map<string, StoredPreview>();

  constructor(options: SyncPreviewStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PREVIEW_TTL_MS;
  }

  static isExpired(expiresAtMs: number, nowMs: number): boolean {
    return nowMs >= expiresAtMs;
  }

  static canTransition(from: SyncPreviewStatus, to: SyncPreviewStatus): boolean {
    return PREVIEW_STATUS_TRANSITIONS[from].includes(to);
  }

  private getCurrentStatus(entry: StoredPreview, nowMs: number): SyncPreviewStatus {
    return derivePreviewStatus(entry.snapshot, nowMs);
  }

  private sanitizePatch(entry: StoredPreview, patch: SyncPreviewUpdatePatch, nowMs: number): SyncPreviewResult {
    const currentStatus = this.getCurrentStatus(entry, nowMs);
    const nextStatus = patch.status ?? currentStatus;

    if (patch.status && !SyncPreviewStore.canTransition(currentStatus, patch.status)) {
      throw new Error(`Invalid preview status transition ${currentStatus} -> ${patch.status}`);
    }

    return {
      ...entry.snapshot,
      ...patch,
      status: nextStatus,
      createdAt: entry.snapshot.createdAt,
      expiresAt: entry.snapshot.expiresAt,
    };
  }

  /**
   * Create and store a new preview snapshot.
   * Returns the snapshot persisted with explicit createdAt/expiresAt values.
   */
  create(input: SyncPreviewCreateInput, nowMs: number = Date.now()): SyncPreviewResult {
    const createdAt = new Date(nowMs);
    const preview: SyncPreviewResult = {
      ...input,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(nowMs + this.ttlMs).toISOString(),
    };

    this.previews.set(preview.id, {
      snapshot: preview,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + this.ttlMs,
    });

    return preview;
  }

  /**
   * Persist full preview snapshot updates.
   * Preserves createdAt/expiresAt from the original snapshot.
   */
  updateResult(id: string, patch: SyncPreviewUpdatePatch, nowMs: number = Date.now()): SyncPreviewResult | null {
    const entry = this.previews.get(id);
    if (!entry) {
      this.cleanup(nowMs);
      return null;
    }

    if (SyncPreviewStore.isExpired(entry.expiresAtMs, nowMs)) {
      this.previews.delete(id);
      return null;
    }

    const snapshot = this.sanitizePatch(entry, patch, nowMs);

    const updated = {
      snapshot,
      createdAtMs: entry.createdAtMs,
      expiresAtMs: entry.expiresAtMs,
    };

    this.previews.set(id, updated);

    return snapshot;
  }

  /**
   * Backward-compatible alias retained for task-local callers.
   */
  update(id: string, patch: SyncPreviewUpdatePatch, nowMs: number = Date.now()): SyncPreviewResult | null {
    return this.updateResult(id, patch, nowMs);
  }

  /**
   * Transition a preview snapshot through the lifecycle matrix.
   */
  transition(id: string, status: SyncPreviewStatus, nowMs: number = Date.now()): SyncPreviewResult | null {
    return this.updateResult(id, { status }, nowMs);
  }

  /**
   * Get a preview snapshot by id.
   * Expired previews return null and are removed.
   */
  get(id: string, nowMs: number = Date.now()): SyncPreviewResult | null {
    const entry = this.previews.get(id);
    if (!entry) {
      return null;
    }

    const currentStatus = this.getCurrentStatus(entry, nowMs);
    if (currentStatus === PREVIEW_STATUS_EXPIRED) {
      this.previews.delete(id);
      return null;
    }

    if (currentStatus !== entry.snapshot.status) {
      const snapshot = {
        ...entry.snapshot,
        status: currentStatus,
      };

      this.previews.set(id, {
        snapshot,
        createdAtMs: entry.createdAtMs,
        expiresAtMs: entry.expiresAtMs,
      });

      return snapshot;
    }

    return entry.snapshot;
  }

  /**
   * Delete a preview snapshot by id.
   */
  delete(id: string): boolean {
    return this.previews.delete(id);
  }

  /**
   * Remove expired snapshots from memory.
   * Deterministic cleanup sorts ids before deletion.
   */
  cleanup(nowMs: number = Date.now()): number {
    let removed = 0;
    const expiredIds = [...this.previews.entries()]
      .filter(([, entry]) => this.isExpired(entry, nowMs))
      .map(([id]) => id)
      .sort();

    for (const id of expiredIds) {
      this.previews.delete(id);
      removed++;
    }

    return removed;
  }

  private isExpired(entry: StoredPreview, nowMs: number): boolean {
    return SyncPreviewStore.isExpired(entry.expiresAtMs, nowMs);
  }

  getSize(): number {
    return this.previews.size;
  }
}

export const previewStore: SyncPreviewStoreApi = new SyncPreviewStore();
