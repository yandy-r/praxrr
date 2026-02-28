import { assertThrows } from '@std/assert';
import { trashIdMappingsQueries } from '../../lib/server/db/queries/trashIdMappings.ts';

Deno.test('getByArrTypeAndTrashId throws for empty trashId', () => {
  assertThrows(
    () => {
      trashIdMappingsQueries.getByArrTypeAndTrashId('radarr', '   ');
    },
    Error,
    'TRaSH mapping trash_id must be non-empty'
  );
});

Deno.test('getByIdentity throws for empty trashId', () => {
  assertThrows(
    () => {
      trashIdMappingsQueries.getByIdentity(11, 'radarr', '   ', 'custom_format');
    },
    Error,
    'TRaSH mapping trash_id must be non-empty (source=11)'
  );
});
