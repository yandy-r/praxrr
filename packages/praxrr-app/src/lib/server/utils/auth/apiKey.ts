/**
 * API key generation utility
 * Generates 32 hex character keys (UUID without hyphens, like Sonarr)
 */

/**
 * Generate a new API key
 * Returns 32 lowercase hex characters (128 bits)
 */
export function generateApiKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
