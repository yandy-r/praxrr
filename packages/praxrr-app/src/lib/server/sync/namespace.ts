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

/**
 * TRaSH Guide namespaces intentionally use a zero-width non-joiner prefix
 * to remain disjoint from database namespaces while preserving matching behavior.
 */
export function getTrashGuideNamespaceSuffix(index: number): string {
  if (index < 1) throw new Error(`Invalid TRaSH namespace index: ${index}`);
  return `\u200C${'\u200B'.repeat(index)}`;
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

/**
 * Preview/preview-diff invariant:
 * - Normalize display output by stripping namespace suffixes.
 * - Preserve suffixes when deciding exact identity.
 *
 * Acceptance example:
 * - stripNamespaceSuffix("Quality Profile​") === "Quality Profile"
 */
export function normalizeNamespaceDisplayName(name: string): string {
  return stripNamespaceSuffix(name);
}

interface NamespaceMatchCandidate {
  readonly index: number;
  readonly name: string;
}

/** Result of namespace-aware matching between desired and remote names. */
export interface NamespaceNameMatch {
  /** Original remote index used for lookup. */
  readonly index: number;
  /** Whether match was exact by string or by stripped namespace suffix. */
  readonly matchKind: 'exact' | 'stripped';
  /** Remote name used for further processing. */
  readonly remoteName: string;
  /** Display name after suffix removal. */
  readonly displayName: string;
}

/**
 * Return the match precedence for namespace-aware comparisons.
 *
 * Precedence:
 * 1. Exact name (including suffix) wins.
 * 2. Then namespace-stripped name match.
 * 3. If multiple stripped matches, the shortest/lexicographically-first suffix is chosen.
 *
 * Acceptance examples:
 * - desired "Profile A", remote ["Profile A", "Profile A​", "Profile A‫"] => exact match.
 * - desired "Profile A", remote ["Profile A​", "Profile A‫"] => suffix-agnostic match, shortest suffix wins.
 */
export function findNamespaceMatch(
  desiredName: string,
  candidateNames: ReadonlyArray<string>,
  consumedIndexes: ReadonlySet<number> = new Set<number>()
): NamespaceNameMatch | null {
  const candidates: NamespaceMatchCandidate[] = candidateNames
    .map((name, index) => ({ name, index }))
    .filter((candidate) => !consumedIndexes.has(candidate.index));

  const exact = candidates.find((candidate) => candidate.name === desiredName);
  if (exact) {
    return {
      index: exact.index,
      matchKind: 'exact',
      remoteName: exact.name,
      displayName: stripNamespaceSuffix(exact.name),
    };
  }

  // If the desired name already includes a namespace suffix, do not
  // perform fallback stripping. This prevents accidental cross-db collisions
  // when desired is already explicit about namespace selection.
  if (hasNamespaceSuffix(desiredName)) {
    return null;
  }

  const targetDisplay = stripNamespaceSuffix(desiredName);
  const strippedMatches = candidates.filter((candidate) => stripNamespaceSuffix(candidate.name) === targetDisplay);
  if (strippedMatches.length === 0) return null;

  const unsuffixed = strippedMatches.find((candidate) => !hasNamespaceSuffix(candidate.name));
  if (unsuffixed) {
    return {
      index: unsuffixed.index,
      matchKind: 'stripped',
      remoteName: unsuffixed.name,
      displayName: stripNamespaceSuffix(unsuffixed.name),
    };
  }

  const sorted = [...strippedMatches].sort((a, b) => {
    const aSuffixLen = suffixLength(a.name);
    const bSuffixLen = suffixLength(b.name);
    if (aSuffixLen !== bSuffixLen) return aSuffixLen - bSuffixLen;
    return a.name.localeCompare(b.name);
  });

  const winner = sorted[0];
  return {
    index: winner.index,
    matchKind: 'stripped',
    remoteName: winner.name,
    displayName: stripNamespaceSuffix(winner.name),
  };
}

function suffixLength(name: string): number {
  const match = name.match(SUFFIX_PATTERN);
  return match ? match[0].length : 0;
}
