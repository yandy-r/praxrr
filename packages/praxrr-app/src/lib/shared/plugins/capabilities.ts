/**
 * Plugin capability catalog + least-privilege capability<->extension-point policy (issue #35, Phase-1).
 *
 * The single source of the capability<->point map. Every catalog entry is observe-only and
 * credential-free (`{ mutates: false, touchesSecrets: false }`) — the deny-by-construction model
 * means no credential/auth/secret/network/fs/db/write capability is even representable. PURE: no I/O,
 * no `Deno.env`, client + server safe. Deliberately does NOT import `extensionPoints.ts` (a
 * `requiredCapability` reference there is a plain `CapabilityId` literal), keeping the contract
 * cycle-free.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md (Pinned Capability <-> Extension-Point Mapping).
 */

import type { CapabilityId, ExtensionPointId } from './types.ts';

/** Every capability id, in stable order. */
export const CAPABILITY_IDS: readonly CapabilityId[] = [
  'read:resolved-profile',
  'read:sync-preview',
  'read:custom-format',
  'read:config-validation',
] as const;

/**
 * Static metadata for one grantable capability. `mutates` and `touchesSecrets` are pinned to the
 * `false` literal (not widened to `boolean`) via the explicit annotation on {@link CAPABILITY_CATALOG},
 * so the deny-by-construction invariant is expressed in the type.
 */
export interface CapabilityDescriptor {
  readonly id: CapabilityId;
  readonly label: string;
  readonly description: string;
  readonly mutates: false;
  readonly touchesSecrets: false;
  /** The declared extension points that may legitimately consume this capability (pinned decision #4). */
  readonly compatiblePoints: readonly ExtensionPointId[];
}

/**
 * The capability catalog with the PINNED capability<->point map. The explicit
 * `: readonly CapabilityDescriptor[]` annotation preserves the `false` literals (avoids widening to
 * `boolean`). No read capability lists a mutating/transform point — a plugin cannot gain read data
 * via a mutating point.
 */
export const CAPABILITY_CATALOG: readonly CapabilityDescriptor[] = [
  {
    id: 'read:resolved-profile',
    label: 'Read resolved profile',
    description:
      'Observe a redacted, structured-clone-safe snapshot of a freshly compiled quality/custom-format profile.',
    mutates: false,
    touchesSecrets: false,
    compatiblePoints: ['config.profileCompiled.observe'],
  },
  {
    id: 'read:sync-preview',
    label: 'Read sync preview',
    description: 'Observe a redacted sync-preview/intent/summary snapshot; never mutates the preview or apply.',
    mutates: false,
    touchesSecrets: false,
    compatiblePoints: ['sync.previewComputed.observe', 'sync.beforeApply.observe', 'sync.afterApply.observe'],
  },
  {
    id: 'read:custom-format',
    label: 'Read custom format',
    description: 'Observe a redacted custom-format condition snapshot for evaluation.',
    mutates: false,
    touchesSecrets: false,
    compatiblePoints: ['customFormat.condition.evaluate'],
  },
  {
    id: 'read:config-validation',
    label: 'Read config validation',
    description: 'Observe a redacted config-validation result snapshot.',
    mutates: false,
    touchesSecrets: false,
    compatiblePoints: ['config.validation.observe'],
  },
];

/** Look up a capability descriptor by id; `undefined` for any id outside the catalog (fail-closed). */
export function getCapability(id: string): CapabilityDescriptor | undefined {
  return CAPABILITY_CATALOG.find((capability) => capability.id === id);
}

/**
 * The single least-privilege predicate: `true` only when the given point is one the capability may
 * legitimately consume. Sole source of the capability<->point map (used by the validator and host).
 */
export function checkCapabilityGrant(point: ExtensionPointId, capability: CapabilityId): boolean {
  return getCapability(capability)?.compatiblePoints.includes(point) ?? false;
}
