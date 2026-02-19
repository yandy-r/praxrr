/**
 * Invisible namespace suffixes for multi-database sync.
 *
 * Each database linked to an Arr instance gets a unique zero-width Unicode
 * suffix appended to CF and QP names during sync. This prevents name
 * collisions across databases and enables cleanup detection.
 */

/** Confirmed zero-width characters that Radarr/Sonarr preserve through round-trips. */
const NAMESPACE_CHARS = [
  '\u200B', // 1: zero-width space
  '\u200C', // 2: zero-width non-joiner
  '\u200D', // 3: zero-width joiner
  '\u2060', // 4: word joiner
  '\u00AD', // 5: soft hyphen
];

/** Regex matching one or more trailing namespace characters. */
const SUFFIX_PATTERN = new RegExp(`[${NAMESPACE_CHARS.join('')}]+$`);

/**
 * Maps a 1-based namespace index to a zero-width suffix string.
 *
 * Indices 1–5 use a single unique character each.
 * Index 6+ repeats U+200B (overflow — unlikely in practice).
 */
export function getNamespaceSuffix(index: number): string {
  if (index < 1) throw new Error(`Invalid namespace index: ${index}`);
  if (index <= NAMESPACE_CHARS.length) return NAMESPACE_CHARS[index - 1];
  return '\u200B'.repeat(index - NAMESPACE_CHARS.length + 1);
}

/** Removes any trailing namespace suffix characters from a name. */
export function stripNamespaceSuffix(name: string): string {
  return name.replace(SUFFIX_PATTERN, '');
}

/** Returns true if the name ends with one or more namespace characters. */
export function hasNamespaceSuffix(name: string): boolean {
  return SUFFIX_PATTERN.test(name);
}

/**
 * Extracts the namespace index from a suffixed name.
 * Returns null if the name has no namespace suffix.
 */
export function getNamespaceIndex(name: string): number | null {
  const match = name.match(SUFFIX_PATTERN);
  if (!match) return null;

  const suffix = match[0];

  // Check single-character matches first (indices 1–5)
  if (suffix.length === 1) {
    const charIndex = NAMESPACE_CHARS.indexOf(suffix);
    if (charIndex !== -1) return charIndex + 1;
  }

  // Overflow: repeated U+200B → index = (repeat count) + NAMESPACE_CHARS.length - 1
  if ([...suffix].every((c) => c === '\u200B')) {
    return suffix.length + NAMESPACE_CHARS.length - 1;
  }

  return null;
}
