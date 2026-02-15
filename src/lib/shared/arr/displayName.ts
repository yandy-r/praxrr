/**
 * Keep media-management config names unchanged for display.
 */
export function getMediaManagementDisplayName(name: string, arrType: string): string {
  void arrType;
  return name;
}

/**
 * Keep media-management names unchanged for route segments.
 */
export function getMediaManagementRouteName(name: string, arrType: string): string {
  return getMediaManagementDisplayName(name, arrType);
}
