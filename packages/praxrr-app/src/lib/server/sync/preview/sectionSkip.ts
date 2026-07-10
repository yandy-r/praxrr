import type { SyncPreviewSection } from './types.ts';

/**
 * Internal control signal for an intentionally non-applicable preview section.
 *
 * This is distinct from a preview failure: callers explicitly selected the section, but its
 * effective transient configuration contains no entity to compare or prepare for execution.
 */
export class SyncPreviewSectionSkipped extends Error {
  constructor(
    readonly section: SyncPreviewSection,
    message: string
  ) {
    super(message);
    this.name = 'SyncPreviewSectionSkipped';
  }
}
