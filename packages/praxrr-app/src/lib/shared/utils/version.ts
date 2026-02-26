// Platform and channel are injected at build time
// Version comes from the database (fetched via API)

type Platform =
  | 'docker-amd64'
  | 'docker-arm64'
  | 'windows-amd64'
  | 'linux-amd64'
  | 'linux-arm64'
  | 'macos-amd64'
  | 'macos-arm64';

type Channel = 'stable' | 'beta' | 'develop' | 'dev';

const PLATFORM_LABELS: Record<Platform, string> = {
  'docker-amd64': 'docker/amd64',
  'docker-arm64': 'docker/arm64',
  'windows-amd64': 'windows/amd64',
  'linux-amd64': 'linux/amd64',
  'linux-arm64': 'linux/arm64',
  'macos-amd64': 'macos/amd64',
  'macos-arm64': 'macos/arm64',
};

const CHANNEL_LABELS: Record<Channel, string> = {
  stable: 'Stable',
  beta: 'Beta',
  develop: 'Develop',
  dev: 'Dev',
};

function detectPlatform(): Platform {
  // Try to detect from navigator in browser
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) return 'windows-amd64';
    if (platform.includes('mac')) {
      // Check for user agent for architecture hints
      const ua = navigator.userAgent || '';
      if (ua.includes('Intel')) return 'macos-amd64';
      return 'macos-arm64';
    }
    if (platform.includes('linux')) return 'linux-amd64';
  }
  return 'linux-amd64';
}

/**
 * Returns the current platform identifier, preferring the build-time VITE_PLATFORM env variable
 * and falling back to browser detection.
 *
 * @returns The detected or configured platform identifier
 */
export function getPlatform(): Platform {
  const envPlatform = import.meta.env.VITE_PLATFORM as Platform | undefined;
  return envPlatform || detectPlatform();
}

/**
 * Returns the current release channel, preferring the build-time VITE_CHANNEL env variable.
 * Defaults to 'dev' in development mode and 'stable' otherwise.
 *
 * @returns The active release channel
 */
export function getChannel(): Channel {
  const envChannel = import.meta.env.VITE_CHANNEL as Channel | undefined;
  if (envChannel) return envChannel;

  // Default to dev for development mode, stable otherwise
  return import.meta.env.MODE === 'development' ? 'dev' : 'stable';
}

/**
 * Returns the human-readable label for the current platform (e.g. 'linux/amd64').
 *
 * @returns Display label for the current platform
 */
export function getPlatformLabel(): string {
  const platform = getPlatform();
  return PLATFORM_LABELS[platform] || platform;
}

/**
 * Returns the human-readable label for the current release channel (e.g. 'Stable').
 *
 * @returns Display label for the current channel
 */
export function getChannelLabel(): string {
  const channel = getChannel();
  return CHANNEL_LABELS[channel] || channel;
}

/**
 * Returns whether the version badge should be displayed in the UI.
 * Only shown on stable and beta channels.
 *
 * @returns `true` if the version should be visible
 */
export function shouldShowVersion(): boolean {
  const channel = getChannel();
  return channel === 'stable' || channel === 'beta';
}
