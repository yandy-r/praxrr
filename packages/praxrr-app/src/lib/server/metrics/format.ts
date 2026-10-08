/**
 * Prometheus exposition format (0.0.4) helpers for /api/v1/metrics.
 */

export function escapeLabelValue(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(',')}}`;
}

/** One rendered sample line: `name{labels} value`. */
export function sample(name: string, labels: Record<string, string>, value: number | string): string {
  return `${name}${formatLabels(labels)} ${value}`;
}

/** `# HELP` + `# TYPE` header block for a metric family. */
export function header(name: string, help: string, type: 'counter' | 'gauge' | 'histogram'): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}`;
}
