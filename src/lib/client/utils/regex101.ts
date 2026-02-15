export function sanitizeRegex101Id(input: string): { value: string; sanitized: boolean } {
  const trimmed = input.trim();
  if (!trimmed) return { value: trimmed, sanitized: false };

  const match = trimmed.match(/regex101\.com\/r\/([^?#]+)/i);
  if (!match) return { value: trimmed, sanitized: false };

  const value = match[1].replace(/\/+$/, '');
  return { value, sanitized: value !== trimmed };
}
