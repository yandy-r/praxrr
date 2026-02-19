import { assertEquals } from '@std/assert';
import { getMediaManagementDisplayName } from '$shared/arr/displayName.ts';

Deno.test('getMediaManagementDisplayName: keeps Lidarr names unchanged', () => {
  assertEquals(getMediaManagementDisplayName('Sonarr', 'lidarr'), 'Sonarr');
  assertEquals(getMediaManagementDisplayName('sonarr', 'lidarr'), 'sonarr');
  assertEquals(getMediaManagementDisplayName(' Sonarr ', 'lidarr'), ' Sonarr ');
  assertEquals(getMediaManagementDisplayName('My Sonarr Profile', 'lidarr'), 'My Sonarr Profile');
  assertEquals(getMediaManagementDisplayName('Lidarr', 'lidarr'), 'Lidarr');
});

Deno.test('getMediaManagementDisplayName: does not rewrite non-Lidarr rows', () => {
  assertEquals(getMediaManagementDisplayName('Sonarr', 'sonarr'), 'Sonarr');
  assertEquals(getMediaManagementDisplayName('Sonarr', 'radarr'), 'Sonarr');
});
