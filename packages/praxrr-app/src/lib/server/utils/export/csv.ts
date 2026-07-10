/**
 * Neutralize spreadsheet formulas before applying RFC 4180 cell quoting.
 *
 * Formula-prefixed values (`=`, `+`, `-`, `@`, their full-width variants, or
 * tab/CR/LF) receive a leading apostrophe. Values containing a comma, quote,
 * carriage return, or line feed are then quoted, with embedded quotes doubled.
 */
export function escapeCsvCell(value: string): string {
  let escaped = value;
  if (/^[=+\-@\t\r\n＝＋－＠]/.test(escaped)) {
    escaped = `'${escaped}`;
  }
  if (/[",\r\n]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}
