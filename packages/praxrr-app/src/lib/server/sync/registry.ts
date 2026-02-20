/**
 * Section registry for sync processing
 * Reduces code duplication by providing a generic interface for all sync section types
 */

import type { SectionType, SectionHandler, ScheduledConfig } from './types.ts';

export type { SectionType, SectionHandler, ScheduledConfig };

// Type-safe registry
const sectionRegistry = new Map<SectionType, SectionHandler>();

function dedupeSectionTypes(sectionTypes: SectionType[]): SectionType[] {
  const seen = new Set<SectionType>();
  const result: SectionType[] = [];

  for (const sectionType of sectionTypes) {
    if (seen.has(sectionType)) {
      continue;
    }

    seen.add(sectionType);
    result.push(sectionType);
  }

  return result;
}

function assertKnownSection(sectionType: SectionType): void {
  if (!sectionRegistry.has(sectionType)) {
    throw new Error(`Unknown section type: ${sectionType}`);
  }
}

/**
 * Register a section handler
 */
export function registerSection(handler: SectionHandler): void {
  sectionRegistry.set(handler.type, handler);
}

/**
 * Get a section handler by type
 */
export function getSection(type: SectionType): SectionHandler {
  const handler = sectionRegistry.get(type);
  if (!handler) {
    throw new Error(`Unknown section type: ${type}`);
  }
  return handler;
}

/**
 * Return all section types that are configured for a specific instance
 */
export function getConfiguredSections(instanceId: number): SectionType[] {
  return dedupeSectionTypes(
    getAllSectionTypes().filter((sectionType) => {
      const handler = sectionRegistry.get(sectionType);
      if (!handler) {
        return false;
      }

      return handler.hasConfig(instanceId);
    })
  );
}

/**
 * Resolve section execution order for an instance, optionally filtering to
 * explicitly requested sections.
 */
export function resolveSectionsForInstance(instanceId: number, requestedSections: SectionType[] = []): SectionType[] {
  if (requestedSections.length === 0) {
    return getConfiguredSections(instanceId);
  }

  return dedupeSectionTypes(
    requestedSections.filter((sectionType) => {
      assertKnownSection(sectionType);
      const handler = sectionRegistry.get(sectionType);
      return !!handler && handler.hasConfig(instanceId);
    })
  );
}

/**
 * Check whether a section is configured for a specific instance
 */
export function hasConfiguredSection(instanceId: number, sectionType: SectionType): boolean {
  assertKnownSection(sectionType);
  const handler = sectionRegistry.get(sectionType);
  if (!handler) return false;
  return handler.hasConfig(instanceId);
}

/**
 * Get all registered section handlers
 */
export function getAllSections(): SectionHandler[] {
  return Array.from(sectionRegistry.values());
}

/**
 * Get all section types
 */
export function getAllSectionTypes(): SectionType[] {
  return Array.from(sectionRegistry.keys());
}

/**
 * Check if a section type is registered
 */
export function hasSection(type: SectionType): boolean {
  return sectionRegistry.has(type);
}
