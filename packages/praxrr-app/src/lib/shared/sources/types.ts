import type { ArrAppType } from '../arr/capabilities.ts';

/** Canonical source-kind discriminator values for source-aware UX. */
export const SOURCE_KINDS = ['pcd', 'trash'] as const;

/** Supported source kinds for entity provenance. */
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Reference to a PCD-backed source. */
export interface PcdSourceRef {
  type: 'pcd';
  id: number;
  name: string;
}

/** Reference to a TRaSH-backed source. */
export interface TrashSourceRef {
  type: 'trash';
  id: number;
  name: string;
  arrType: ArrAppType;
}

/** Canonical source reference for source-aware routing, filters, and badges. */
export type SourceRef = PcdSourceRef | TrashSourceRef;

/**
 * Optional source metadata fields used by display rows while preserving
 * existing row contracts for single-source pages.
 */
export interface SourcedDisplayRow {
  sourceType?: SourceKind;
  sourceDatabaseId?: number;
  sourceDatabaseName?: string;
}

/** Generic wrapper for attaching source metadata to any entity payload. */
export interface SourcedEntity<TEntity, TSource extends SourceRef = SourceRef> {
  source: TSource;
  entity: TEntity;
}
