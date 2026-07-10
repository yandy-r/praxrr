/**
 * Schema-default parser.
 *
 * Parses the PCD schema DDL (`deps/<schema>/ops/*.sql`) into a per-`(table, column)` map of
 * `CREATE TABLE ... DEFAULT <literal>` clauses. This is the ground truth for deciding whether
 * a never-explicitly-written column value is an implicit `schema-default` (value equals the
 * parsed default) or `ambiguous` (an unmodeled write path) — see `explainFieldLineage`.
 *
 * Defaults are keyed by `(table, column)` because same-named columns diverge across tables
 * (e.g. `radarr_naming.colon_replacement_format DEFAULT 'smart'` vs
 * `sonarr_naming.colon_replacement_format DEFAULT 4`). `CURRENT_TIMESTAMP` is stored as a
 * non-comparable default (`defaultLiteral: null`).
 */

/** Parsed default for one column. `defaultLiteral` is a normalized comparable form (or null). */
export interface SchemaDefaultEntry {
  readonly hasDefault: boolean;
  /** Normalized literal for equality checks: unquoted string, numeric string, or null (non-literal). */
  readonly defaultLiteral: string | null;
  readonly notNull: boolean;
  /** Owning schema op filename (AC1 provenance for defaults). */
  readonly schemaFile: string;
}

export type SchemaDefaultMap = Map<string, Map<string, SchemaDefaultEntry>>;

const CONSTRAINT_KEYWORDS = new Set(['primary', 'foreign', 'unique', 'check', 'constraint']);

const schemaCache = new Map<string, Promise<SchemaDefaultMap>>();

/** Remove `--` line comments and block comments, honoring single-quoted string literals. */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : '';
    if (inString) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === "'") inString = false;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Split a string on depth-0 commas, honoring single-quoted strings and nested parens. */
function splitTopLevelCommas(body: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "'" && body[i + 1] === "'") {
        i += 1;
        continue;
      }
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (ch === ',' && depth === 0) {
      segments.push(body.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(body.slice(start));
  return segments;
}

/** Read the DEFAULT literal token starting after the `DEFAULT` keyword. Returns normalized form. */
function readDefaultLiteral(segment: string, defaultKeywordEnd: number): string | null {
  let i = defaultKeywordEnd;
  while (i < segment.length && /\s/.test(segment[i])) i++;
  if (i >= segment.length) return null;
  const ch = segment[i];
  // Single-quoted string literal.
  if (ch === "'") {
    let j = i + 1;
    let value = '';
    while (j < segment.length) {
      if (segment[j] === "'" && segment[j + 1] === "'") {
        value += "'";
        j += 2;
        continue;
      }
      if (segment[j] === "'") break;
      value += segment[j];
      j += 1;
    }
    return value;
  }
  // Parenthesized expression default -> not a comparable literal.
  if (ch === '(') return null;
  // Bare token (number, CURRENT_TIMESTAMP, TRUE/FALSE/NULL, function name).
  const match = /^[^\s,)]+/.exec(segment.slice(i));
  if (!match) return null;
  const token = match[0];
  const upper = token.toUpperCase();
  if (upper === 'CURRENT_TIMESTAMP' || upper === 'CURRENT_DATE' || upper === 'CURRENT_TIME') return null;
  if (upper === 'NULL') return null;
  if (/^[-+]?\d+(\.\d+)?$/.test(token)) return token;
  // TRUE/FALSE -> 1/0 to match SQLite storage.
  if (upper === 'TRUE') return '1';
  if (upper === 'FALSE') return '0';
  return token;
}

/** Parse one comma segment of a CREATE TABLE body into a (column, entry) pair, or null if a constraint. */
function parseColumnSegment(segment: string, schemaFile: string): { column: string; entry: SchemaDefaultEntry } | null {
  const trimmed = segment.trim();
  if (trimmed.length === 0) return null;
  const firstTokenMatch = /^("([^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)/.exec(trimmed);
  if (!firstTokenMatch) return null;
  const firstToken = firstTokenMatch[0];
  const bareFirst = firstToken.startsWith('"') ? firstToken.slice(1, -1).replaceAll('""', '"') : firstToken;
  if (CONSTRAINT_KEYWORDS.has(bareFirst.toLowerCase())) return null;

  const column = bareFirst;
  const notNull = /\bNOT\s+NULL\b/i.test(trimmed);

  const defaultMatch = /\bDEFAULT\b/i.exec(trimmed);
  if (!defaultMatch) {
    return { column, entry: { hasDefault: false, defaultLiteral: null, notNull, schemaFile } };
  }
  const defaultLiteral = readDefaultLiteral(trimmed, defaultMatch.index + defaultMatch[0].length);
  return { column, entry: { hasDefault: true, defaultLiteral, notNull, schemaFile } };
}

/** Parse every `CREATE TABLE` block in `sql` into the map, recording `schemaFile` per entry. */
function parseCreateTables(sql: string, schemaFile: string, map: SchemaDefaultMap): void {
  const cleaned = stripComments(sql);
  const createRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = createRe.exec(cleaned)) !== null) {
    const rawTable = match[1];
    const table = rawTable.startsWith('"') ? rawTable.slice(1, -1).replaceAll('""', '"') : rawTable;
    // Find the matching close paren for the '(' at the end of the match, honoring strings/parens.
    const open = createRe.lastIndex - 1;
    let depth = 0;
    let inString = false;
    let close = -1;
    for (let i = open; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (ch === "'" && cleaned[i + 1] === "'") {
          i += 1;
          continue;
        }
        if (ch === "'") inString = false;
        continue;
      }
      if (ch === "'") inString = true;
      else if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const body = cleaned.slice(open + 1, close);
    const columns = new Map<string, SchemaDefaultEntry>();
    for (const segment of splitTopLevelCommas(body)) {
      const parsed = parseColumnSegment(segment, schemaFile);
      if (parsed) columns.set(parsed.column, parsed.entry);
    }
    map.set(table, columns);
    createRe.lastIndex = close + 1;
  }
}

async function resolveSchemaOpsDir(pcdPath: string): Promise<string> {
  const depsPath = `${pcdPath}/deps`;
  try {
    for await (const entry of Deno.readDir(depsPath)) {
      if (entry.isDirectory && entry.name.includes('schema')) {
        return `${depsPath}/${entry.name}/ops`;
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return `${pcdPath}/deps/schema/ops`;
}

async function buildSchemaDefaultMap(pcdPath: string): Promise<SchemaDefaultMap> {
  const opsDir = await resolveSchemaOpsDir(pcdPath);
  const map: SchemaDefaultMap = new Map();
  let files: string[] = [];
  try {
    for await (const entry of Deno.readDir(opsDir)) {
      if (entry.isFile && entry.name.endsWith('.sql')) files.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return map;
    throw error;
  }
  files = files.sort();
  for (const file of files) {
    const content = await Deno.readTextFile(`${opsDir}/${file}`);
    parseCreateTables(content, file, map);
  }
  return map;
}

/**
 * Parse (and memoize per `pcdPath`) the schema-default map. The schema DDL is static per PCD,
 * so memoization is safe; tests use unique temp dirs so there is no cross-test contamination.
 */
export function parseSchemaDefaults(pcdPath: string): Promise<SchemaDefaultMap> {
  const cached = schemaCache.get(pcdPath);
  if (cached) return cached;
  const promise = buildSchemaDefaultMap(pcdPath);
  schemaCache.set(pcdPath, promise);
  return promise;
}

/** Test hook: clear the memoization cache. */
export function clearSchemaDefaultsCache(): void {
  schemaCache.clear();
}

/** Look up a `(table, column)` default, returning undefined when unknown. */
export function lookupSchemaDefault(
  map: SchemaDefaultMap,
  table: string,
  column: string
): SchemaDefaultEntry | undefined {
  return map.get(table)?.get(column);
}
