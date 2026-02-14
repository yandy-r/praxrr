/**
 * Normalize media-management config names for display only.
 *
 * Lidarr currently reuses Sonarr-backed storage for some entities, so
 * default Sonarr-named rows can appear under arr_type=lidarr.
 */
export function getMediaManagementDisplayName(name: string, arrType: string): string {
  if (arrType !== 'lidarr') {
    return name;
  }

  if (name.trim().toLowerCase() === 'sonarr') {
    return 'Lidarr';
  }

  return name;
}
