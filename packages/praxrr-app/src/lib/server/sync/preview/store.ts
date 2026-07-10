/**
 * In-memory TTL store for sync preview snapshots.
 *
 * Previews are intentionally ephemeral. They never touch the database
 * and are cleaned up when expired.
 */

import { canonicalizeReviewValue, SYNC_PREVIEW_REVIEW_BINDING_VERSION } from './reviewBinding.ts';
import type {
  SyncPreviewArrType,
  SyncPreviewFailureReason,
  SyncPreviewResult,
  SyncPreviewReviewBinding,
  SyncPreviewSection,
  SyncPreviewSectionEvidenceHash,
  SyncPreviewStatus,
} from './types.ts';

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
 * applying  -> ready (receipt-owned release only) | applied | failed
 * applied   -> (terminal)
 * failed    -> (terminal)
 * expired   -> (terminal)
 */
export const PREVIEW_STATUS_TRANSITIONS: Record<SyncPreviewStatus, readonly SyncPreviewStatus[]> = {
  generating: ['ready', 'failed'],
  ready: ['applying', 'failed'],
  applying: ['ready', 'applied', 'failed'],
  applied: [],
  failed: [],
  expired: [],
};

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

export function isPreviewExpired(snapshot: SyncPreviewResult, nowMs: number = Date.now()): boolean {
  return derivePreviewStatus(snapshot, nowMs) === PREVIEW_STATUS_EXPIRED;
}

export interface PreviewStalenessState {
  ageMs: number;
  shouldWarn: boolean;
  shouldBlock: boolean;
}

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

export type SyncPreviewCreateInput = Omit<SyncPreviewResult, 'createdAt' | 'expiresAt'>;

export type SyncPreviewUpdatePatch = Omit<Partial<SyncPreviewResult>, 'createdAt' | 'expiresAt'>;

export type SyncPreviewGenerationPatch = Omit<SyncPreviewUpdatePatch, 'status'>;

declare const APPLY_CLAIM_RECEIPT_BRAND: unique symbol;

/**
 * Runtime-opaque proof that a caller owns the current apply claim.
 *
 * Receipts intentionally expose no preview id or ownership token. Only the store instance that
 * issued a receipt can resolve it.
 */
export type SyncPreviewApplyClaimReceipt = Readonly<{
  readonly [APPLY_CLAIM_RECEIPT_BRAND]: true;
}>;

export type SyncPreviewApplyClaimFailure =
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'expired' }
  | {
      readonly ok: false;
      readonly reason: 'invalid_state';
      readonly status: SyncPreviewStatus;
    }
  | { readonly ok: false; readonly reason: 'unverifiable_review' }
  | { readonly ok: false; readonly reason: 'scope_drift' };

export interface SyncPreviewApplyClaimSuccess {
  readonly ok: true;
  readonly snapshot: SyncPreviewResult;
  readonly binding: SyncPreviewReviewBinding;
  readonly sections: readonly SyncPreviewSection[];
  readonly receipt: SyncPreviewApplyClaimReceipt;
}

export type SyncPreviewApplyClaimResult = SyncPreviewApplyClaimFailure | SyncPreviewApplyClaimSuccess;

export interface SyncPreviewApplyCompletion {
  readonly status: typeof PREVIEW_STATUS_APPLIED | typeof PREVIEW_STATUS_FAILED;
  readonly failure?: SyncPreviewFailureReason | null;
}

export interface SyncPreviewStoreApi {
  create(input: SyncPreviewCreateInput, nowMs?: number): SyncPreviewResult;
  get(id: string, nowMs?: number): SyncPreviewResult | null;
  updateResult(id: string, patch: SyncPreviewUpdatePatch, nowMs?: number): SyncPreviewResult | null;
  completeGeneration(
    id: string,
    patch: SyncPreviewGenerationPatch,
    binding: SyncPreviewReviewBinding,
    nowMs?: number
  ): SyncPreviewResult | null;
  completeNonApplicableGeneration(
    id: string,
    patch: SyncPreviewGenerationPatch,
    nowMs?: number
  ): SyncPreviewResult | null;
  claimReadyForApply(id: string, sections: readonly SyncPreviewSection[], nowMs?: number): SyncPreviewApplyClaimResult;
  releaseApplyClaim(receipt: SyncPreviewApplyClaimReceipt, nowMs?: number): SyncPreviewResult | null;
  completeApplyClaim(
    receipt: SyncPreviewApplyClaimReceipt,
    completion: SyncPreviewApplyCompletion,
    nowMs?: number
  ): SyncPreviewResult | null;
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
  binding: SyncPreviewReviewBinding | null;
  reviewAuthorization: 'pending' | 'reviewed' | 'non_applicable';
  applyOwnerToken: string | null;
}

interface ApplyClaimOwnership {
  readonly previewId: string;
  readonly ownerToken: string;
}

export interface SyncPreviewStoreOptions {
  ttlMs?: number;
}

const REVIEW_SECTIONS: readonly SyncPreviewSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
  'metadataProfiles',
];
const REVIEW_ARR_TYPES: readonly SyncPreviewArrType[] = ['radarr', 'sonarr', 'lidarr'];
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isReviewSection(value: unknown): value is SyncPreviewSection {
  return typeof value === 'string' && REVIEW_SECTIONS.includes(value as SyncPreviewSection);
}

function isReviewArrType(value: unknown): value is SyncPreviewArrType {
  return typeof value === 'string' && REVIEW_ARR_TYPES.includes(value as SyncPreviewArrType);
}

function supportsSection(arrType: SyncPreviewArrType, section: SyncPreviewSection): boolean {
  return section !== 'metadataProfiles' || arrType === 'lidarr';
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function cloneCanonicalObject(value: unknown): Readonly<Record<string, unknown>> | null {
  try {
    const canonical = canonicalizeReviewValue(value);
    const cloned = JSON.parse(canonical) as unknown;
    return isPlainObject(cloned) ? deepFreeze(cloned) : null;
  } catch {
    return null;
  }
}

function cloneEvidenceHash(value: unknown, section: SyncPreviewSection): SyncPreviewSectionEvidenceHash | null {
  if (!isPlainObject(value) || value.section !== section) {
    return null;
  }
  if (
    typeof value.pcdHash !== 'string' ||
    !SHA256_HEX_PATTERN.test(value.pcdHash) ||
    typeof value.arrHash !== 'string' ||
    !SHA256_HEX_PATTERN.test(value.arrHash) ||
    typeof value.planHash !== 'string' ||
    !SHA256_HEX_PATTERN.test(value.planHash)
  ) {
    return null;
  }
  return Object.freeze({
    section,
    pcdHash: value.pcdHash,
    arrHash: value.arrHash,
    planHash: value.planHash,
  });
}

function eligibleSections(snapshot: SyncPreviewResult): readonly SyncPreviewSection[] {
  return snapshot.sectionOutcomes
    .filter((outcome) => outcome.failure === null && !outcome.skipped)
    .map((outcome) => outcome.section);
}

function cloneAndValidateBinding(value: unknown, snapshot: SyncPreviewResult): SyncPreviewReviewBinding | null {
  if (!isPlainObject(value) || value.version !== SYNC_PREVIEW_REVIEW_BINDING_VERSION) {
    return null;
  }
  if (
    !Number.isSafeInteger(value.instanceId) ||
    Number(value.instanceId) <= 0 ||
    !isReviewArrType(value.arrType) ||
    value.instanceId !== snapshot.instanceId ||
    value.arrType !== snapshot.arrType ||
    !Array.isArray(value.sections) ||
    typeof value.targetHash !== 'string' ||
    !SHA256_HEX_PATTERN.test(value.targetHash) ||
    !isPlainObject(value.sectionConfigs) ||
    !isPlainObject(value.evidence)
  ) {
    return null;
  }

  const sections = value.sections as unknown[];
  const successfulSections = eligibleSections(snapshot);
  if (
    sections.length === 0 ||
    sections.length !== successfulSections.length ||
    sections.some(
      (section, index) =>
        !isReviewSection(section) ||
        !supportsSection(value.arrType as SyncPreviewArrType, section) ||
        section !== successfulSections[index] ||
        sections.indexOf(section) !== index
    )
  ) {
    return null;
  }

  const sectionSet = new Set(sections as SyncPreviewSection[]);
  const configKeys = Object.keys(value.sectionConfigs);
  if (configKeys.some((key) => !isReviewSection(key) || !sectionSet.has(key))) {
    return null;
  }
  const sectionConfigs = cloneCanonicalObject(value.sectionConfigs);
  if (!sectionConfigs) {
    return null;
  }

  const evidenceKeys = Object.keys(value.evidence);
  if (
    evidenceKeys.length !== sections.length ||
    evidenceKeys.some((key) => !sectionSet.has(key as SyncPreviewSection))
  ) {
    return null;
  }
  const evidence: Partial<Record<SyncPreviewSection, SyncPreviewSectionEvidenceHash>> = {};
  for (const section of sections as SyncPreviewSection[]) {
    const cloned = cloneEvidenceHash(value.evidence[section], section);
    if (!cloned) {
      return null;
    }
    evidence[section] = cloned;
  }

  return Object.freeze({
    version: SYNC_PREVIEW_REVIEW_BINDING_VERSION,
    instanceId: snapshot.instanceId,
    arrType: snapshot.arrType,
    targetHash: value.targetHash,
    sections: Object.freeze([...(sections as SyncPreviewSection[])]),
    sectionConfigs: sectionConfigs as Readonly<Partial<Record<SyncPreviewSection, unknown>>>,
    evidence: Object.freeze(evidence),
  });
}

function isBindingValidForSnapshot(binding: SyncPreviewReviewBinding, snapshot: SyncPreviewResult): boolean {
  return cloneAndValidateBinding(binding, snapshot) !== null;
}

function isExactReviewedSubset(
  selectedSections: readonly SyncPreviewSection[],
  binding: SyncPreviewReviewBinding,
  snapshot: SyncPreviewResult
): boolean {
  if (
    !Array.isArray(selectedSections) ||
    selectedSections.length === 0 ||
    selectedSections.length > binding.sections.length
  ) {
    return false;
  }

  const eligible = new Set(eligibleSections(snapshot));
  const seen = new Set<SyncPreviewSection>();
  let previousBindingIndex = -1;
  for (const section of selectedSections) {
    const bindingIndex = binding.sections.indexOf(section);
    if (
      !isReviewSection(section) ||
      seen.has(section) ||
      !eligible.has(section) ||
      bindingIndex <= previousBindingIndex ||
      !binding.evidence[section]
    ) {
      return false;
    }
    seen.add(section);
    previousBindingIndex = bindingIndex;
  }
  return true;
}

export class SyncPreviewStore {
  private readonly ttlMs: number;
  private readonly previews = new Map<string, StoredPreview>();
  private readonly applyClaimReceipts = new WeakMap<object, ApplyClaimOwnership>();

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

    if (patch.status === PREVIEW_STATUS_APPLYING || currentStatus === PREVIEW_STATUS_APPLYING) {
      throw new Error('Applying preview state requires an apply claim receipt');
    }

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
      binding: null,
      reviewAuthorization: 'pending',
      applyOwnerToken: null,
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
      binding: entry.binding,
      reviewAuthorization: entry.reviewAuthorization,
      applyOwnerToken: entry.applyOwnerToken,
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
   * Atomically install the completed public result and its private immutable review binding.
   * Any validation failure leaves the original generating entry untouched.
   */
  completeGeneration(
    id: string,
    patch: SyncPreviewGenerationPatch,
    binding: SyncPreviewReviewBinding,
    nowMs: number = Date.now()
  ): SyncPreviewResult | null {
    const entry = this.previews.get(id);
    if (!entry) {
      this.cleanup(nowMs);
      return null;
    }
    if (SyncPreviewStore.isExpired(entry.expiresAtMs, nowMs)) {
      this.previews.delete(id);
      return null;
    }
    if (entry.snapshot.status !== PREVIEW_STATUS_GENERATING) {
      throw new Error(`Invalid preview status transition ${entry.snapshot.status} -> ${PREVIEW_STATUS_READY}`);
    }

    const snapshot = this.sanitizePatch(
      entry,
      {
        ...patch,
        status: PREVIEW_STATUS_READY,
      },
      nowMs
    );
    const immutableBinding = cloneAndValidateBinding(binding, snapshot);
    if (!immutableBinding) {
      throw new TypeError('Invalid sync preview review binding');
    }

    this.previews.set(id, {
      snapshot,
      createdAtMs: entry.createdAtMs,
      expiresAtMs: entry.expiresAtMs,
      binding: immutableBinding,
      reviewAuthorization: 'reviewed',
      applyOwnerToken: null,
    });
    return snapshot;
  }

  /** Complete a valid preview whose requested sections produced no applicable review scope. */
  completeNonApplicableGeneration(
    id: string,
    patch: SyncPreviewGenerationPatch,
    nowMs: number = Date.now()
  ): SyncPreviewResult | null {
    const entry = this.previews.get(id);
    if (!entry) {
      this.cleanup(nowMs);
      return null;
    }
    if (SyncPreviewStore.isExpired(entry.expiresAtMs, nowMs)) {
      this.previews.delete(id);
      return null;
    }
    if (entry.snapshot.status !== PREVIEW_STATUS_GENERATING) {
      throw new Error(`Invalid preview status transition ${entry.snapshot.status} -> ${PREVIEW_STATUS_READY}`);
    }

    const snapshot = this.sanitizePatch(entry, { ...patch, status: PREVIEW_STATUS_READY }, nowMs);
    if (eligibleSections(snapshot).length !== 0) {
      throw new TypeError('Non-applicable preview generation cannot contain eligible sections');
    }

    this.previews.set(id, {
      snapshot,
      createdAtMs: entry.createdAtMs,
      expiresAtMs: entry.expiresAtMs,
      binding: null,
      reviewAuthorization: 'non_applicable',
      applyOwnerToken: null,
    });
    return snapshot;
  }

  /**
   * Atomically validate the private binding and claim an exact reviewed subset for apply.
   */
  claimReadyForApply(
    id: string,
    sections: readonly SyncPreviewSection[],
    nowMs: number = Date.now()
  ): SyncPreviewApplyClaimResult {
    const entry = this.previews.get(id);
    if (!entry) {
      return { ok: false, reason: 'not_found' };
    }
    if (SyncPreviewStore.isExpired(entry.expiresAtMs, nowMs)) {
      this.previews.delete(id);
      return { ok: false, reason: 'expired' };
    }
    if (entry.snapshot.status !== PREVIEW_STATUS_READY) {
      return {
        ok: false,
        reason: 'invalid_state',
        status: entry.snapshot.status,
      };
    }
    if (entry.reviewAuthorization === 'non_applicable') {
      return { ok: false, reason: 'scope_drift' };
    }
    if (
      entry.reviewAuthorization !== 'reviewed' ||
      !entry.binding ||
      !isBindingValidForSnapshot(entry.binding, entry.snapshot)
    ) {
      return { ok: false, reason: 'unverifiable_review' };
    }
    if (!isExactReviewedSubset(sections, entry.binding, entry.snapshot)) {
      return { ok: false, reason: 'scope_drift' };
    }

    const ownerToken = crypto.randomUUID();
    const snapshot: SyncPreviewResult = {
      ...entry.snapshot,
      status: PREVIEW_STATUS_APPLYING,
    };
    const receipt = Object.freeze({}) as SyncPreviewApplyClaimReceipt;
    const selectedSections = Object.freeze([...sections]);

    this.previews.set(id, {
      ...entry,
      snapshot,
      applyOwnerToken: ownerToken,
    });
    this.applyClaimReceipts.set(receipt, { previewId: id, ownerToken });

    return {
      ok: true,
      snapshot,
      binding: entry.binding,
      sections: selectedSections,
      receipt,
    };
  }

  /** Release a pre-write claim conflict back to ready, only for the current owner. */
  releaseApplyClaim(receipt: SyncPreviewApplyClaimReceipt, nowMs: number = Date.now()): SyncPreviewResult | null {
    return this.finishOwnedApplyClaim(receipt, PREVIEW_STATUS_READY, undefined, nowMs);
  }

  /** Complete or terminally invalidate an apply claim, only for the current owner. */
  completeApplyClaim(
    receipt: SyncPreviewApplyClaimReceipt,
    completion: SyncPreviewApplyCompletion,
    nowMs: number = Date.now()
  ): SyncPreviewResult | null {
    return this.finishOwnedApplyClaim(receipt, completion.status, completion.failure, nowMs);
  }

  private finishOwnedApplyClaim(
    receipt: SyncPreviewApplyClaimReceipt,
    status: typeof PREVIEW_STATUS_READY | typeof PREVIEW_STATUS_APPLIED | typeof PREVIEW_STATUS_FAILED,
    failure: SyncPreviewFailureReason | null | undefined,
    nowMs: number
  ): SyncPreviewResult | null {
    const ownership = this.applyClaimReceipts.get(receipt);
    if (!ownership) {
      return null;
    }

    const entry = this.previews.get(ownership.previewId);
    if (!entry) {
      this.applyClaimReceipts.delete(receipt);
      return null;
    }
    if (SyncPreviewStore.isExpired(entry.expiresAtMs, nowMs)) {
      this.previews.delete(ownership.previewId);
      this.applyClaimReceipts.delete(receipt);
      return null;
    }
    if (entry.snapshot.status !== PREVIEW_STATUS_APPLYING || entry.applyOwnerToken !== ownership.ownerToken) {
      this.applyClaimReceipts.delete(receipt);
      return null;
    }
    if (!SyncPreviewStore.canTransition(entry.snapshot.status, status)) {
      this.applyClaimReceipts.delete(receipt);
      return null;
    }

    const snapshot: SyncPreviewResult = {
      ...entry.snapshot,
      status,
      ...(failure === undefined ? {} : { failure }),
    };
    this.previews.set(ownership.previewId, {
      ...entry,
      snapshot,
      applyOwnerToken: null,
    });
    this.applyClaimReceipts.delete(receipt);
    return snapshot;
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
        binding: entry.binding,
        reviewAuthorization: entry.reviewAuthorization,
        applyOwnerToken: entry.applyOwnerToken,
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
