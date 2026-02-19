/**
 * Default delay profiles for Radarr and Sonarr
 *
 * These are applied when a new arr instance is added (if enabled in general settings).
 * Values can be updated based on community feedback.
 *
 * Protocol configuration (maps to UI options):
 *   - Prefer Usenet:  enableUsenet=true,  enableTorrent=true,  preferredProtocol='usenet'
 *   - Prefer Torrent: enableUsenet=true,  enableTorrent=true,  preferredProtocol='torrent'
 *   - Only Usenet:    enableUsenet=true,  enableTorrent=false, preferredProtocol='usenet'
 *   - Only Torrent:   enableUsenet=false, enableTorrent=true,  preferredProtocol='torrent'
 *
 * TODO: Get final values from Seraphys
 */

import type { ArrDelayProfile } from './types.ts';

/**
 * Default delay profile for Radarr
 * Applied to the default profile (id=1) when adding a new Radarr instance
 */
export const RADARR_DEFAULT_DELAY_PROFILE: Omit<ArrDelayProfile, 'id' | 'order'> = {
  enableUsenet: true,
  enableTorrent: true,
  preferredProtocol: 'torrent',
  usenetDelay: 600,
  torrentDelay: 600,
  bypassIfHighestQuality: false,
  bypassIfAboveCustomFormatScore: false,
  minimumCustomFormatScore: 0,
  tags: [],
};

/**
 * Default delay profile for Sonarr
 * Applied to the default profile (id=1) when adding a new Sonarr instance
 */
export const SONARR_DEFAULT_DELAY_PROFILE: Omit<ArrDelayProfile, 'id' | 'order'> = {
  enableUsenet: true,
  enableTorrent: true,
  preferredProtocol: 'torrent',
  usenetDelay: 600,
  torrentDelay: 600,
  bypassIfHighestQuality: false,
  bypassIfAboveCustomFormatScore: false,
  minimumCustomFormatScore: 0,
  tags: [],
};

/**
 * Get the default delay profile for an arr type
 */
export function getDefaultDelayProfile(arrType: 'radarr' | 'sonarr'): Omit<ArrDelayProfile, 'id' | 'order'> {
  switch (arrType) {
    case 'radarr':
      return RADARR_DEFAULT_DELAY_PROFILE;
    case 'sonarr':
      return SONARR_DEFAULT_DELAY_PROFILE;
    default:
      throw new Error(`No default delay profile for arr type: ${arrType}`);
  }
}
