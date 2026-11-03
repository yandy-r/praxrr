/**
 * Case-insensitive, literal name matching and ranking for quick search. Lower rank is better:
 * 0 exact, 1 prefix, 2 word-prefix (match starts after a non-alphanumeric character), 3 substring.
 * Input is matched as plain text, so `%`, `_` and regex metacharacters have no special meaning.
 */

export type MatchRank = 0 | 1 | 2 | 3;

const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/**
 * Rank `name` against an already lower-cased `needle`; `null` when `name` does not contain it.
 */
export function rankName(name: string, needle: string): MatchRank | null {
  const haystack = name.toLowerCase();
  if (haystack === needle) return 0;

  let index = haystack.indexOf(needle);
  if (index === -1) return null;
  if (index === 0) return 1;

  while (index !== -1) {
    if (!ALPHANUMERIC.test(haystack[index - 1])) return 2;
    index = haystack.indexOf(needle, index + 1);
  }
  return 3;
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Name ordering used to break rank ties: locale-aware, numeric, case-insensitive. */
export function compareNames(a: string, b: string): number {
  return nameCollator.compare(a, b);
}
