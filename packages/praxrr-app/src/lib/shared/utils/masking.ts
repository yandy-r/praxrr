const MASK_CHARACTER = "•";
const MASK_LENGTH = 8;

/**
 * Mask a secret value by revealing only the tail portion.
 * Keys with length <= visibleChars + 3 are fully masked.
 *
 * @param key - Secret key value to mask
 * @param visibleChars - Number of trailing characters to show
 * @returns Masked key in deterministic "••••••••{lastN}" form
 */
export function maskApiKey(
  key: string | null | undefined,
  visibleChars = 4,
): string {
  if (!key) {
    return "";
  }

  if (key.length <= visibleChars + 3) {
    return MASK_CHARACTER.repeat(MASK_LENGTH);
  }

  return MASK_CHARACTER.repeat(MASK_LENGTH) + key.slice(-visibleChars);
}

/**
 * Check whether a value is in masked display form.
 *
 * @param value - Value to classify
 * @returns True when value begins with the masked-prefix marker
 */
export function isMaskedValue(value: string): boolean {
  return value.startsWith(MASK_CHARACTER);
}
