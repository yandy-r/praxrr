/**
 * Deterministic private bindings for reviewed sync previews.
 *
 * Only bounded canonical values enter the hash boundary. Object keys are sorted, ordinary
 * arrays retain their semantic order, unsupported values fail closed, and true sets may be
 * sorted only through the explicit comparator helper below. The returned binding retains no
 * raw PCD, Arr, or plan evidence.
 */

import type {
  ReviewedEvidenceComparison,
  SyncPreviewArrType,
  SyncPreviewEvidenceClass,
  SyncPreviewReviewBinding,
  SyncPreviewSection,
  SyncPreviewSectionEvidenceHash,
} from './types.ts';

export const SYNC_PREVIEW_REVIEW_BINDING_VERSION = 1 as const;

const HASH_DOMAIN = 'praxrr.sync-preview.review-binding';
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const REVIEW_SECTIONS: readonly SyncPreviewSection[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
  'metadataProfiles',
];
const REVIEW_ARR_TYPES: readonly SyncPreviewArrType[] = ['radarr', 'sonarr', 'lidarr'];

/** Deliberately generous but finite limits for process-local evidence. */
export const REVIEW_CANONICAL_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 100_000,
  maxObjectKeys: 2_048,
  maxArrayLength: 20_000,
  maxStringLength: 1_000_000,
  maxCanonicalBytes: 16 * 1024 * 1024,
});

type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | CanonicalObject;
interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}
type ReviewHashClass = SyncPreviewEvidenceClass | 'plan';

interface CanonicalizationState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

export interface SyncPreviewSectionReviewEvidenceInput {
  readonly section: SyncPreviewSection;
  readonly pcd: unknown;
  readonly arr: unknown;
  readonly plan: unknown;
}

export interface BuildSyncPreviewReviewBindingInput {
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly sections: readonly SyncPreviewSection[];
  readonly sectionConfigs?: Readonly<Partial<Record<SyncPreviewSection, unknown>>>;
  readonly evidence: readonly SyncPreviewSectionReviewEvidenceInput[];
}

function fail(message: string): never {
  throw new TypeError(`Unsupported reviewed evidence: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCanonicalKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function countNode(state: CanonicalizationState): void {
  state.nodes += 1;
  if (state.nodes > REVIEW_CANONICAL_LIMITS.maxNodes) {
    fail('node limit exceeded');
  }
}

function cloneCanonical(value: unknown, state: CanonicalizationState, depth: number): CanonicalValue {
  if (depth > REVIEW_CANONICAL_LIMITS.maxDepth) {
    fail('depth limit exceeded');
  }

  countNode(state);

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length > REVIEW_CANONICAL_LIMITS.maxStringLength) {
      fail('string limit exceeded');
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('numbers must be finite');
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== 'object') {
    fail(`${typeof value} values are not supported`);
  }

  if (state.ancestors.has(value)) {
    fail('cyclic values are not supported');
  }
  state.ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (value.length > REVIEW_CANONICAL_LIMITS.maxArrayLength) {
        fail('array limit exceeded');
      }

      const ownNames = Object.getOwnPropertyNames(value);
      const indexedNames = new Set(Array.from({ length: value.length }, (_, index) => String(index)));
      for (const name of ownNames) {
        if (name !== 'length' && !indexedNames.has(name)) {
          fail('arrays may not have custom properties');
        }
      }

      const cloned: CanonicalValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          fail('sparse arrays are not supported');
        }
        cloned.push(cloneCanonical(value[index], state, depth + 1));
      }
      return Object.freeze(cloned);
    }

    if (!isPlainObject(value)) {
      fail('only plain objects are supported');
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail('symbol keys are not supported');
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > REVIEW_CANONICAL_LIMITS.maxObjectKeys) {
      fail('object key limit exceeded');
    }

    const cloned: Record<string, CanonicalValue> = Object.create(null);
    for (const key of keys.sort(compareCanonicalKeys)) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('non-enumerable and accessor properties are not supported');
      }
      if (key.length > REVIEW_CANONICAL_LIMITS.maxStringLength) {
        fail('object key limit exceeded');
      }
      cloned[key] = cloneCanonical(descriptor.value, state, depth + 1);
    }
    return Object.freeze(cloned);
  } finally {
    state.ancestors.delete(value);
  }
}

function canonicalClone(value: unknown): CanonicalValue {
  return cloneCanonical(value, { nodes: 0, ancestors: new WeakSet<object>() }, 0);
}

/**
 * Return the canonical JSON preimage for a bounded evidence value.
 * Ordinary arrays are never reordered.
 */
export function canonicalizeReviewValue(value: unknown): string {
  const canonical = JSON.stringify(canonicalClone(value));
  if (new TextEncoder().encode(canonical).byteLength > REVIEW_CANONICAL_LIMITS.maxCanonicalBytes) {
    fail('canonical byte limit exceeded');
  }
  return canonical;
}

/**
 * Clone, sort, and freeze a collection that the caller has explicitly identified as a true set.
 * Comparator ties are rejected because an ambiguous identity must not make network ordering material.
 */
export function sortReviewEvidenceSet<T>(
  values: readonly T[],
  comparator: (left: Readonly<T>, right: Readonly<T>) => number
): readonly T[] {
  if (values.length > REVIEW_CANONICAL_LIMITS.maxArrayLength) {
    fail('array limit exceeded');
  }

  const cloned = values.map((value) => canonicalClone(value)) as T[];
  cloned.sort((left, right) => {
    const order = comparator(left, right);
    if (!Number.isFinite(order)) {
      fail('set comparator must return a finite number');
    }
    return order;
  });

  for (let index = 1; index < cloned.length; index += 1) {
    if (comparator(cloned[index - 1], cloned[index]) === 0) {
      fail('set comparator produced an ambiguous or duplicate identity');
    }
  }

  return Object.freeze(cloned);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashEvidence(
  input: Pick<BuildSyncPreviewReviewBindingInput, 'instanceId' | 'arrType'>,
  section: SyncPreviewSection,
  evidenceClass: ReviewHashClass,
  value: unknown
): Promise<string> {
  return sha256Hex(
    canonicalizeReviewValue({
      domain: HASH_DOMAIN,
      version: SYNC_PREVIEW_REVIEW_BINDING_VERSION,
      instanceId: input.instanceId,
      arrType: input.arrType,
      section,
      evidenceClass,
      value,
    })
  );
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

function validateSections(
  sections: readonly SyncPreviewSection[],
  arrType: SyncPreviewArrType,
  allowEmpty = false
): void {
  if ((!allowEmpty && sections.length === 0) || sections.length > REVIEW_SECTIONS.length) {
    fail('reviewed sections must be a non-empty bounded collection');
  }

  const seen = new Set<SyncPreviewSection>();
  for (const section of sections) {
    if (!isReviewSection(section) || !supportsSection(arrType, section) || seen.has(section)) {
      fail('reviewed sections are unsupported or duplicated');
    }
    seen.add(section);
  }
}

function cloneSectionConfigs(
  sections: readonly SyncPreviewSection[],
  sectionConfigs: BuildSyncPreviewReviewBindingInput['sectionConfigs']
): Readonly<Partial<Record<SyncPreviewSection, CanonicalValue>>> {
  if (sectionConfigs === undefined) {
    return Object.freeze({});
  }
  if (!isPlainObject(sectionConfigs)) {
    fail('section configs must be a plain object');
  }

  const canonicalConfigs = canonicalClone(sectionConfigs);
  if (!isPlainObject(canonicalConfigs)) {
    fail('section configs must be a plain object');
  }
  const allowed = new Set(sections);
  const cloned: Partial<Record<SyncPreviewSection, CanonicalValue>> = {};
  for (const key of Object.keys(canonicalConfigs)) {
    if (!isReviewSection(key) || !allowed.has(key)) {
      fail('section config does not belong to the reviewed scope');
    }
    cloned[key] = canonicalConfigs[key] as CanonicalValue;
  }
  return Object.freeze(cloned);
}

/** Build an immutable private binding from exact raw PCD, Arr, and material-plan evidence. */
export async function buildSyncPreviewReviewBinding(
  input: BuildSyncPreviewReviewBindingInput
): Promise<SyncPreviewReviewBinding> {
  if (!Number.isSafeInteger(input.instanceId) || input.instanceId <= 0) {
    fail('instance id must be a positive safe integer');
  }
  if (!isReviewArrType(input.arrType)) {
    fail('Arr type is unsupported');
  }
  validateSections(input.sections, input.arrType);

  const sections = Object.freeze([...input.sections]);
  const sectionConfigs = cloneSectionConfigs(sections, input.sectionConfigs);
  const inputsBySection = new Map<SyncPreviewSection, SyncPreviewSectionReviewEvidenceInput>();
  for (const rawEvidence of input.evidence) {
    if (!rawEvidence || !isReviewSection(rawEvidence.section) || inputsBySection.has(rawEvidence.section)) {
      fail('section evidence is missing, duplicated, or unsupported');
    }
    if (
      !Object.prototype.hasOwnProperty.call(rawEvidence, 'pcd') ||
      !Object.prototype.hasOwnProperty.call(rawEvidence, 'arr') ||
      !Object.prototype.hasOwnProperty.call(rawEvidence, 'plan')
    ) {
      fail('section evidence classes are incomplete');
    }
    inputsBySection.set(rawEvidence.section, rawEvidence);
  }

  if (inputsBySection.size !== sections.length) {
    fail('section evidence must exactly cover the reviewed scope');
  }

  const evidence: Partial<Record<SyncPreviewSection, SyncPreviewSectionEvidenceHash>> = {};
  for (const section of sections) {
    const rawEvidence = inputsBySection.get(section);
    if (!rawEvidence) {
      fail('section evidence must exactly cover the reviewed scope');
    }

    const hasConfig = Object.prototype.hasOwnProperty.call(sectionConfigs, section);
    const pcdValue = {
      configPresent: hasConfig,
      config: hasConfig ? sectionConfigs[section] : null,
      evidence: rawEvidence.pcd,
    };
    evidence[section] = Object.freeze({
      section,
      pcdHash: await hashEvidence(input, section, 'pcd', pcdValue),
      arrHash: await hashEvidence(input, section, 'arr', rawEvidence.arr),
      planHash: await hashEvidence(input, section, 'plan', rawEvidence.plan),
    });
  }

  return Object.freeze({
    version: SYNC_PREVIEW_REVIEW_BINDING_VERSION,
    instanceId: input.instanceId,
    arrType: input.arrType,
    sections,
    sectionConfigs,
    evidence: Object.freeze(evidence),
  });
}

function isEvidenceHash(value: unknown, section: SyncPreviewSection): value is SyncPreviewSectionEvidenceHash {
  if (!isPlainObject(value) || value.section !== section) {
    return false;
  }
  return (
    typeof value.pcdHash === 'string' &&
    SHA256_HEX_PATTERN.test(value.pcdHash) &&
    typeof value.arrHash === 'string' &&
    SHA256_HEX_PATTERN.test(value.arrHash) &&
    typeof value.planHash === 'string' &&
    SHA256_HEX_PATTERN.test(value.planHash)
  );
}

function isValidBinding(value: unknown): value is SyncPreviewReviewBinding {
  if (!isPlainObject(value) || value.version !== SYNC_PREVIEW_REVIEW_BINDING_VERSION) {
    return false;
  }
  if (!Number.isSafeInteger(value.instanceId) || Number(value.instanceId) <= 0 || !isReviewArrType(value.arrType)) {
    return false;
  }
  if (!Array.isArray(value.sections)) {
    return false;
  }

  try {
    validateSections(value.sections as SyncPreviewSection[], value.arrType);
  } catch {
    return false;
  }

  if (!isPlainObject(value.sectionConfigs) || !isPlainObject(value.evidence)) {
    return false;
  }

  const sectionConfigs = value.sectionConfigs;
  const evidence = value.evidence;
  const sectionSet = new Set(value.sections as SyncPreviewSection[]);
  const configKeys = Object.keys(sectionConfigs);
  if (configKeys.some((key) => !isReviewSection(key) || !sectionSet.has(key))) {
    return false;
  }
  try {
    canonicalizeReviewValue(sectionConfigs);
  } catch {
    return false;
  }

  const evidenceKeys = Object.keys(evidence);
  if (evidenceKeys.length !== sectionSet.size) {
    return false;
  }
  return evidenceKeys.every((key) => isReviewSection(key) && sectionSet.has(key) && isEvidenceHash(evidence[key], key));
}

function invalidated(
  reason: Exclude<ReviewedEvidenceComparison, { kind: 'match' }>['reason'],
  changedSections: readonly SyncPreviewSection[],
  changedEvidence: readonly SyncPreviewEvidenceClass[] = []
): ReviewedEvidenceComparison {
  return {
    kind: 'invalidated',
    reason,
    changedEvidence: Object.freeze([...changedEvidence]),
    changedSections: Object.freeze([...changedSections]),
  };
}

/**
 * Compare a freshly materialized exact subset with the stored reviewed binding.
 * Any malformed/unknown binding or unexplained plan-only change is unverifiable.
 */
export function compareReviewedEvidence(
  expected: unknown,
  actual: unknown,
  selectedSections: readonly SyncPreviewSection[]
): ReviewedEvidenceComparison {
  const safeSelected = selectedSections.filter(isReviewSection);
  let expectedBinding: SyncPreviewReviewBinding | null = null;
  let actualBinding: SyncPreviewReviewBinding | null = null;
  try {
    if (isValidBinding(expected) && isValidBinding(actual)) {
      expectedBinding = expected;
      actualBinding = actual;
    }
  } catch {
    expectedBinding = null;
    actualBinding = null;
  }
  if (!expectedBinding || !actualBinding) {
    return invalidated('unverifiable_review', safeSelected);
  }

  try {
    validateSections(selectedSections, expectedBinding.arrType);
  } catch {
    return invalidated('scope_drift', safeSelected);
  }

  if (
    expectedBinding.instanceId !== actualBinding.instanceId ||
    expectedBinding.arrType !== actualBinding.arrType ||
    selectedSections.some((section) => !expectedBinding.sections.includes(section)) ||
    actualBinding.sections.length !== selectedSections.length ||
    actualBinding.sections.some((section, index) => section !== selectedSections[index])
  ) {
    return invalidated('scope_drift', selectedSections);
  }

  const pcdChangedSections: SyncPreviewSection[] = [];
  const arrChangedSections: SyncPreviewSection[] = [];
  const ambiguousPlanSections: SyncPreviewSection[] = [];

  for (const section of selectedSections) {
    const expectedHash = expectedBinding.evidence[section];
    const actualHash = actualBinding.evidence[section];
    if (!expectedHash || !actualHash) {
      return invalidated('unverifiable_review', selectedSections);
    }

    const pcdChanged = expectedHash.pcdHash !== actualHash.pcdHash;
    const arrChanged = expectedHash.arrHash !== actualHash.arrHash;
    const planChanged = expectedHash.planHash !== actualHash.planHash;
    if (pcdChanged) pcdChangedSections.push(section);
    if (arrChanged) arrChangedSections.push(section);
    if (planChanged && !pcdChanged && !arrChanged) {
      ambiguousPlanSections.push(section);
    }
  }

  if (ambiguousPlanSections.length > 0) {
    return invalidated('unverifiable_review', ambiguousPlanSections);
  }

  if (pcdChangedSections.length === 0 && arrChangedSections.length === 0) {
    return { kind: 'match' };
  }

  const changedSections = selectedSections.filter(
    (section) => pcdChangedSections.includes(section) || arrChangedSections.includes(section)
  );
  if (pcdChangedSections.length > 0 && arrChangedSections.length > 0) {
    return invalidated('pcd_and_arr_drift', changedSections, ['pcd', 'arr']);
  }
  if (pcdChangedSections.length > 0) {
    return invalidated('pcd_drift', changedSections, ['pcd']);
  }
  return invalidated('arr_drift', changedSections, ['arr']);
}
