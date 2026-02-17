/**
 * Shared filter types for both backend and frontend
 * Defines all available filter fields for upgrade filtering
 */

import { uuid } from '../utils/uuid.ts';

export interface FilterOperator {
  id: string;
  label: string;
  description?: string;
}

export type FilterValueType = string | number | boolean | null;

export interface FilterValue {
  value: FilterValueType;
  label: string;
}

export interface FilterField {
  id: string;
  label: string;
  description: string;
  operators: FilterOperator[];
  valueType: 'boolean' | 'select' | 'text' | 'number' | 'date';
  values?: FilterValue[];
}

export interface FilterRule {
  type: 'rule';
  field: string;
  operator: string;
  value: FilterValueType;
}

export interface FilterGroup {
  type: 'group';
  match: 'all' | 'any';
  children: (FilterRule | FilterGroup)[];
}

export interface FilterConfig {
  id: string;
  name: string;
  enabled: boolean;
  group: FilterGroup;
  selector: string;
  count: number;
  cutoff: number;
  // Cooldown is handled via filter-level tags (praxrr-{filterId})
  // Future: cooldownMode?: 'basic' | 'advanced' for adaptive backoff
}

export type FilterMode = 'round_robin' | 'random';

export interface UpgradeConfig {
  id?: number;
  arrInstanceId: number;
  enabled: boolean;
  dryRun: boolean;
  schedule: number; // minutes
  filterMode: FilterMode;
  filters: FilterConfig[];
  currentFilterIndex: number;
  lastRunAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const filterModes: { id: FilterMode; label: string; description: string }[] = [
  {
    id: 'round_robin',
    label: 'Round Robin',
    description: 'Cycle through filters in order, one per run',
  },
  {
    id: 'random',
    label: 'Random Shuffle',
    description: 'Shuffle filters, cycle through all before repeating',
  },
];

/**
 * Common operator sets
 */
const booleanOperators: FilterOperator[] = [
  { id: 'is', label: 'is', description: 'Exact match' },
  { id: 'is_not', label: 'is not', description: 'Does not match' },
];

const numberOperators: FilterOperator[] = [
  { id: 'eq', label: 'equals', description: 'Exactly equals the value' },
  { id: 'neq', label: 'does not equal', description: 'Does not equal the value' },
  { id: 'gt', label: 'is greater than', description: 'Greater than the value' },
  { id: 'gte', label: 'is greater than or equal', description: 'Greater than or equal to the value' },
  { id: 'lt', label: 'is less than', description: 'Less than the value' },
  { id: 'lte', label: 'is less than or equal', description: 'Less than or equal to the value' },
];

const textOperators: FilterOperator[] = [
  { id: 'contains', label: 'contains', description: 'Contains the text (case-insensitive)' },
  { id: 'not_contains', label: 'does not contain', description: 'Does not contain the text' },
  { id: 'starts_with', label: 'starts with', description: 'Starts with the text' },
  { id: 'ends_with', label: 'ends with', description: 'Ends with the text' },
  { id: 'eq', label: 'equals', description: 'Exactly equals the text (case-insensitive)' },
  { id: 'neq', label: 'does not equal', description: 'Does not equal the text' },
];

const dateOperators: FilterOperator[] = [
  { id: 'before', label: 'is before', description: 'The date is before the specified date' },
  { id: 'after', label: 'is after', description: 'The date is after the specified date' },
  { id: 'in_last', label: 'in the last', description: 'Within the last N days' },
  { id: 'not_in_last', label: 'not in the last', description: 'Not within the last N days' },
];

const ordinalOperators: FilterOperator[] = [
  { id: 'eq', label: 'is exactly', description: 'Exactly matches the status' },
  { id: 'neq', label: 'is not', description: 'Does not match the status' },
  { id: 'gte', label: 'has reached', description: 'Has reached this status or further in the progression' },
  { id: 'lte', label: "hasn't passed", description: 'Has not passed this status in the progression' },
  { id: 'gt', label: 'is past', description: 'Is past this status (further along)' },
  { id: 'lt', label: 'is before', description: 'Is before this status (not yet reached)' },
];

/**
 * Ordinal value mappings for ordered select fields
 * Higher number = further along in the progression
 */
export const availabilityOrder: Record<string, number> = {
  tba: 0,
  announced: 1,
  inCinemas: 2,
  released: 3,
};

/**
 * All available filter fields
 */
export const filterFields: FilterField[] = [
  // Boolean fields
  {
    id: 'monitored',
    label: 'Monitored',
    description: 'Whether the item is being monitored for upgrades',
    operators: booleanOperators,
    valueType: 'boolean',
    values: [
      { value: true, label: 'True' },
      { value: false, label: 'False' },
    ],
  },
  {
    id: 'cutoff_met',
    label: 'Cutoff Met',
    description: "Whether the item's quality score meets the filter's cutoff percentage",
    operators: booleanOperators,
    valueType: 'boolean',
    values: [
      { value: true, label: 'True' },
      { value: false, label: 'False' },
    ],
  },

  // Ordinal fields (ordered select values)
  {
    id: 'minimum_availability',
    label: 'Minimum Availability',
    description: 'The minimum availability status set in Radarr. Progresses: TBA → Announced → In Cinemas → Released',
    operators: ordinalOperators,
    valueType: 'select',
    values: [
      { value: 'tba', label: 'TBA' },
      { value: 'announced', label: 'Announced' },
      { value: 'inCinemas', label: 'In Cinemas' },
      { value: 'released', label: 'Released' },
    ],
  },

  // Text fields
  {
    id: 'title',
    label: 'Title',
    description: 'The title of the movie',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'quality_profile',
    label: 'Quality Profile',
    description: 'The assigned quality profile name',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'collection',
    label: 'Collection',
    description: 'The collection the movie belongs to (e.g., "Marvel Cinematic Universe")',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'The production studio',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'original_language',
    label: 'Original Language',
    description: 'The original language of the movie (e.g., "en", "ja")',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'genres',
    label: 'Genres',
    description: 'Movie genres (Action, Comedy, Drama, etc.)',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'keywords',
    label: 'Keywords',
    description: 'TMDb keywords associated with the movie',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'release_group',
    label: 'Release Group',
    description: 'The release group of the current file',
    operators: textOperators,
    valueType: 'text',
  },
  {
    id: 'tags',
    label: 'Tags',
    description: 'Tags applied to the item',
    operators: textOperators,
    valueType: 'text',
  },

  // Number fields
  {
    id: 'year',
    label: 'Year',
    description: 'The release year',
    operators: numberOperators,
    valueType: 'number',
  },
  {
    id: 'popularity',
    label: 'Popularity',
    description: 'TMDb popularity score',
    operators: numberOperators,
    valueType: 'number',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    description: 'Movie runtime in minutes',
    operators: numberOperators,
    valueType: 'number',
  },
  {
    id: 'size_on_disk',
    label: 'Size on Disk',
    description: 'Current file size in GB',
    operators: numberOperators,
    valueType: 'number',
  },
  {
    id: 'tmdb_rating',
    label: 'TMDb Rating',
    description: 'TMDb rating (0-10)',
    operators: numberOperators,
    valueType: 'number',
  },
  {
    id: 'imdb_rating',
    label: 'IMDb Rating',
    description: 'IMDb rating (0-10)',
    operators: numberOperators,
    valueType: 'number',
  },
  {
    id: 'tomato_rating',
    label: 'Rotten Tomatoes',
    description: 'Rotten Tomatoes score (0-100)',
    operators: numberOperators,
    valueType: 'number',
  },
  {
    id: 'trakt_rating',
    label: 'Trakt Rating',
    description: 'Trakt rating (0-100)',
    operators: numberOperators,
    valueType: 'number',
  },

  // Date fields
  {
    id: 'date_added',
    label: 'Date Added',
    description: 'When the movie was added to your library',
    operators: dateOperators,
    valueType: 'date',
  },
  {
    id: 'digital_release',
    label: 'Digital Release',
    description: 'The digital release date from TMDb',
    operators: dateOperators,
    valueType: 'date',
  },
  {
    id: 'physical_release',
    label: 'Physical Release',
    description: 'The physical release date from TMDb',
    operators: dateOperators,
    valueType: 'date',
  },
];

/**
 * Get a filter field by ID
 */
export function getFilterField(id: string): FilterField | undefined {
  return filterFields.find((f) => f.id === id);
}

/**
 * Get all filter field IDs
 */
export function getAllFilterFieldIds(): string[] {
  return filterFields.map((f) => f.id);
}

/**
 * Validate if a filter field ID exists
 */
export function isValidFilterField(id: string): boolean {
  return filterFields.some((f) => f.id === id);
}

/**
 * Create an empty filter group
 */
export function createEmptyGroup(): FilterGroup {
  return {
    type: 'group',
    match: 'all',
    children: [],
  };
}

/**
 * Create a default filter group with upgradinatorr-style rules:
 * - monitored is true
 * - minimum_availability has reached released
 */
export function createDefaultGroup(): FilterGroup {
  return {
    type: 'group',
    match: 'all',
    children: [
      {
        type: 'rule',
        field: 'monitored',
        operator: 'is',
        value: true,
      },
      {
        type: 'rule',
        field: 'minimum_availability',
        operator: 'gte',
        value: 'released',
      },
    ],
  };
}

/**
 * Create a filter config with sensible defaults (upgradinatorr-style)
 */
export function createEmptyFilterConfig(name: string = 'New Filter'): FilterConfig {
  return {
    id: uuid(),
    name,
    enabled: true,
    group: createDefaultGroup(),
    selector: 'random',
    count: 2,
    cutoff: 100,
  };
}

/**
 * Create an empty upgrade config for an arr instance
 */
export function createEmptyUpgradeConfig(arrInstanceId: number): UpgradeConfig {
  return {
    arrInstanceId,
    enabled: false,
    dryRun: false,
    schedule: 360, // 6 hours
    filterMode: 'round_robin',
    filters: [],
    currentFilterIndex: 0,
  };
}

/**
 * Create an empty filter rule with defaults
 */
export function createEmptyRule(): FilterRule {
  const firstField = filterFields[0];
  return {
    type: 'rule',
    field: firstField.id,
    operator: firstField.operators[0].id,
    value: firstField.values?.[0]?.value ?? null,
  };
}

/**
 * Check if a child is a rule
 */
export function isRule(child: FilterRule | FilterGroup): child is FilterRule {
  return child.type === 'rule';
}

/**
 * Check if a child is a group
 */
export function isGroup(child: FilterRule | FilterGroup): child is FilterGroup {
  return child.type === 'group';
}

/**
 * Evaluate a single filter rule against an item
 */
export function evaluateRule(item: Record<string, unknown>, rule: FilterRule): boolean {
  const fieldValue = item[rule.field];
  const ruleValue = rule.value;

  // Handle null/undefined field values
  if (fieldValue === null || fieldValue === undefined) {
    // For 'is_not' or negation operators, null means "not equal" so return true
    if (['is_not', 'neq', 'not_contains'].includes(rule.operator)) {
      return true;
    }
    return false;
  }

  switch (rule.operator) {
    // Boolean operators
    case 'is':
      return fieldValue === ruleValue;
    case 'is_not':
      return fieldValue !== ruleValue;

    // Number operators
    case 'eq':
      if (typeof fieldValue === 'string' && typeof ruleValue === 'string') {
        return fieldValue.toLowerCase() === ruleValue.toLowerCase();
      }
      return fieldValue === ruleValue;
    case 'neq':
      if (typeof fieldValue === 'string' && typeof ruleValue === 'string') {
        return fieldValue.toLowerCase() !== ruleValue.toLowerCase();
      }
      return fieldValue !== ruleValue;
    // Text operators (case-insensitive)
    case 'contains': {
      const strField = String(fieldValue).toLowerCase();
      const strRule = String(ruleValue).toLowerCase();
      return strField.includes(strRule);
    }
    case 'not_contains': {
      const strField = String(fieldValue).toLowerCase();
      const strRule = String(ruleValue).toLowerCase();
      return !strField.includes(strRule);
    }
    case 'starts_with': {
      const strField = String(fieldValue).toLowerCase();
      const strRule = String(ruleValue).toLowerCase();
      return strField.startsWith(strRule);
    }
    case 'ends_with': {
      const strField = String(fieldValue).toLowerCase();
      const strRule = String(ruleValue).toLowerCase();
      return strField.endsWith(strRule);
    }

    // Ordinal operators (for fields like minimum_availability)
    case 'gte': {
      // Check if this is an ordinal field
      if (rule.field === 'minimum_availability') {
        const fieldOrdinal = availabilityOrder[fieldValue as string] ?? -1;
        const ruleOrdinal = availabilityOrder[ruleValue as string] ?? -1;
        return fieldOrdinal >= ruleOrdinal;
      }
      // Fall through to number comparison
      return typeof fieldValue === 'number' && typeof ruleValue === 'number' && fieldValue >= ruleValue;
    }
    case 'lte': {
      if (rule.field === 'minimum_availability') {
        const fieldOrdinal = availabilityOrder[fieldValue as string] ?? -1;
        const ruleOrdinal = availabilityOrder[ruleValue as string] ?? -1;
        return fieldOrdinal <= ruleOrdinal;
      }
      return typeof fieldValue === 'number' && typeof ruleValue === 'number' && fieldValue <= ruleValue;
    }
    case 'gt': {
      if (rule.field === 'minimum_availability') {
        const fieldOrdinal = availabilityOrder[fieldValue as string] ?? -1;
        const ruleOrdinal = availabilityOrder[ruleValue as string] ?? -1;
        return fieldOrdinal > ruleOrdinal;
      }
      return typeof fieldValue === 'number' && typeof ruleValue === 'number' && fieldValue > ruleValue;
    }
    case 'lt': {
      if (rule.field === 'minimum_availability') {
        const fieldOrdinal = availabilityOrder[fieldValue as string] ?? -1;
        const ruleOrdinal = availabilityOrder[ruleValue as string] ?? -1;
        return fieldOrdinal < ruleOrdinal;
      }
      return typeof fieldValue === 'number' && typeof ruleValue === 'number' && fieldValue < ruleValue;
    }

    // Date operators
    case 'before': {
      const fieldDate = new Date(fieldValue as string);
      const ruleDate = new Date(ruleValue as string);
      return fieldDate < ruleDate;
    }
    case 'after': {
      const fieldDate = new Date(fieldValue as string);
      const ruleDate = new Date(ruleValue as string);
      return fieldDate > ruleDate;
    }
    case 'in_last': {
      // ruleValue is number of days/hours depending on context
      const fieldDate = new Date(fieldValue as string);
      const now = new Date();
      const diffMs = now.getTime() - fieldDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= (ruleValue as number);
    }
    case 'not_in_last': {
      const fieldDate = new Date(fieldValue as string);
      const now = new Date();
      const diffMs = now.getTime() - fieldDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays > (ruleValue as number);
    }

    default:
      return false;
  }
}

/**
 * Evaluate a filter group against an item
 * Supports nested groups with AND/OR logic
 */
export function evaluateGroup(item: Record<string, unknown>, group: FilterGroup): boolean {
  if (group.children.length === 0) {
    // Empty group matches everything
    return true;
  }

  if (group.match === 'all') {
    // AND logic: all children must match
    return group.children.every((child) => {
      if (isRule(child)) {
        return evaluateRule(item, child);
      } else {
        return evaluateGroup(item, child);
      }
    });
  } else {
    // OR logic: any child must match
    return group.children.some((child) => {
      if (isRule(child)) {
        return evaluateRule(item, child);
      } else {
        return evaluateGroup(item, child);
      }
    });
  }
}
