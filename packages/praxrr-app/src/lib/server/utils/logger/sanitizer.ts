const REDACTED_VALUE = '[REDACTED]';
const CIRCULAR_VALUE = '[Circular]';
const UNSERIALIZABLE_VALUE = '[Unserializable]';
const TRUNCATED_VALUE = '[Truncated]';
const MAX_DEPTH = 32;
const MAX_STRING_LENGTH = 8192;
const MAX_COLLECTION_ENTRIES = 1000;
const TRUNCATED_SUFFIX = '…[Truncated]';

const SENSITIVE_KEY_PATTERNS = [
  /api[-_]?key/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /token/i,
  /credential/i,
  /x[-_]api[-_]key/i,
  /client[-_]secret/i,
  /cookie/i,
];

// Identifier-style suffixes need a word boundary (snake/kebab separator, or camelCase after a
// lowercase letter/digit) so keys like `passwordValid` or `apiKeyAndroid` stay sensitive.
const NON_SECRET_KEY_SEPARATED_SUFFIX = /[-_](?:name|id|fingerprint|prefix|count|version|revision)$/i;
const NON_SECRET_KEY_CAMEL_SUFFIX = /[a-z0-9](?:Name|Id|ID|Fingerprint|Prefix|Count|Version|Revision)$/;
const NON_SECRET_KEY_PREFIX = /^(?:has|is)[A-Z_]/;
// A secret identifier (e.g. Vault AppRole `secret_id`) is itself a credential.
const SECRET_ID_KEY = /secret[-_]?id$/i;

function isSensitiveKey(key: string): boolean {
  if (SECRET_ID_KEY.test(key)) {
    return true;
  }
  if (
    NON_SECRET_KEY_SEPARATED_SUFFIX.test(key) ||
    NON_SECRET_KEY_CAMEL_SUFFIX.test(key) ||
    NON_SECRET_KEY_PREFIX.test(key)
  ) {
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
  /\bBearer\s+[^\s,;"']+/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
];

const CREDENTIAL_QUERY_PATTERN = /([?&](?:api[-_]?key|token|access[-_]?token|password|secret)=)[^&#\s]+/gi;
// The lookbehind anchors the scheme to the start of a token so long alphanumeric runs stay linear.
const URL_USERINFO_PATTERN = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:"]+(?::[^\s/@"]*)?@/gi;
// Every match starts at a literal quote and the alternatives are disjoint, so scanning is linear.
// A scalar value never starts with a bracket or quote: brackets are matched on their own so the
// scan continues into nested objects/arrays, and sensitive containers are skipped as a whole.
const EMBEDDED_JSON_FIELD_PATTERN = /"([^"\\]+)"(\s*:\s*)("(?:[^"\\]|\\.)*"?|[{[]|[^\s,{}[\]"][^,}\]]*)/g;
const ESCAPED_JSON_FIELD_PATTERN = /\\"([^"\\]+)\\"(\s*:\s*)(\\"[^"\\]*\\"|[^\s,{}[\]"\\][^,}\]"\\]*)/g;

/** Index just past the container that opens at `openIndex`, or the string end if unterminated. */
function findContainerEnd(value: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < value.length; i++) {
    const char = value[i];
    if (inString) {
      if (char === '\\') {
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return value.length;
}

function redactJsonFields(value: string): string {
  const pattern = EMBEDDED_JSON_FIELD_PATTERN;
  pattern.lastIndex = 0;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const [whole, key, separator, rawValue] = match;
    if (!isSensitiveKey(key)) {
      continue;
    }
    let end = match.index + whole.length;
    if (rawValue === '{' || rawValue === '[') {
      end = findContainerEnd(value, end - 1);
    }
    out += `${value.slice(last, match.index)}"${key}"${separator}"${REDACTED_VALUE}"`;
    last = end;
    pattern.lastIndex = end;
  }
  const redacted = last === 0 ? value : out + value.slice(last);
  return redacted.replace(ESCAPED_JSON_FIELD_PATTERN, (whole, key: string, separator: string) =>
    isSensitiveKey(key) ? `\\"${key}\\"${separator}\\"${REDACTED_VALUE}\\"` : whole
  );
}

const TOKEN_BOUNDARY = /[\s"',;{}[\]()]/;

/** Cap length before any regex work, dropping a trailing partial token a pattern could miss. */
function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  let end = MAX_STRING_LENGTH;
  const floor = MAX_STRING_LENGTH - 512;
  while (end > floor && !TOKEN_BOUNDARY.test(value[end - 1])) {
    end--;
  }
  if (end === floor) {
    end = MAX_STRING_LENGTH;
  }
  return value.slice(0, end) + TRUNCATED_SUFFIX;
}

/** Redact embedded JSON fields, URL userinfo, known token shapes, and credential query params. */
function sanitizeEmbeddedSecrets(value: string): string {
  // JSON fields first: later token patterns must not disturb the quoting this pass relies on.
  let sanitized = redactJsonFields(value);
  sanitized = sanitized.replace(URL_USERINFO_PATTERN, `$1${REDACTED_VALUE}@`);
  for (const pattern of EMBEDDED_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED_VALUE);
  }

  return sanitized.replace(CREDENTIAL_QUERY_PATTERN, `$1${REDACTED_VALUE}`);
}

/** Truncate and redact a string log value. */
function sanitizeStringValue(input: string): string {
  const value = truncateString(input);
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return REDACTED_VALUE;
  }

  return sanitizeEmbeddedSecrets(value);
}

/** Truncate and redact secrets inside a record key while keeping dotted identifiers intact. */
function sanitizeKeyString(input: string): string {
  return sanitizeEmbeddedSecrets(truncateString(input));
}

/** Define an own enumerable data property safely, avoiding `__proto__` prototype mutation. */
function defineField(out: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(out, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Assign a sanitized record field without downgrading an already-redacted value on key collision. */
function setRecordFieldSafely(out: Record<string, unknown>, key: string, value: unknown): void {
  if (Object.prototype.hasOwnProperty.call(out, key) && out[key] === REDACTED_VALUE) {
    return;
  }
  defineField(out, key, value);
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
    defineField(out, key, UNSERIALIZABLE_VALUE);
    return;
  }
  if (skipUndefined && nestedValue === undefined) {
    return;
  }
  if (isSensitiveKey(key)) {
    defineField(out, key, nestedValue === '' ? '' : REDACTED_VALUE);
  } else {
    defineField(out, key, sanitizeNested(nestedValue, ancestors, depth + 1));
  }
}

/** Serialize a `Map` as a sanitized record (when all keys are strings) or a sanitized entry array. */
function sanitizeMap(
  map: Map<unknown, unknown>,
  ancestors: Set<object>,
  depth: number
): Record<string, unknown> | unknown[] | string {
  let iterator: IterableIterator<[unknown, unknown]>;
  try {
    iterator = Map.prototype.entries.call(map);
  } catch {
    return UNSERIALIZABLE_VALUE;
  }

  const entries: Array<[unknown, unknown]> = [];
  let allStringKeys = true;
  let truncated = false;
  try {
    for (const entry of iterator) {
      if (typeof entry[0] !== 'string') {
        allStringKeys = false;
      }
      if (entries.length < MAX_COLLECTION_ENTRIES) {
        entries.push(entry);
      } else {
        truncated = true;
        if (!allStringKeys) {
          break;
        }
      }
    }
  } catch {
    return UNSERIALIZABLE_VALUE;
  }

  if (allStringKeys) {
    const out: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of entries) {
      const key = rawKey as string;
      const sanitizedKey = sanitizeKeyString(key);
      const sanitizedValue = isSensitiveKey(key)
        ? rawValue === ''
          ? ''
          : REDACTED_VALUE
        : sanitizeNested(rawValue, ancestors, depth + 1);
      setRecordFieldSafely(out, sanitizedKey, sanitizedValue);
    }
    if (truncated) {
      defineField(out, TRUNCATED_VALUE, true);
    }
    return out;
  }

  const out: unknown[] = [];
  for (const [rawKey, rawValue] of entries) {
    const sanitizedKey =
      typeof rawKey === 'string'
        ? depth + 1 > MAX_DEPTH
          ? TRUNCATED_VALUE
          : sanitizeKeyString(rawKey)
        : sanitizeNested(rawKey, ancestors, depth + 1);
    const sanitizedValue =
      typeof rawKey === 'string' && isSensitiveKey(rawKey)
        ? rawValue === ''
          ? ''
          : REDACTED_VALUE
        : sanitizeNested(rawValue, ancestors, depth + 1);
    out.push([sanitizedKey, sanitizedValue]);
  }
  if (truncated) {
    out.push(TRUNCATED_VALUE);
  }
  return out;
}

/** Serialize a `Set` as a bounded array of sanitized values. */
function sanitizeSet(set: Set<unknown>, ancestors: Set<object>, depth: number): unknown[] | string {
  let iterator: IterableIterator<unknown>;
  try {
    iterator = Set.prototype.values.call(set);
  } catch {
    return UNSERIALIZABLE_VALUE;
  }

  const out: unknown[] = [];
  try {
    for (const item of iterator) {
      if (out.length >= MAX_COLLECTION_ENTRIES) {
        out.push(TRUNCATED_VALUE);
        break;
      }
      out.push(sanitizeNested(item, ancestors, depth + 1));
    }
  } catch {
    return UNSERIALIZABLE_VALUE;
  }
  return out;
}

/** Serialize a `Headers` instance as a sanitized record with sensitive headers redacted. */
function sanitizeHeaders(headers: Headers, ancestors: Set<object>, depth: number): Record<string, unknown> | string {
  const entriesFn = (
    Headers.prototype as Headers & {
      entries?: (this: Headers) => IterableIterator<[string, string]>;
    }
  ).entries;

  const out: Record<string, unknown> = {};
  let count = 0;

  const recordHeader = (name: string, headerValue: string): boolean => {
    if (count >= MAX_COLLECTION_ENTRIES) {
      defineField(out, TRUNCATED_VALUE, true);
      return false;
    }
    count++;
    const sanitizedName = sanitizeKeyString(name);
    const sanitizedValue = isSensitiveKey(name)
      ? headerValue === ''
        ? ''
        : REDACTED_VALUE
      : sanitizeNested(headerValue, ancestors, depth + 1);
    setRecordFieldSafely(out, sanitizedName, sanitizedValue);
    return true;
  };

  try {
    if (typeof entriesFn === 'function') {
      for (const [name, headerValue] of entriesFn.call(headers)) {
        if (!recordHeader(name, headerValue)) {
          break;
        }
      }
    } else {
      let truncated = false;
      Headers.prototype.forEach.call(headers, (headerValue: string, name: string) => {
        if (truncated) {
          return;
        }
        if (!recordHeader(name, headerValue)) {
          truncated = true;
        }
      });
    }
  } catch {
    return UNSERIALIZABLE_VALUE;
  }
  return out;
}

/** Work on a complete bounded URL so a cut through its authority or query cannot expose a partial value. */
function sanitizeFetchUrl(input: string): string {
  if (input === '') return '';
  if (input.length > MAX_STRING_LENGTH) return TRUNCATED_VALUE;

  const url = URL.parse(input);
  if (!url) return UNSERIALIZABLE_VALUE;
  // Opaque URLs (e.g. data:) can contain payloads rather than a network address.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return REDACTED_VALUE;
  url.username = '';
  url.password = '';
  url.hash = '';

  // Match decoded query names, but preserve the spelling/order of the remaining URL.
  const query = url.search
    .slice(1)
    .split('&')
    .map((part) => {
      const equals = part.indexOf('=');
      if (equals === -1) return part;
      const name = part.slice(0, equals);
      const [decodedName] = new URLSearchParams(`${name}=`).keys();
      return isSensitiveKey(decodedName ?? '') ? `${name}=${REDACTED_VALUE}` : part;
    });
  url.search = query.join('&');
  const href = url.href;
  return href.length > MAX_STRING_LENGTH ? TRUNCATED_VALUE : sanitizeStringValue(href);
}

/** Read only standard Fetch metadata; never invoke instance getters, toJSON, or body APIs. */
function sanitizeFetchMessage(
  message: Request | Response,
  prototype: object,
  fields: readonly string[],
  ancestors: Set<object>,
  depth: number
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of fields) {
    if (depth + 1 > MAX_DEPTH) {
      summary[key] = TRUNCATED_VALUE;
      continue;
    }
    const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get;
    if (!getter) throw new TypeError('Missing Fetch metadata getter');
    const value = getter.call(message);
    if (key === 'url') {
      summary[key] = sanitizeFetchUrl(value as string);
    } else if (key === 'headers') {
      // Reuse the Headers sanitizer directly so a custom Headers.toJSON cannot run either.
      summary[key] = sanitizeHeaders(value as Headers, ancestors, depth + 1);
    } else {
      summary[key] = sanitizeNested(value, ancestors, depth + 1);
    }
  }
  return summary;
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
 * V8 prefixes `stack` with `${name}: ${message}`, which is already emitted as `message`; keep only
 * the frames so large messages (for example HTTP response bodies) are not logged twice.
 */
function stackFrames(error: Error, stack: unknown): unknown {
  if (typeof stack !== 'string') {
    return stack;
  }
  const header = error.message ? `${error.name}: ${error.message}` : error.name;
  return stack.startsWith(header) ? stack.slice(header.length).replace(/^\r?\n/, '') : stack;
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
    const read = key === 'stack' ? () => stackFrames(error, record[key]) : () => record[key];
    setSanitizedField(sanitizedMeta, key, read, ancestors, depth, skipUndefined);
  }

  const hasOwn = (key: string) => Object.prototype.propertyIsEnumerable.call(error, key);
  if (!hasOwn('stack')) {
    setSanitizedField(sanitizedMeta, 'stack', () => stackFrames(error, error.stack), ancestors, depth, true);
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

    if (typeof Request === 'function' && value instanceof Request) {
      return sanitizeFetchMessage(value, Request.prototype, ['method', 'url', 'headers', 'bodyUsed'], ancestors, depth);
    }

    if (typeof Response === 'function' && value instanceof Response) {
      return sanitizeFetchMessage(
        value,
        Response.prototype,
        ['status', 'statusText', 'ok', 'redirected', 'url', 'headers', 'bodyUsed'],
        ancestors,
        depth
      );
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
      // toJSON returned itself: fall through to container or entry sanitization.
    }

    if (value instanceof Map) {
      return sanitizeMap(value, ancestors, depth);
    }

    if (value instanceof Set) {
      return sanitizeSet(value, ancestors, depth);
    }

    if (typeof Headers === 'function' && value instanceof Headers) {
      return sanitizeHeaders(value, ancestors, depth);
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
