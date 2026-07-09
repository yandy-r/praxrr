/**
 * Transparent Automation Engine — narration contracts (issue #21).
 *
 * A pure, versioned rendering layer that turns the decision records other features have
 * already computed (sync-preview `EntityChange`/`FieldChange`, drift `DriftEntityChange`)
 * into human-readable "show its work" lines. This module holds only contracts — no logic,
 * no I/O, no imports of runtime code — so it is safe to import from client and server alike.
 */

/**
 * Stamped onto every {@link NarrationLine}. Bump when phrasing changes so consumers can tell
 * narration produced by different template generations apart. Declared here ONCE; every other
 * narration module imports it rather than re-declaring it.
 */
export const NARRATION_TEMPLATE_VERSION = '3';

/** Summary shows only the headline; verbose adds the per-field/per-category detail lines. */
export type NarrationLevel = 'summary' | 'verbose';

/** Presentation hint consumed by the renderer; maps to the existing drift/preview palette. */
export type NarrationTone = 'neutral' | 'info' | 'warning' | 'danger';

/**
 * The unit of narration. `headline` is the always-shown decision sentence; `detail` lines
 * render only in verbose mode. `templateVersion` is always {@link NARRATION_TEMPLATE_VERSION}.
 */
export interface NarrationLine {
  readonly headline: string;
  readonly detail: readonly string[];
  readonly tone: NarrationTone;
  readonly templateVersion: string;
}
