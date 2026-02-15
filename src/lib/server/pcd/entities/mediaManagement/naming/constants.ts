/**
 * Naming table contracts
 */

export const RADARR_NAMING_TABLE = 'radarr_naming' as const;

/**
 * Transitional contract: Sonarr and Lidarr naming operations share this table
 * until first-class Lidarr naming cutover is completed.
 */
export const SONARR_BACKED_NAMING_TABLE = 'sonarr_naming' as const;
