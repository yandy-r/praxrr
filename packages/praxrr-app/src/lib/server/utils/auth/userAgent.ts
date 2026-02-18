/**
 * User Agent Parser
 *
 * Simple regex-based parser to extract browser, OS, and device type
 * from user agent strings. No heavy libraries - just pattern matching.
 */

export interface ParsedUserAgent {
  browser: string; // "Chrome 120", "Firefox 121", "Safari 17"
  os: string; // "Windows 11", "macOS 14", "Ubuntu", "iOS 17"
  deviceType: string; // "Desktop", "Mobile", "Tablet"
}

/**
 * Parse a user agent string into structured data
 */
export function parseUserAgent(ua: string): ParsedUserAgent {
  if (!ua) {
    return { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown' };
  }

  return {
    browser: parseBrowser(ua),
    os: parseOS(ua),
    deviceType: parseDeviceType(ua),
  };
}

/**
 * Extract browser name and version
 */
function parseBrowser(ua: string): string {
  // Order matters - check more specific patterns first

  // Edge (Chromium-based)
  const edge = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/);
  if (edge) return `Edge ${edge[1]}`;

  // Opera (also Chromium-based, check before Chrome)
  const opera = ua.match(/(?:OPR|Opera)\/(\d+)/);
  if (opera) return `Opera ${opera[1]}`;

  // Firefox
  const firefox = ua.match(/Firefox\/(\d+)/);
  if (firefox) return `Firefox ${firefox[1]}`;

  // Safari (check before Chrome since Chrome includes Safari in UA)
  // Safari doesn't include "Chrome" in its UA
  if (ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Chromium')) {
    const safari = ua.match(/Version\/(\d+)/);
    if (safari) return `Safari ${safari[1]}`;
    return 'Safari';
  }

  // Chrome (and Chromium-based browsers not caught above)
  const chrome = ua.match(/(?:Chrome|Chromium)\/(\d+)/);
  if (chrome) return `Chrome ${chrome[1]}`;

  // Internet Explorer
  const ie = ua.match(/(?:MSIE |rv:)(\d+)/);
  if (ie) return `IE ${ie[1]}`;

  // Fallback: try to find any browser-like pattern
  const generic = ua.match(/(\w+)\/(\d+)/);
  if (generic) return `${generic[1]} ${generic[2]}`;

  return 'Unknown';
}

/**
 * Extract operating system name and version
 */
function parseOS(ua: string): string {
  // iOS (check before Mac since iOS includes "like Mac OS X")
  const ios = ua.match(/(?:iPhone|iPad|iPod).*?OS (\d+)/);
  if (ios) return `iOS ${ios[1]}`;

  // Android
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (android) return `Android ${android[1]}`;

  // Windows
  // Note: Windows 11 still reports "Windows NT 10.0" for backwards compatibility
  // There's no reliable way to distinguish Win10 from Win11 via user agent alone
  if (ua.includes('Windows')) {
    if (ua.includes('Windows NT 10.0')) return 'Windows';
    if (ua.includes('Windows NT 6.3')) return 'Windows 8.1';
    if (ua.includes('Windows NT 6.2')) return 'Windows 8';
    if (ua.includes('Windows NT 6.1')) return 'Windows 7';
    if (ua.includes('Windows NT 6.0')) return 'Windows Vista';
    if (ua.includes('Windows NT 5.1')) return 'Windows XP';
    return 'Windows';
  }

  // macOS (after iOS check)
  const mac = ua.match(/Mac OS X (\d+)[_.](\d+)/);
  if (mac) {
    const major = parseInt(mac[1]);
    const minor = parseInt(mac[2]);
    // macOS 11+ uses major version only in marketing
    if (major >= 11) return `macOS ${major}`;
    // macOS 10.x uses 10.minor naming
    return `macOS ${major}.${minor}`;
  }
  if (ua.includes('Macintosh')) return 'macOS';

  // Linux distributions
  if (ua.includes('Ubuntu')) return 'Ubuntu';
  if (ua.includes('Fedora')) return 'Fedora';
  if (ua.includes('Debian')) return 'Debian';
  if (ua.includes('Arch')) return 'Arch Linux';
  if (ua.includes('CrOS')) return 'Chrome OS';
  if (ua.includes('Linux')) return 'Linux';

  // BSD variants
  if (ua.includes('FreeBSD')) return 'FreeBSD';
  if (ua.includes('OpenBSD')) return 'OpenBSD';

  return 'Unknown';
}

/**
 * Determine device type from user agent
 */
function parseDeviceType(ua: string): string {
  // Tablets (check before mobile since some tablets include "Mobile")
  if (ua.includes('iPad') || ua.includes('Tablet') || (ua.includes('Android') && !ua.includes('Mobile'))) {
    return 'Tablet';
  }

  // Mobile devices
  if (
    ua.includes('Mobile') ||
    ua.includes('iPhone') ||
    ua.includes('iPod') ||
    ua.includes('Android') ||
    ua.includes('webOS') ||
    ua.includes('BlackBerry') ||
    ua.includes('Opera Mini') ||
    ua.includes('IEMobile')
  ) {
    return 'Mobile';
  }

  // Default to Desktop
  return 'Desktop';
}
