const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /api[-_]key/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /token/i,
  /credential/i,
  /x[-_]api[-_]key/i,
  /client[-_]secret/i,
];

const SENSITIVE_VALUE_PATTERNS = [
  /^[a-f0-9]{32}$/i,
  /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
  /^sk-[A-Za-z0-9]{20,}$/,
];

const EMBEDDED_SECRET_PATTERNS = [
  /\b[a-f0-9]{32}\b/gi,
  /\beyJ[A-Za-z0-9-_]{5,}\.[A-Za-z0-9-_]{5,}\.[A-Za-z0-9-_]{5,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[^\s,;]+/gi,
];

const CREDENTIAL_QUERY_PATTERN = /([?&](?:api[-_]?key|token|access[-_]?token|password|secret)=)[^&#\s]+/gi;

function sanitizeStringValue(value: string): string {
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return REDACTED_VALUE;
  }

  let sanitized = value;
  for (const pattern of EMBEDDED_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED_VALUE);
  }

  return sanitized.replace(CREDENTIAL_QUERY_PATTERN, `$1${REDACTED_VALUE}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeLogMetaInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeStringValue(value);
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol' ||
    typeof value === 'function'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogMetaInternal(item, seen));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (seen.has(value)) {
    return REDACTED_VALUE;
  }
  seen.add(value);

  const sanitizedMeta: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      sanitizedMeta[key] = typeof nestedValue === 'string' ? sanitizeStringValue(nestedValue) : REDACTED_VALUE;
    } else {
      sanitizedMeta[key] = sanitizeLogMetaInternal(nestedValue, seen);
    }
  }

  return sanitizedMeta;
}

/**
 * Sanitize log metadata by redacting sensitive values and keys.
 *
 * @param meta - Value to sanitize.
 * @returns A sanitized copy with sensitive material redacted.
 */
export function sanitizeLogMeta(meta: unknown): unknown {
  return sanitizeLogMetaInternal(meta, new WeakSet());
}
