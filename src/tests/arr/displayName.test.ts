import { assertEquals } from '@std/assert';
import { getMediaManagementDisplayName } from '$shared/arr/displayName.ts';

Deno.test('getMediaManagementDisplayName: normalizes exact Sonarr default for Lidarr rows', () => {
	assertEquals(getMediaManagementDisplayName('Sonarr', 'lidarr'), 'Lidarr');
	assertEquals(getMediaManagementDisplayName('sonarr', 'lidarr'), 'Lidarr');
	assertEquals(getMediaManagementDisplayName(' Sonarr ', 'lidarr'), 'Lidarr');
});

Deno.test('getMediaManagementDisplayName: keeps custom names unchanged for Lidarr rows', () => {
	assertEquals(getMediaManagementDisplayName('My Sonarr Profile', 'lidarr'), 'My Sonarr Profile');
	assertEquals(getMediaManagementDisplayName('Lidarr', 'lidarr'), 'Lidarr');
});

Deno.test('getMediaManagementDisplayName: does not rewrite non-Lidarr rows', () => {
	assertEquals(getMediaManagementDisplayName('Sonarr', 'sonarr'), 'Sonarr');
	assertEquals(getMediaManagementDisplayName('Sonarr', 'radarr'), 'Sonarr');
});
