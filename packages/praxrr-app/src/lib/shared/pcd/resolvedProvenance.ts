/** Evidence-backed provenance labels for the Resolved Config viewer. */

export interface ResolvedProvenanceFieldChange {
  readonly field: string;
  readonly type: 'added' | 'changed' | 'removed';
}

export interface ResolvedProvenanceEvidence {
  /** `null` means the currently loaded response does not establish base presence. */
  readonly basePresent: boolean | null;
  readonly resolvedPresent: boolean;
  /** `null` means no base-versus-resolved diff was supplied. */
  readonly overrides: readonly ResolvedProvenanceFieldChange[] | null;
  readonly hasPendingConflict: boolean;
}

export type ResolvedProvenanceKind =
  'base-side' | 'user-override' | 'user-created' | 'unavailable' | 'pending-conflict';

export interface ResolvedProvenanceExplanation {
  readonly kind: ResolvedProvenanceKind;
  readonly label: string;
  readonly detail: string;
}

/**
 * Explain only what existing layer and diff evidence proves. Base-side replay combines schema,
 * base, and tweaks, so this helper intentionally never attributes a value to a default or exact
 * establishing operation.
 */
export function explainResolvedProvenance(evidence: ResolvedProvenanceEvidence): ResolvedProvenanceExplanation {
  if (evidence.hasPendingConflict) {
    return {
      kind: 'pending-conflict',
      label: 'Provenance ambiguous',
      detail: 'A pending value-guard conflict prevents an unambiguous layer explanation.',
    };
  }

  if (!evidence.resolvedPresent) {
    return {
      kind: 'unavailable',
      label: 'Provenance unavailable',
      detail: 'The entity is not present in resolved config, so no current provenance can be shown.',
    };
  }

  if (evidence.basePresent === false) {
    return {
      kind: 'user-created',
      label: 'User-created',
      detail: 'The entity is present in resolved config and absent from the base-side layer.',
    };
  }

  if (evidence.overrides !== null && evidence.overrides.length > 0) {
    return {
      kind: 'user-override',
      label: 'User override',
      detail: `${evidence.overrides.length} field ${
        evidence.overrides.length === 1 ? 'difference is' : 'differences are'
      } recorded relative to the base-side layer.`,
    };
  }

  if (evidence.basePresent === true || evidence.overrides?.length === 0) {
    return {
      kind: 'base-side',
      label: 'Base-side',
      detail: 'The resolved value matches the available base-side layer evidence.',
    };
  }

  return {
    kind: 'unavailable',
    label: 'Provenance unavailable',
    detail: 'Load Base or User Overrides to establish layer provenance.',
  };
}
