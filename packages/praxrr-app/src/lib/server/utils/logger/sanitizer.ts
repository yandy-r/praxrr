const REDACTED_VALUE = '[REDACTED]';
const CIRCULAR_VALUE = '[Circular]';
const UNSERIALIZABLE_VALUE = '[Unserializable]';
const TRUNCATED_VALUE = '[Truncated]';
const MAX_DEPTH = 32;

const SENSITIVE_KEY_PATTERNS = [
  /api[-_]?key/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /token/i,
  /credential/i,
  /x[-_]api[-_]key/i,
  /client[-_]secret/i,
];

const NON_SECRET_KEY_SUFFIX = /(?:name|id|fingerprint|prefix|count|version|revision)$/i;
const NON_SECRET_KEY_PREFIX = /^(?:has|is)[A-Z_]/;

function isSensitiveKey(key: string): boolean {
  if (NON_SECRET_KEY_SUFFIX.test(key) || NON_SECRET_KEY_PREFIX.test(key)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

const SENSITIVE_VALUE_PATTERNS = [
  /^[a-f0-9]{32}$/i,
  /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
  /^sk-[A-Za-z0-9]{20,}$/,
  /^prx_[a-f0-9]{8,}$/,
];

const EMBEDDED_SECRET_PATTERNS = [
  /\b[a-f0-9]{32}\b/gi,
  /\beyJ[A-Za-z0-9-_]{5,}\.[A-Za-z0-9-_]{5,}\.[A-Za-z0-9-_]{5,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bprx_[a-f0-9]{8,}\b/g,
  /\bBearer\s+[^\s,;]+/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
];

const CREDENTIAL_QUERY_PATTERN = /([?&](?:api[-_]?key|token|access[-_]?token|password|secret)=)[^&#\s]+/gi;
// The lookbehind anchors the scheme to the start of a token so long alphanumeric runs stay linear.
const URL_USERINFO_PATTERN = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;
const EMBEDDED_JSON_FIELD_PATTERN = /"([^"\\]+)"(\s*:\s*)("(?:[^"\\]|\\.)*"|[^,}\]]+)/g;

function sanitizeStringValue(value: string): string {
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return REDACTED_VALUE;
  }

  let sanitized = value;
  sanitized = sanitized.replace(URL_USERINFO_PATTERN, `$1${REDACTED_VALUE}@`);
  for (const pattern of EMBEDDED_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED_VALUE);
  }
  sanitized = sanitized.replace(EMBEDDED_JSON_FIELD_PATTERN, (match, key: string, separator: string) => {
    return isSensitiveKey(key) ? `"${key}"${separator}"${REDACTED_VALUE}"` : match;
  });

  return sanitized.replace(CREDENTIAL_QUERY_PATTERN, `$1${REDACTED_VALUE}`);
}

function sanitizeNested(value: unknown, ancestors: Set<object>, depth: number): unknown {
  try {
    return sanitizeLogMetaInternal(value, ancestors, depth);
  } catch {
    return UNSERIALIZABLE_VALUE;
  }
}

function setSanitizedField(
  out: Record<string, unknown>,
  key: string,
  read: () => unknown,
  ancestors: Set<object>,
  depth: number,
  skipUndefined = false
): void {
  let nestedValue: unknown;
  try {
    nestedValue = read();
  } catch {
    out[key] = UNSERIALIZABLE_VALUE;
    return;
  }
  if (skipUndefined && nestedValue === undefined) {
    return;
  }
  if (isSensitiveKey(key)) {
    out[key] = nestedValue === '' ? '' : REDACTED_VALUE;
  } else {
    out[key] = sanitizeNested(nestedValue, ancestors, depth + 1);
  }
}

function sanitizeRecord(value: object, ancestors: Set<object>, depth: number): Record<string, unknown> {
  const sanitizedMeta: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    setSanitizedField(sanitizedMeta, key, () => record[key], ancestors, depth);
  }
  return sanitizedMeta;
}

/**
 * Error properties such as message and stack are non-enumerable, so JSON serialization would
 * otherwise discard the diagnostic details and skip redaction of attached response data.
 */
function sanitizeError(error: Error, ancestors: Set<object>, depth: number): Record<string, unknown> {
  const sanitizedMeta: Record<string, unknown> = {};
  setSanitizedField(sanitizedMeta, 'name', () => error.name, ancestors, depth);
  setSanitizedField(sanitizedMeta, 'message', () => error.message, ancestors, depth);

  let ownKeys: string[] = [];
  try {
    ownKeys = Object.keys(error);
  } catch {
    return sanitizedMeta;
  }
  const record = error as unknown as Record<string, unknown>;
  for (const key of ownKeys) {
    if (key === 'name' || key === 'message') {
      continue;
    }
    const skipUndefined = key === 'stack' || key === 'cause';
    setSanitizedField(sanitizedMeta, key, () => record[key], ancestors, depth, skipUndefined);
  }

  const hasOwn = (key: string) => Object.prototype.propertyIsEnumerable.call(error, key);
  if (!hasOwn('stack')) {
    setSanitizedField(sanitizedMeta, 'stack', () => error.stack, ancestors, depth, true);
  }
  if (!hasOwn('cause') && 'cause' in error) {
    setSanitizedField(
      sanitizedMeta,
      'cause',
      () => (error as Error & { cause?: unknown }).cause,
      ancestors,
      depth,
      true
    );
  }
  if (error instanceof AggregateError && !hasOwn('errors')) {
    setSanitizedField(sanitizedMeta, 'errors', () => error.errors, ancestors, depth, true);
  }

  return sanitizedMeta;
}

function sanitizeLogMetaInternal(value: unknown, ancestors: Set<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return TRUNCATED_VALUE;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeStringValue(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    return undefined;
  }

  if (ancestors.has(value)) {
    return CIRCULAR_VALUE;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const sanitizedArray: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        try {
          sanitizedArray[index] = sanitizeNested(value[index], ancestors, depth + 1);
        } catch {
          sanitizedArray[index] = UNSERIALIZABLE_VALUE;
        }
      }
      return sanitizedArray;
    }

    if (value instanceof Error) {
      return sanitizeError(value, ancestors, depth);
    }

    let toJSON: unknown;
    try {
      toJSON = (value as { toJSON?: unknown }).toJSON;
    } catch {
      return UNSERIALIZABLE_VALUE;
    }
    if (typeof toJSON === 'function') {
      let jsonValue: unknown;
      try {
        jsonValue = (toJSON as () => unknown).call(value);
      } catch {
        return UNSERIALIZABLE_VALUE;
      }
      if (jsonValue !== value) {
        return sanitizeNested(jsonValue, ancestors, depth + 1);
      }
      // toJSON returned itself: fall through to entry sanitization.
    }

    return sanitizeRecord(value, ancestors, depth);
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Sanitize log metadata by redacting sensitive values and keys.
 *
 * @param meta - Value to sanitize.
 * @returns A sanitized copy with sensitive material redacted.
 */
export function sanitizeLogMeta(meta: unknown): unknown {
  try {
    return sanitizeLogMetaInternal(meta, new Set(), 0);
  } catch {
    return UNSERIALIZABLE_VALUE;
  }
}
