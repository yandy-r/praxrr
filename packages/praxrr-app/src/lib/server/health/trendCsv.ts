import { escapeCsvCell } from '$utils/export/csv.ts';
import type { ConfigHealthTrendResult } from './trends.ts';

const CSV_COLUMNS = [
  'snapshotId',
  'generatedAt',
  'engineVersion',
  'scopeKind',
  'profileName',
  'state',
  'score',
  'band',
  'criteria',
] as const;

function csvCell(value: string | number | null): string {
  return escapeCsvCell(value === null ? '' : String(value));
}

/** Serialize one canonical Config Health trend point per CSV row without changing its order. */
export function toConfigHealthTrendCsv(result: ConfigHealthTrendResult): string {
  const profileName = result.normalizedFilter.profile;
  const scopeKind = profileName === null ? 'overall' : 'profile';
  const rows = [CSV_COLUMNS.map(escapeCsvCell).join(',')];

  for (const point of result.points) {
    rows.push(
      [
        point.snapshotId,
        point.generatedAt,
        point.engineVersion,
        scopeKind,
        profileName,
        point.state,
        point.score,
        point.band,
        JSON.stringify(point.criteria),
      ]
        .map(csvCell)
        .join(',')
    );
  }

  return rows.join('\r\n');
}
