// Platform and channel are injected at build time
// Version comes from the database (fetched via API)

type Platform =
  'docker-amd64' | 'docker-arm64' | 'windows-amd64' | 'linux-amd64' | 'linux-arm64' | 'macos-amd64' | 'macos-arm64';

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

/**
 * Resolve the platform from environment or browser runtime hints.
 *
 * @returns Best-effort detected platform string.
 */
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
 * Resolve the configured platform from Vite env or browser detection.
 *
 * @returns The normalized platform identifier.
 */
export function getPlatform(): Platform {
  const envPlatform = import.meta.env.VITE_PLATFORM as Platform | undefined;
  return envPlatform || detectPlatform();
}

/**
 * Resolve the application update channel from environment or runtime mode.
 *
 * @returns The resolved channel.
 */
export function getChannel(): Channel {
  const envChannel = import.meta.env.VITE_CHANNEL as Channel | undefined;
  if (envChannel) return envChannel;

  // Default to dev for development mode, stable otherwise
  return import.meta.env.MODE === 'development' ? 'dev' : 'stable';
}

/**
 * Return a display label for the current platform.
 *
 * @returns Human-readable platform label.
 */
export function getPlatformLabel(): string {
  const platform = getPlatform();
  return PLATFORM_LABELS[platform] || platform;
}

/**
 * Return a display label for the current channel.
 *
 * @returns Human-readable channel label.
 */
export function getChannelLabel(): string {
  const channel = getChannel();
  return CHANNEL_LABELS[channel] || channel;
}

/**
 * Whether version labels should be shown for the current channel.
 *
 * @returns False for dev channel, true for stable/beta.
 */
export function shouldShowVersion(): boolean {
  const channel = getChannel();
  return channel === 'stable' || channel === 'beta';
}
