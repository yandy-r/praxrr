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
  SyncPreviewReviewTargetInput,
  SyncPreviewSection,
  SyncPreviewSectionEvidenceHash,
} from './types.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { ArrInstanceCredentialIdentity } from '$arr/arrInstanceClients.ts';

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
  bytes: number;
  readonly ancestors: WeakSet<object>;
}

const canonicalTextEncoder = new TextEncoder();

export interface SyncPreviewSectionReviewEvidenceInput {
  readonly section: SyncPreviewSection;
  readonly pcd: unknown;
  readonly arr: unknown;
  readonly plan: unknown;
}

export interface BuildSyncPreviewReviewBindingInput {
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly target: SyncPreviewReviewTargetInput;
  readonly sections: readonly SyncPreviewSection[];
  readonly sectionConfigs?: Readonly<Partial<Record<SyncPreviewSection, unknown>>>;
  readonly evidence: readonly SyncPreviewSectionReviewEvidenceInput[];
}

/** Build the exact private target projection from authoritative instance/credential rows. */
export function syncPreviewReviewTarget(
  instance: ArrInstance,
  credentialIdentity?: ArrInstanceCredentialIdentity
): SyncPreviewReviewTargetInput {
  const credentialFingerprint = credentialIdentity?.fingerprint ?? instance.api_key_fingerprint;
  if (!credentialFingerprint) {
    fail('credential identity is unavailable');
  }
  return Object.freeze({
    url: instance.url,
    credentialFingerprint,
    credentialKeyVersion: credentialIdentity?.keyVersion ?? 'legacy',
    credentialRevision: credentialIdentity?.revision ?? instance.updated_at,
  });
}

function normalizeTargetUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    fail('target URL must be absolute');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    fail('target URL must use HTTP(S) without embedded credentials');
  }
  if (url.search || url.hash) {
    fail('target URL may not contain a query or fragment');
  }
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname}`;
}

function validateTarget(target: SyncPreviewReviewTargetInput): void {
  if (!target || typeof target !== 'object') {
    fail('target identity is required');
  }
  for (const value of [target.credentialFingerprint, target.credentialKeyVersion, target.credentialRevision]) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 1_000) {
      fail('credential identity fields must be non-empty bounded strings');
    }
  }
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

function countCanonicalFragment(state: CanonicalizationState, fragment: string): void {
  state.bytes += canonicalTextEncoder.encode(fragment).byteLength;
  if (state.bytes > REVIEW_CANONICAL_LIMITS.maxCanonicalBytes) {
    fail('canonical byte limit exceeded');
  }
}

function cloneCanonical(value: unknown, state: CanonicalizationState, depth: number): CanonicalValue {
  if (depth > REVIEW_CANONICAL_LIMITS.maxDepth) {
    fail('depth limit exceeded');
  }

  countNode(state);

  if (value === null || typeof value === 'boolean') {
    countCanonicalFragment(state, value === null ? 'null' : String(value));
    return value;
  }

  if (typeof value === 'string') {
    if (value.length > REVIEW_CANONICAL_LIMITS.maxStringLength) {
      fail('string limit exceeded');
    }
    countCanonicalFragment(state, JSON.stringify(value));
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('numbers must be finite');
    }
    const normalized = Object.is(value, -0) ? 0 : value;
    countCanonicalFragment(state, JSON.stringify(normalized));
    return normalized;
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

      countCanonicalFragment(state, '[');
      const cloned: CanonicalValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          fail('sparse arrays are not supported');
        }
        if (index > 0) countCanonicalFragment(state, ',');
        cloned.push(cloneCanonical(value[index], state, depth + 1));
      }
      countCanonicalFragment(state, ']');
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

    countCanonicalFragment(state, '{');
    const cloned: Record<string, CanonicalValue> = Object.create(null);
    for (const [index, key] of keys.sort(compareCanonicalKeys).entries()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('non-enumerable and accessor properties are not supported');
      }
      if (key.length > REVIEW_CANONICAL_LIMITS.maxStringLength) {
        fail('object key limit exceeded');
      }
      if (index > 0) countCanonicalFragment(state, ',');
      countCanonicalFragment(state, JSON.stringify(key));
      countCanonicalFragment(state, ':');
      cloned[key] = cloneCanonical(descriptor.value, state, depth + 1);
    }
    countCanonicalFragment(state, '}');
    return Object.freeze(cloned);
  } finally {
    state.ancestors.delete(value);
  }
}

function canonicalClone(value: unknown): CanonicalValue {
  return cloneCanonical(value, { nodes: 0, bytes: 0, ancestors: new WeakSet<object>() }, 0);
}

/**
 * Return the canonical JSON preimage for a bounded evidence value.
 * Ordinary arrays are never reordered.
 */
export function canonicalizeReviewValue(value: unknown): string {
  const canonical = JSON.stringify(canonicalClone(value));
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

  // Clone the collection as one canonical value so node and byte limits apply to the aggregate,
  // rather than resetting for every element before the later binding hash sees the set.
  const cloned = [...(canonicalClone(values) as readonly T[])];
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

/** Hash the exact canonical endpoint and non-secret credential identity for private storage. */
export function buildSyncPreviewTargetHash(
  input: Pick<BuildSyncPreviewReviewBindingInput, 'instanceId' | 'arrType' | 'target'>
): Promise<string> {
  validateTarget(input.target);
  return sha256Hex(
    canonicalizeReviewValue({
      domain: HASH_DOMAIN,
      version: SYNC_PREVIEW_REVIEW_BINDING_VERSION,
      instanceId: input.instanceId,
      arrType: input.arrType,
      evidenceClass: 'target',
      target: {
        url: normalizeTargetUrl(input.target.url),
        credentialFingerprint: input.target.credentialFingerprint,
        credentialKeyVersion: input.target.credentialKeyVersion,
        credentialRevision: input.target.credentialRevision,
      },
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
  const targetHash = await buildSyncPreviewTargetHash(input);

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
    targetHash,
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
  if (typeof value.targetHash !== 'string' || !SHA256_HEX_PATTERN.test(value.targetHash)) {
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
    expectedBinding.targetHash !== actualBinding.targetHash ||
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
