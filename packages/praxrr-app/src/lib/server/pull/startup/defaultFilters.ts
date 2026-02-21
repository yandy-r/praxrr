import type { StartupPullArrType, StartupPullSection } from './types.ts';
import {
  DEFAULT_FILTERABLE_STARTUP_SECTIONS,
  getStartupDefaultCatalog,
  type StartupDefaultCatalogRule,
  type StartupDefaultConfidence,
  type StartupDefaultFieldCriterion,
} from './defaultCatalogs.ts';

export interface StartupDefaultFilterDecision {
  readonly skip: boolean;
  readonly confidence: StartupDefaultConfidence | null;
  readonly reason: string | null;
}

export function shouldSkipStartupDefault(
  arrType: StartupPullArrType,
  section: StartupPullSection,
  remoteEntity: unknown
): StartupDefaultFilterDecision {
  if (!isDefaultFilterableSection(section)) {
    return {
      skip: false,
      confidence: null,
      reason: null,
    };
  }

  if (!isRecord(remoteEntity)) {
    return {
      skip: true,
      confidence: 'uncertain',
      reason: `Cannot evaluate startup default policy for ${section}; entity payload is not an object`,
    };
  }

  const catalog = getStartupDefaultCatalog(arrType, section);
  if (catalog.length === 0) {
    return {
      skip: false,
      confidence: null,
      reason: null,
    };
  }

  let hasUncertainUnknown = false;

  for (const rule of catalog) {
    const match = matchesRule(remoteEntity, rule);

    if (match === 'match') {
      return {
        skip: true,
        confidence: rule.confidence,
        reason: rule.reason,
      };
    }

    if (match === 'unknown' && rule.confidence === 'uncertain') {
      hasUncertainUnknown = true;
    }
  }

  if (hasUncertainUnknown) {
    return {
      skip: true,
      confidence: 'uncertain',
      reason: `Default classification for ${section} was uncertain for ${arrType}; skipping by policy`,
    };
  }

  return {
    skip: false,
    confidence: null,
    reason: null,
  };
}

export function isDefaultFilterableSection(section: StartupPullSection): boolean {
  return DEFAULT_FILTERABLE_STARTUP_SECTIONS.includes(section);
}

function matchesRule(entity: Record<string, unknown>, rule: StartupDefaultCatalogRule): 'match' | 'nomatch' | 'unknown' {
  if (rule.kind === 'ids') {
    const rawId = entity.id;
    if (typeof rawId !== 'number' || !Number.isInteger(rawId)) {
      return 'unknown';
    }

    return rule.ids.includes(rawId) ? 'match' : 'nomatch';
  }

  if (rule.kind === 'names') {
    if (typeof entity.name !== 'string') {
      return 'unknown';
    }

    const normalizedTarget = normalizeName(entity.name);
    if (normalizedTarget === null) {
      return 'nomatch';
    }

    const shouldMatch = rule.caseSensitive
      ? new Set(rule.names).has(entity.name)
      : new Set(
          rule.names
            .map((value) => normalizeName(value))
            .filter((value): value is string => value !== null)
        ).has(normalizedTarget);

    return shouldMatch ? 'match' : 'nomatch';
  }

  let hasUnknown = false;

  for (const criterion of rule.criteria) {
    const criterionMatch = matchesFieldCriterion(entity, criterion);

    if (criterionMatch === 'nomatch') {
      return 'nomatch';
    }

    if (criterionMatch === 'unknown') {
      hasUnknown = true;
    }
  }

  return hasUnknown ? 'unknown' : 'match';
}

function matchesFieldCriterion(entity: Record<string, unknown>, criterion: StartupDefaultFieldCriterion): 'match' | 'nomatch' | 'unknown' {
  const rawValue = entity[criterion.field];

  if (criterion.comparator === 'eq') {
    if (criterion.value === undefined) {
      return rawValue === undefined ? 'unknown' : 'nomatch';
    }

    return rawValue === criterion.value ? 'match' : 'nomatch';
  }

  if (criterion.comparator === 'is-empty-array') {
    if (rawValue === null || rawValue === undefined) {
      return 'match';
    }

    return Array.isArray(rawValue) && rawValue.length === 0 ? 'match' : 'nomatch';
  }

  return 'nomatch';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeName(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
