import { assertEquals } from '@std/assert';
import {
  getMediaManagementDisplayName,
  getMediaManagementRouteName,
  getTrashSourceDisplayName,
} from '$shared/arr/displayName.ts';

// ---------------------------------------------------------------------------
// getTrashSourceDisplayName
// ---------------------------------------------------------------------------

Deno.test('getTrashSourceDisplayName: returns friendly label for known arr types', () => {
  assertEquals(getTrashSourceDisplayName('radarr'), 'Radarr (TRaSH)');
  assertEquals(getTrashSourceDisplayName('sonarr'), 'Sonarr (TRaSH)');
  assertEquals(getTrashSourceDisplayName('lidarr'), 'Lidarr (TRaSH)');
});

Deno.test('getTrashSourceDisplayName: capitalizes unknown arr types', () => {
  assertEquals(getTrashSourceDisplayName('readarr'), 'Readarr (TRaSH)');
});

// ---------------------------------------------------------------------------
// getMediaManagementDisplayName — PCD (no sourceType or sourceType='pcd')
// ---------------------------------------------------------------------------

Deno.test('getMediaManagementDisplayName: returns name unchanged for PCD rows', () => {
  assertEquals(getMediaManagementDisplayName('movie', 'radarr'), 'movie');
  assertEquals(getMediaManagementDisplayName('movie', 'radarr', 'pcd'), 'movie');
  assertEquals(getMediaManagementDisplayName('My Custom Profile', 'sonarr'), 'My Custom Profile');
});

Deno.test('getMediaManagementDisplayName: keeps Lidarr PCD names unchanged', () => {
  assertEquals(getMediaManagementDisplayName('Sonarr', 'lidarr'), 'Sonarr');
  assertEquals(getMediaManagementDisplayName('sonarr', 'lidarr'), 'sonarr');
  assertEquals(getMediaManagementDisplayName(' Sonarr ', 'lidarr'), ' Sonarr ');
  assertEquals(getMediaManagementDisplayName('My Sonarr Profile', 'lidarr'), 'My Sonarr Profile');
  assertEquals(getMediaManagementDisplayName('Lidarr', 'lidarr'), 'Lidarr');
});

Deno.test('getMediaManagementDisplayName: does not rewrite non-Lidarr PCD rows', () => {
  assertEquals(getMediaManagementDisplayName('Sonarr', 'sonarr'), 'Sonarr');
  assertEquals(getMediaManagementDisplayName('Sonarr', 'radarr'), 'Sonarr');
});

// ---------------------------------------------------------------------------
// getMediaManagementDisplayName — TRaSH (sourceType='trash')
// ---------------------------------------------------------------------------

Deno.test('getMediaManagementDisplayName: capitalizes and appends (TRaSH) for quality definition trash rows', () => {
  assertEquals(getMediaManagementDisplayName('movie', 'radarr', 'trash'), 'Movie (TRaSH)');
  assertEquals(getMediaManagementDisplayName('series', 'sonarr', 'trash'), 'Series (TRaSH)');
  assertEquals(getMediaManagementDisplayName('anime', 'sonarr', 'trash'), 'Anime (TRaSH)');
});

Deno.test('getMediaManagementDisplayName: strips -naming suffix and resolves arr label for naming trash rows', () => {
  assertEquals(getMediaManagementDisplayName('radarr-naming', 'radarr', 'trash'), 'Radarr (TRaSH)');
  assertEquals(getMediaManagementDisplayName('sonarr-naming', 'sonarr', 'trash'), 'Sonarr (TRaSH)');
});

Deno.test('getMediaManagementDisplayName: handles empty name for trash rows', () => {
  assertEquals(getMediaManagementDisplayName('', 'radarr', 'trash'), ' (TRaSH)');
});

// ---------------------------------------------------------------------------
// getMediaManagementRouteName — always raw
// ---------------------------------------------------------------------------

Deno.test('getMediaManagementRouteName: always returns raw name regardless of source', () => {
  assertEquals(getMediaManagementRouteName('movie', 'radarr'), 'movie');
  assertEquals(getMediaManagementRouteName('series', 'sonarr'), 'series');
  assertEquals(getMediaManagementRouteName('My Profile', 'lidarr'), 'My Profile');
});
