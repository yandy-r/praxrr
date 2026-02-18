/**
 * PCD SQL Utilities
 * SQL compilation and formatting utilities
 */

import type { CompiledQuery } from 'kysely';

/**
 * Convert a compiled Kysely query to executable SQL
 * Replaces ? placeholders with actual values
 *
 * Note: We can't use simple string.replace() because parameter values
 * might contain '?' characters (e.g., regex patterns like '(?<=...)')
 * which would get incorrectly replaced on subsequent iterations.
 */
export function compiledQueryToSql(compiled: CompiledQuery): string {
  const sql = compiled.sql;
  const params = compiled.parameters as unknown[];

  if (params.length === 0) {
    return sql;
  }

  // Build result by finding each ? placeholder and replacing with the next param
  // We track our position to avoid replacing ? inside already-substituted values
  const result: string[] = [];
  let paramIndex = 0;
  let i = 0;

  while (i < sql.length) {
    if (sql[i] === '?' && paramIndex < params.length) {
      // Replace this placeholder with the formatted parameter value
      result.push(formatValue(params[paramIndex]));
      paramIndex++;
      i++;
    } else {
      result.push(sql[i]);
      i++;
    }
  }

  return result.join('');
}

/**
 * Format a value for SQL insertion
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (typeof value === 'string') {
    // Escape single quotes by doubling them
    return `'${value.replace(/'/g, "''")}'`;
  }
  // For other types, convert to string and quote
  return `'${String(value).replace(/'/g, "''")}'`;
}
