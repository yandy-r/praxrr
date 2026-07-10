/**
 * Config Health static catalog (issue #22).
 *
 * The canonical default per-criterion config and the human-facing criterion catalog. Pure static
 * metadata — the settings endpoint serves {@link CRITERION_CATALOG} so the client hardcodes nothing,
 * and {@link DEFAULT_CRITERIA} is the runtime fallback the settings normalizer merges stored config
 * over. The migration seed in `20260714_create_config_health_tables.ts` MUST mirror {@link DEFAULT_CRITERIA}.
 */

import type { CriterionConfig, CriterionMeta } from './types.ts';

/** Canonical default criteria config for a fresh install. Migration seed mirrors this exactly. */
export const DEFAULT_CRITERIA: readonly CriterionConfig[] = [
  { id: 'completeness', enabled: true, weight: 30 },
  { id: 'drift', enabled: true, weight: 30 },
  { id: 'coherence', enabled: true, weight: 20 },
  { id: 'compatibility', enabled: true, weight: 20 },
  { id: 'trash_alignment', enabled: false, weight: 0 }
] as const;

/** Human-facing catalog (id/label/description), served by the settings endpoint. */
export const CRITERION_CATALOG: readonly CriterionMeta[] = [
  {
    id: 'completeness',
    label: 'Completeness',
    description: 'How much of the recommended custom-format set is assigned, plus upgrade-cutoff and enabled-quality coverage.'
  },
  {
    id: 'drift',
    label: 'Drift',
    description: 'Whether the live Arr configuration still matches the desired state, using drift detection results.'
  },
  {
    id: 'coherence',
    label: 'Coherence',
    description: "Internal consistency of each quality profile's score thresholds and custom-format scores."
  },
  {
    id: 'compatibility',
    label: 'Compatibility',
    description: 'Whether quality profiles and the detected app version are compatible with this Arr type.'
  },
  {
    id: 'trash_alignment',
    label: 'TRaSH Alignment',
    description:
      'Instance-level overlap between the custom formats you opted into from a linked TRaSH source and those actually assigned across your quality profiles. Optional and disabled by default.'
  }
] as const;
