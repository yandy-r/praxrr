import type { components } from '$api/v1.d.ts';
import { NODE_META } from './nodeStyles.ts';

/**
 * Human-readable cascade summaries derived from a dependency-impact payload, for the
 * CF/regex editors' delete-confirmation copy and "Used by" headings. Pure string helpers;
 * no Svelte, no fetch.
 */

type GraphImpactResponse = components['schemas']['GraphImpactResponse'];
type GraphNodeKind = components['schemas']['GraphNodeKind'];

function pluralize(count: number, label: string): string {
  return count === 1 ? `1 ${label.toLowerCase()}` : `${count} ${label.toLowerCase()}s`;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** "3 quality profiles and 1 custom format" from the impact's per-kind counts. */
function kindPhrase(impact: GraphImpactResponse): string {
  const parts: string[] = [];
  for (const [kind, count] of Object.entries(impact.counts)) {
    if (kind === 'total') continue;
    const meta = NODE_META[kind as GraphNodeKind];
    parts.push(pluralize(count, meta ? meta.label : kind));
  }
  return joinAnd(parts);
}

/** "radarr: 2, sonarr: 1" — distinct referencing/referenced entities per arr scope. */
function arrPhrase(impact: GraphImpactResponse): string {
  const useFrom = impact.direction === 'dependents';
  const perArr = new Map<string, Set<string>>();
  for (const [arrType, edges] of Object.entries(impact.byArrType)) {
    const names = new Set<string>();
    for (const edge of edges) {
      const ref = useFrom ? edge.from : edge.to;
      names.add(`${ref.kind}:${ref.name}`);
    }
    perArr.set(arrType, names);
  }
  const parts = [...perArr.entries()]
    .filter(([, names]) => names.size > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([arrType, names]) => `${arrType}: ${names.size}`);
  return parts.join(', ');
}

/** One-line "used by" summary, e.g. "Used by 3 quality profiles (radarr: 2, sonarr: 1)". */
export function formatImpactSummary(impact: GraphImpactResponse | null | undefined): string {
  if (!impact || !impact.hasDownstream) {
    return 'Not referenced by any other entity.';
  }
  const kinds = kindPhrase(impact);
  const arrs = arrPhrase(impact);
  return arrs ? `Used by ${kinds} (${arrs}).` : `Used by ${kinds}.`;
}

/**
 * Cascade warning for a destructive action, e.g.
 * "Scored by 3 quality profiles (radarr: 2, sonarr: 1). Deleting this custom format
 * removes those scores." Falls back to a safe message when nothing depends on the entity.
 */
export function formatCascadeSummary(
  impact: GraphImpactResponse | null | undefined,
  options: { verb?: string; entityLabel?: string; effect?: string } = {}
): string {
  const verb = options.verb ?? 'Deleting';
  const entityLabel = options.entityLabel ?? 'this entity';
  const effect = options.effect ?? 'affects them';
  if (!impact || !impact.hasDownstream) {
    return `Nothing else depends on ${entityLabel}.`;
  }
  const kinds = kindPhrase(impact);
  const arrs = arrPhrase(impact);
  const usedBy = arrs ? `Used by ${kinds} (${arrs}).` : `Used by ${kinds}.`;
  return `${usedBy} ${verb} ${entityLabel} ${effect}.`;
}
