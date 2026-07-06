import type { ArrType, CustomFormatConditionsRow } from '../types.ts';

/** Condition reference for display (minimal info) */
export type ConditionRef = Pick<CustomFormatConditionsRow, 'name' | 'type' | 'required' | 'negate'>;

/** Condition item for list display */
export type ConditionListItem = ConditionRef;

/** Full condition data for evaluation and editing (assembled from multiple tables) */
export interface ConditionData {
  name: string;
  type: string;
  arrType: ArrType | '';
  negate: boolean;
  required: boolean;
  // Type-specific data (only one populated based on `type`)
  patterns?: { name: string; pattern: string }[];
  languages?: { name: string; except: boolean }[];
  sources?: string[];
  resolutions?: string[];
  qualityModifiers?: string[];
  releaseTypes?: string[];
  indexerFlags?: string[];
  size?: { minBytes: number | null; maxBytes: number | null };
  years?: { minYear: number | null; maxYear: number | null };
}

/** Single condition evaluation result */
export interface ConditionResult {
  conditionName: string;
  conditionType: string;
  matched: boolean;
  required: boolean;
  negate: boolean;
  /** Final result after applying negate */
  passes: boolean;
  /** What the condition expected */
  expected: string;
  /** What was actually found in the parsed title */
  actual: string;
}

/** Full evaluation result of all conditions */
export interface EvaluationResult {
  /** Whether the custom format matches overall */
  matches: boolean;
  /** Individual condition results */
  conditions: ConditionResult[];
}

/** Serializable parsed info for frontend display */
export interface ParsedInfo {
  source: string;
  resolution: string;
  modifier: string;
  languages: string[];
  releaseGroup: string | null;
  year: number;
  edition: string | null;
  releaseType: string | null;
}

/** Custom format with conditions for batch evaluation */
export interface CustomFormatWithConditions {
  name: string;
  conditions: ConditionData[];
}
