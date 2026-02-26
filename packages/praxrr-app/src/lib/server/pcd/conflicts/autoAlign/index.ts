import type { Database } from '@jsr/db__sqlite';
import { defaultFieldGuardRule } from './rules/defaultFieldGuard.ts';
import { missingTargetDeleteRule } from './rules/missingTargetDelete.ts';
import { qualityProfileQualitiesRowRule } from './rules/qualityProfileQualitiesRow.ts';
import { qualityProfileScoringRowRule } from './rules/qualityProfileScoringRow.ts';
import type { AutoAlignDecision, ConflictStrategy, DeleteRule, ParsedOpMetadata, UpdateRule } from './types.ts';

const UPDATE_RULES: UpdateRule[] = [
  qualityProfileQualitiesRowRule,
  qualityProfileScoringRowRule,
  defaultFieldGuardRule,
];

const DELETE_RULES: DeleteRule[] = [missingTargetDeleteRule];

/**
 * Evaluate whether a conflicting user op should be automatically aligned based on the configured strategy.
 *
 * Applies the `force_align_strategy` shortcut when the strategy is `'align'`, then delegates to
 * registered delete/update rules to determine if auto-alignment is appropriate.
 *
 * @param input.db - In-memory PCD cache database
 * @param input.conflictStrategy - Configured conflict resolution strategy for the database
 * @param input.metadata - Parsed op metadata, or null if unavailable
 * @param input.desiredState - Parsed desired state object, or null if unavailable
 * @returns Decision object indicating whether to align and the matching rule/reason
 */
export function evaluateAutoAlign(input: {
  db: Database;
  conflictStrategy: ConflictStrategy;
  metadata: ParsedOpMetadata | null;
  desiredState: Record<string, unknown> | null;
}): AutoAlignDecision {
  if (input.conflictStrategy === 'align') {
    return {
      shouldAlign: true,
      reason: 'forced',
      rule: 'force_align_strategy',
    };
  }

  if (input.metadata?.operation === 'delete') {
    const ctx = {
      db: input.db,
      entityName: input.metadata.entity,
      metadata: input.metadata,
    };
    for (const rule of DELETE_RULES) {
      if (!rule.matches(ctx)) continue;
      if (rule.shouldAlign(ctx)) {
        return { shouldAlign: true, reason: 'auto_delete', rule: rule.name };
      }
    }
  }

  if (input.metadata?.operation === 'update') {
    const ctx = {
      db: input.db,
      entityName: input.metadata.entity,
      metadata: input.metadata,
      desiredState: input.desiredState,
    };
    for (const rule of UPDATE_RULES) {
      if (!rule.matches(ctx)) continue;
      if (rule.shouldAlign(ctx)) {
        return { shouldAlign: true, reason: 'auto_update', rule: rule.name };
      }
    }
  }

  return { shouldAlign: false, reason: 'none' };
}

/**
 * Parse raw op metadata JSON into a structured `ParsedOpMetadata` object.
 *
 * @param raw - Raw JSON string from the `metadata` column, or null
 * @returns Parsed metadata object, or null if the input is empty or unparseable
 */
export function parseOpMetadata(raw: string | null): ParsedOpMetadata | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedOpMetadata;
  } catch {
    return null;
  }
}

/**
 * Parse raw desired-state JSON into an untyped record.
 *
 * @param raw - Raw JSON string from the `desired_state` column, or null
 * @returns Parsed record, or null if the input is empty or unparseable
 */
export function parseDesiredState(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type { AutoAlignDecision, ConflictStrategy, ParsedOpMetadata } from './types.ts';
