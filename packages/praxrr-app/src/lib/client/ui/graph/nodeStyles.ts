import type { components } from '$api/v1.d.ts';

/**
 * Dependency-graph node presentation — the single source of truth for a node kind's label,
 * Badge variant, and editor-route builder. Mirrors `$ui/resolved/fieldChangeDisplay.ts`
 * (a plain `.ts` legend `Record` + pure helpers) and is reused by the graph page's
 * AdjacencyTable and the editors' DependencyImpact panel.
 */

type NodeKind = components['schemas']['GraphNodeKind'];

/** Subset of `$ui/badge/Badge.svelte`'s `variant` prop used for node kinds. */
type NodeBadgeVariant = 'info' | 'warning' | 'success' | 'neutral' | 'accent';

export interface NodeMeta {
  /** Human label for the kind. */
  label: string;
  /** Badge variant for the kind chip. */
  badgeVariant: NodeBadgeVariant;
  /** Editor href for a linkable node, or null for leaf kinds (`quality`, `quality_definition`). */
  editorHref: (databaseId: number | string, routeId: number | null) => string | null;
}

const noEditor = (): null => null;

export const NODE_META: Record<NodeKind, NodeMeta> = {
  custom_format: {
    label: 'Custom Format',
    badgeVariant: 'info',
    editorHref: (databaseId, routeId) => (routeId == null ? null : `/custom-formats/${databaseId}/${routeId}/general`),
  },
  regular_expression: {
    label: 'Regular Expression',
    badgeVariant: 'warning',
    editorHref: (databaseId, routeId) => (routeId == null ? null : `/regular-expressions/${databaseId}/${routeId}`),
  },
  quality_profile: {
    label: 'Quality Profile',
    badgeVariant: 'success',
    editorHref: (databaseId, routeId) =>
      routeId == null ? null : `/quality-profiles/${databaseId}/${routeId}/general`,
  },
  quality: {
    label: 'Quality',
    badgeVariant: 'neutral',
    editorHref: noEditor,
  },
  quality_definition: {
    label: 'Quality Definition',
    badgeVariant: 'accent',
    editorHref: noEditor,
  },
};

/** Editor href for a node, or null when the kind has no per-id editor route. */
export function nodeEditorHref(kind: NodeKind, databaseId: number | string, routeId: number | null): string | null {
  return NODE_META[kind].editorHref(databaseId, routeId);
}

/** `?focus=` query value that pre-selects a node on the dependency-graph page. */
export function focusParam(kind: NodeKind, name: string): string {
  return `${kind}:${name}`;
}
