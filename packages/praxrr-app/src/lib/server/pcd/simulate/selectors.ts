/**
 * Shared request-input helpers for the simulate routes (score + impact).
 *
 * Kept in one place so the score simulator and impact simulator agree on
 * `arrType`/release-type validation and on how a quality-profile selector
 * (`name` | `pcd:name` | `trash:<sourceId>:<name>`) is decoded.
 */

import { error } from '@sveltejs/kit';

export type SimulateArrType = 'radarr' | 'sonarr';

export function isArrType(value: string): value is SimulateArrType {
  return value === 'radarr' || value === 'sonarr';
}

export function isReleaseType(value: unknown): value is 'movie' | 'series' {
  return value === 'movie' || value === 'series';
}

export type ProfileSelector = { kind: 'pcd'; name: string } | { kind: 'trash'; sourceId: number; name: string };

/**
 * Decode a quality-profile selector. Plain names and `pcd:`-prefixed names map to
 * PCD profiles; `trash:<sourceId>:<name>` maps to a TRaSH-sourced profile. Throws
 * a 400 on a malformed `trash:` selector.
 */
export function parseProfileSelector(selector: string): ProfileSelector {
  if (selector.startsWith('pcd:')) {
    return { kind: 'pcd', name: decodeURIComponent(selector.slice(4)) };
  }

  if (selector.startsWith('trash:')) {
    const match = /^trash:(\d+):(.*)$/.exec(selector);
    if (!match) {
      throw error(400, `Invalid trash profile selector format: "${selector}". Expected "trash:<sourceId>:<name>"`);
    }

    return {
      kind: 'trash',
      sourceId: Number.parseInt(match[1], 10),
      name: decodeURIComponent(match[2]),
    };
  }

  // Backward compatibility with plain profile names.
  return { kind: 'pcd', name: selector };
}
