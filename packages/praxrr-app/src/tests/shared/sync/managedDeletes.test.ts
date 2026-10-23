import { assertEquals } from '@std/assert';
import { countManagedDeletes, isBlockedPruneRow, sectionsIncludeManagedDelete } from '$shared/sync/managedDeletes.ts';
import type { EntityChange, SyncPreviewResult } from '$sync/preview/types.ts';

type PreviewSections = Pick<
  SyncPreviewResult,
  'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles'
>;

function entity(
  action: EntityChange['action'],
  managed: boolean | undefined,
  remoteId: number | null,
  entityType = 'customFormat'
): EntityChange {
  return {
    entityType,
    name: `${entityType}-${remoteId ?? 'new'}`,
    action,
    remoteId,
    ...(managed === undefined ? {} : { managed }),
    fields: [],
  };
}

function snapshot(partial: Partial<PreviewSections> = {}): PreviewSections {
  return {
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    ...partial,
  };
}

Deno.test('countManagedDeletes counts only ledger-owned deletes', () => {
  const preview = snapshot({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [entity('delete', true, 1), entity('delete', undefined, 2), entity('update', true, 3)],
      qualityProfiles: [entity('delete', true, 4, 'qualityProfile')],
      blockedPrunes: [
        {
          entityType: 'qualityProfile',
          remoteId: 9,
          name: 'Kept',
          reason: 'Quality profile is still assigned to media',
        },
      ],
    },
    delayProfiles: {
      section: 'delayProfiles',
      profile: entity('delete', undefined, 5, 'delayProfile'),
    },
    mediaManagement: {
      section: 'mediaManagement',
      naming: entity('delete', true, 6, 'naming'),
      mediaSettings: null,
      qualityDefinitions: [entity('delete', undefined, 7, 'qualityDefinition')],
    },
    metadataProfiles: {
      section: 'metadataProfiles',
      profile: entity('delete', true, 8, 'metadataProfile'),
    },
  });

  assertEquals(countManagedDeletes(preview), 4);
  assertEquals(sectionsIncludeManagedDelete(preview, ['delayProfiles']), false);
  assertEquals(sectionsIncludeManagedDelete(preview, ['qualityProfiles']), true);
  assertEquals(sectionsIncludeManagedDelete(preview, ['mediaManagement']), true);
  assertEquals(sectionsIncludeManagedDelete(preview, ['metadataProfiles']), true);
  assertEquals(
    isBlockedPruneRow(entity('delete', true, 9, 'qualityProfile'), preview.qualityProfiles?.blockedPrunes),
    true
  );
  assertEquals(
    isBlockedPruneRow(entity('delete', true, 4, 'qualityProfile'), preview.qualityProfiles?.blockedPrunes),
    false
  );
  assertEquals(isBlockedPruneRow(entity('delete', true, 9, 'qualityProfile'), undefined), false);
});

Deno.test('countManagedDeletes treats a missing managed flag as not a delete', () => {
  const preview = snapshot({
    qualityProfiles: {
      section: 'qualityProfiles',
      customFormats: [entity('delete', false, 1), entity('delete', undefined, 2)],
      qualityProfiles: [],
    },
  });

  assertEquals(countManagedDeletes(preview), 0);
  assertEquals(sectionsIncludeManagedDelete(preview, ['qualityProfiles', 'delayProfiles']), false);
});
