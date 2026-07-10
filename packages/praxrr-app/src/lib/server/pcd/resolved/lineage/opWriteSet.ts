/**
 * Op write-set analyzer.
 *
 * Extracts, from a single PCD op's raw inlined SQL, only the STRUCTURE needed for field
 * lineage: per statement, the target table, the statement kind, the EXPLICITLY named
 * columns, and (for update/delete) the raw depth-0 WHERE substring. It never parses
 * values or row keys — the replay observer supplies those from live row snapshots.
 *
 * The analyzer is deliberately conservative: any statement it does not confidently
 * recognize as one of INSERT / UPDATE / DELETE (with an explicit column list for INSERT)
 * sets `parseStatus: 'ambiguous'` for the WHOLE op, which the observer turns into
 * `ambiguous` lineage for every touched cell — never a false source claim (AC4/AC7).
 *
 * Handled shapes (from confirmed op SQL):
 *   INSERT INTO t (c1, c2, ...) VALUES (...),(...) [ON CONFLICT(...) DO ...];
 *   update "t" set "c1" = v1, "c2" = fn(x) where "x" = y;
 *   delete from "t" where ...;
 * Multi-statement (semicolon-separated) ops are split first, each analyzed independently.
 */

export interface WriteSet {
  /** Unquoted target table name. */
  readonly table: string;
  /** Explicitly named columns (unquoted). Empty for DELETE. */
  readonly columns: string[];
  readonly kind: 'insert' | 'update' | 'delete';
  /** Raw depth-0 WHERE substring for update/delete (as written); null for insert or no WHERE. */
  readonly whereExpr: string | null;
}

export interface OpWriteSetResult {
  readonly writeSets: WriteSet[];
  readonly parseStatus: 'parsed' | 'ambiguous';
}

/**
 * Build a structural mask of `sql` the same length as the input, where the CONTENT of
 * single-quoted string literals, line comments, and block comments is replaced by spaces,
 * and the content of double-quoted identifiers is replaced by `a` (a safe identifier char). This
 * lets structural scanning (parens, commas, keywords) run without string/comment/ident
 * contents ever matching — while the original string is kept for extracting identifier text.
 */
function buildMask(sql: string): string {
  const out: string[] = new Array(sql.length);
  let i = 0;
  // states: none | single | double | line-comment | block-comment
  let state: 'none' | 'single' | 'double' | 'line' | 'block' = 'none';
  while (i < sql.length) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : '';
    if (state === 'none') {
      if (ch === "'") {
        state = 'single';
        out[i] = "'";
      } else if (ch === '"') {
        state = 'double';
        out[i] = '"';
      } else if (ch === '-' && next === '-') {
        state = 'line';
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      } else if (ch === '/' && next === '*') {
        state = 'block';
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      } else {
        out[i] = ch;
      }
      i += 1;
      continue;
    }
    if (state === 'single') {
      if (ch === "'" && next === "'") {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = 'none';
        out[i] = "'";
      } else {
        out[i] = ' ';
      }
      i += 1;
      continue;
    }
    if (state === 'double') {
      if (ch === '"' && next === '"') {
        out[i] = 'a';
        out[i + 1] = 'a';
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = 'none';
        out[i] = '"';
      } else {
        out[i] = 'a';
      }
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'none';
        out[i] = '\n';
      } else {
        out[i] = ' ';
      }
      i += 1;
      continue;
    }
    // block comment
    if (ch === '*' && next === '/') {
      state = 'none';
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    out[i] = ' ';
    i += 1;
  }
  return out.join('');
}

/** Split into top-level statements on `;` outside strings/comments/idents. */
function splitStatements(sql: string): string[] {
  const mask = buildMask(sql);
  const statements: string[] = [];
  let start = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === ';') {
      const stmt = sql.slice(start, i).trim();
      if (stmt.length > 0) statements.push(stmt);
      start = i + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/** Find a whole-word, depth-0 keyword (lowercased) in the masked statement. Returns index or -1. */
function findTopLevelKeyword(mask: string, keyword: string, from = 0): number {
  const lower = mask.toLowerCase();
  let depth = 0;
  for (let i = from; i <= lower.length - keyword.length; i++) {
    const ch = lower[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (lower.startsWith(keyword, i)) {
      const before = i > 0 ? lower[i - 1] : ' ';
      const after = i + keyword.length < lower.length ? lower[i + keyword.length] : ' ';
      if (!IDENT_CHAR.test(before) && !IDENT_CHAR.test(after)) return i;
    }
  }
  return -1;
}

/** Read the identifier token starting at `from` in `sql` (skipping leading whitespace). Returns {name, end}. */
function readIdent(sql: string, from: number): { name: string; end: number } | null {
  let i = from;
  while (i < sql.length && /\s/.test(sql[i])) i++;
  if (i >= sql.length) return null;
  if (sql[i] === '"') {
    let j = i + 1;
    let name = '';
    while (j < sql.length) {
      if (sql[j] === '"' && sql[j + 1] === '"') {
        name += '"';
        j += 2;
        continue;
      }
      if (sql[j] === '"') {
        j += 1;
        break;
      }
      name += sql[j];
      j += 1;
    }
    return { name, end: j };
  }
  const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i));
  if (!match) return null;
  return { name: match[0], end: i + match[0].length };
}

/** Strip an optional `schema.` qualifier and unquote — returns the bare table name. */
function normalizeTable(raw: string): string {
  const parts = raw.split('.');
  return parts[parts.length - 1];
}

/** Split a masked region into depth-0 comma segments, returning [start,end) index ranges. */
function splitTopLevelCommas(mask: string, start: number, end: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let segStart = start;
  for (let i = start; i < end; i++) {
    const ch = mask[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (ch === ',' && depth === 0) {
      ranges.push([segStart, i]);
      segStart = i + 1;
    }
  }
  ranges.push([segStart, end]);
  return ranges;
}

function analyzeInsert(stmt: string, mask: string): WriteSet | null {
  const intoIdx = findTopLevelKeyword(mask, 'into');
  if (intoIdx < 0) return null;
  const tableTok = readIdent(stmt, intoIdx + 'into'.length);
  if (!tableTok) return null;
  const table = normalizeTable(tableTok.name);

  // The column list is the first top-level '(' after the table and before top-level 'values'.
  const valuesIdx = findTopLevelKeyword(mask, 'values', tableTok.end);
  const searchEnd = valuesIdx < 0 ? mask.length : valuesIdx;
  let open = -1;
  for (let i = tableTok.end; i < searchEnd; i++) {
    if (mask[i] === '(') {
      open = i;
      break;
    }
  }
  if (open < 0) return null; // no explicit column list -> cannot attribute columns
  // Find matching close paren.
  let depth = 0;
  let close = -1;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === '(') depth++;
    else if (mask[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;

  const columns: string[] = [];
  for (const [segStart, segEnd] of splitTopLevelCommas(mask, open + 1, close)) {
    const tok = readIdent(stmt, segStart);
    if (!tok || tok.end > segEnd) return null;
    columns.push(tok.name);
  }
  if (columns.length === 0) return null;
  return { table, columns, kind: 'insert', whereExpr: null };
}

function analyzeUpdate(stmt: string, mask: string): WriteSet | null {
  const tableTok = readIdent(stmt, 'update'.length);
  if (!tableTok) return null;
  const table = normalizeTable(tableTok.name);

  const setIdx = findTopLevelKeyword(mask, 'set', tableTok.end);
  if (setIdx < 0) return null;
  const whereIdx = findTopLevelKeyword(mask, 'where', setIdx + 'set'.length);
  const setEnd = whereIdx < 0 ? stmt.length : whereIdx;

  const columns: string[] = [];
  for (const [segStart, segEnd] of splitTopLevelCommas(mask, setIdx + 'set'.length, setEnd)) {
    const tok = readIdent(stmt, segStart);
    if (!tok || tok.end > segEnd) return null;
    // The next non-space char in the segment must be '=' for a real assignment.
    let k = tok.end;
    while (k < segEnd && /\s/.test(stmt[k])) k++;
    if (stmt[k] !== '=') return null;
    columns.push(tok.name);
  }
  if (columns.length === 0) return null;

  const whereExpr = whereIdx < 0 ? null : stmt.slice(whereIdx + 'where'.length).trim();
  return { table, columns, kind: 'update', whereExpr };
}

function analyzeDelete(stmt: string, mask: string): WriteSet | null {
  const fromIdx = findTopLevelKeyword(mask, 'from');
  if (fromIdx < 0) return null;
  const tableTok = readIdent(stmt, fromIdx + 'from'.length);
  if (!tableTok) return null;
  const table = normalizeTable(tableTok.name);
  const whereIdx = findTopLevelKeyword(mask, 'where', tableTok.end);
  const whereExpr = whereIdx < 0 ? null : stmt.slice(whereIdx + 'where'.length).trim();
  return { table, columns: [], kind: 'delete', whereExpr };
}

function leadingKeyword(mask: string): string | null {
  const match = /^\s*([A-Za-z]+)/.exec(mask);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Analyze all statements in one op's SQL. Returns the per-statement write sets. If ANY
 * statement is unrecognized or malformed, `parseStatus` is `'ambiguous'` for the whole op
 * (and any write sets recognized so far are still returned so the observer can stamp them
 * ambiguous rather than lose the rows).
 */
export function analyzeOpWriteSets(sql: string): OpWriteSetResult {
  const statements = splitStatements(sql);
  const writeSets: WriteSet[] = [];
  let parseStatus: 'parsed' | 'ambiguous' = 'parsed';

  for (const stmt of statements) {
    const mask = buildMask(stmt);
    const kw = leadingKeyword(mask);
    let ws: WriteSet | null = null;
    if (kw === 'insert') ws = analyzeInsert(stmt, mask);
    else if (kw === 'update') ws = analyzeUpdate(stmt, mask);
    else if (kw === 'delete') ws = analyzeDelete(stmt, mask);
    else {
      // Non-DML (e.g. CREATE TABLE in the schema layer) is not a lineage write path; skip
      // it without marking the op ambiguous.
      if (kw === 'create' || kw === 'pragma' || kw === 'begin' || kw === 'commit') {
        continue;
      }
      parseStatus = 'ambiguous';
      continue;
    }
    if (ws === null) {
      parseStatus = 'ambiguous';
      continue;
    }
    writeSets.push(ws);
  }

  return { writeSets, parseStatus };
}
