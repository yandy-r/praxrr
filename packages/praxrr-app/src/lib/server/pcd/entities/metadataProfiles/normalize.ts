/**
 * Normalize portable metadata-profile type rows into the create/update input shape. Shared by the
 * entity deserializer and bundle-import overwrite: the portable payload uses `id` while stored
 * toggle rows use `typeId` (album types) / `statusId` (release statuses).
 */

import type { PortableMetadataProfileType } from '$shared/pcd/portable.ts';

export interface LidarrMetadataProfileTypeRow {
  id?: number;
  typeId?: number;
  statusId?: number;
  name?: string;
  allowed?: boolean;
}

export type MetadataProfileSectionKind = 'primary' | 'secondary' | 'status';

function metadataProfileTypeId(typeRow: LidarrMetadataProfileTypeRow, kind: 'album' | 'status'): number {
  if (typeof typeRow.id === 'number' && Number.isInteger(typeRow.id)) {
    return typeRow.id;
  }

  if (kind === 'status' && typeof typeRow.statusId === 'number' && Number.isInteger(typeRow.statusId)) {
    return typeRow.statusId;
  }

  if (kind === 'album' && typeof typeRow.typeId === 'number' && Number.isInteger(typeRow.typeId)) {
    return typeRow.typeId;
  }

  throw new Error(
    kind === 'status'
      ? 'Metadata profile status identifier must be an integer id or statusId'
      : 'Metadata profile type identifier must be an integer id or typeId'
  );
}

export function normalizeLidarrMetadataProfileTypeRows(
  section: MetadataProfileSectionKind,
  typeRows: readonly (LidarrMetadataProfileTypeRow | PortableMetadataProfileType)[]
): Array<{ typeId: number; name: string; allowed: boolean }> {
  return typeRows
    .slice()
    .sort((a, b) => {
      const aId = metadataProfileTypeId(a, section === 'status' ? 'status' : 'album');
      const bId = metadataProfileTypeId(b, section === 'status' ? 'status' : 'album');
      return aId - bId;
    })
    .map((type) => ({
      typeId: metadataProfileTypeId(type, section === 'status' ? 'status' : 'album'),
      name: type.name ?? '',
      allowed: !!type.allowed,
    }));
}

export function normalizeLidarrMetadataProfileReleaseStatusRows(
  rows: readonly (LidarrMetadataProfileTypeRow | PortableMetadataProfileType)[]
): Array<{ statusId: number; name: string; allowed: boolean }> {
  return normalizeLidarrMetadataProfileTypeRows('status', rows).map((row) => ({
    statusId: row.typeId,
    name: row.name,
    allowed: row.allowed,
  }));
}
