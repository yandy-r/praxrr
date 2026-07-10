// Projection drift guard (AC6). For every portable entity family and each supported Arr mapping,
// assert that every field path the REAL diff engine (`computeUserOverrides`) emits for a
// base-vs-resolved change is covered by `collectEntityLeaves` — i.e. the projector never misses a
// serializer-emitted leaf, and its paths byte-match `diffToFieldChanges`. Pure Portable payloads;
// no cache needed.

import { assert } from '@std/assert';
import { computeUserOverrides } from '$pcd/index.ts';
import { collectEntityLeaves } from '$pcd/resolved/lineage/projection.ts';
import type { ArrAppType } from '$shared/arr/capabilities.ts';
import type { ResolvedEntityPayload, ResolvedEntityType } from '$pcd/resolved/types.ts';

function assertCoversDiff(
  label: string,
  entityType: ResolvedEntityType,
  arrType: ArrAppType | undefined,
  base: ResolvedEntityPayload,
  resolved: ResolvedEntityPayload
): void {
  const overrides = computeUserOverrides(base, resolved);
  assert(overrides.length > 0, `${label}: fixture must produce at least one diff path`);
  const leafPaths = new Set(collectEntityLeaves(entityType, arrType, resolved).map((l) => l.fieldPath));
  for (const change of overrides) {
    assert(
      leafPaths.has(change.field),
      `${label}: projector missing leaf for diff path "${change.field}"; have: ${[...leafPaths].join(', ')}`
    );
  }
}

Deno.test('projection: delayProfile covers all diff paths', () => {
  const base = { name: 'DP', preferredProtocol: 'prefer_usenet', usenetDelay: 0, torrentDelay: 0, bypassIfHighestQuality: false, bypassIfAboveCfScore: false, minimumCfScore: 0 };
  const resolved = { ...base, usenetDelay: 30, bypassIfHighestQuality: true, minimumCfScore: 5 };
  assertCoversDiff('delayProfile', 'delayProfile', undefined, base as ResolvedEntityPayload, resolved as ResolvedEntityPayload);
});

Deno.test('projection: regularExpression covers scalar + tag-array diff paths', () => {
  const base = { name: 'RE', pattern: 'a', tags: ['x'], description: null, regex101Id: null };
  const resolved = { name: 'RE', pattern: 'b', tags: ['y'], description: 'd', regex101Id: 'r' };
  assertCoversDiff('regularExpression', 'regularExpression', undefined, base as ResolvedEntityPayload, resolved as ResolvedEntityPayload);
});

Deno.test('projection: customFormat covers nested conditions, tests, tags (AC6 nested lists)', () => {
  const base = {
    name: 'CF',
    description: 'a',
    includeInRename: false,
    tags: ['t1'],
    conditions: [
      { name: 'Src', type: 'source', arrType: 'all', negate: false, required: false, sources: ['bluray'] },
      { name: 'Lang', type: 'language', arrType: 'all', negate: false, required: false, languages: [{ name: 'English', except: false }] },
      { name: 'Size', type: 'size', arrType: 'all', negate: false, required: false, size: { minBytes: 1, maxBytes: 2 } }
    ],
    tests: [{ title: 'T1', type: 'movie', shouldMatch: true, description: null }]
  };
  const resolved = {
    ...base,
    includeInRename: true,
    tags: ['t2'],
    conditions: [
      { name: 'Src', type: 'source', arrType: 'all', negate: true, required: false, sources: ['web'] },
      { name: 'Lang', type: 'language', arrType: 'all', negate: false, required: true, languages: [{ name: 'French', except: true }] },
      { name: 'Size', type: 'size', arrType: 'all', negate: false, required: false, size: { minBytes: 9, maxBytes: 2 } }
    ],
    tests: [{ title: 'T1', type: 'movie', shouldMatch: false, description: 'why' }]
  };
  assertCoversDiff('customFormat', 'customFormat', undefined, base as ResolvedEntityPayload, resolved as ResolvedEntityPayload);
});

Deno.test('projection: qualityProfile covers orderedItems (+members), customFormatScores (AC6 nested lists)', () => {
  const base = {
    name: 'QP',
    description: 'a',
    tags: ['t1'],
    language: 'English',
    orderedItems: [
      { type: 'quality', name: 'Bluray-1080p', position: 1, enabled: true, upgradeUntil: false },
      { type: 'group', name: 'WEB', position: 2, enabled: true, upgradeUntil: false, members: [{ name: 'WEBDL-1080p' }] }
    ],
    minimumScore: 0,
    upgradeUntilScore: 0,
    upgradeScoreIncrement: 1,
    customFormatScores: [{ customFormatName: 'HDR', arrType: 'radarr', score: 100 }]
  };
  const resolved = {
    ...base,
    orderedItems: [
      { type: 'quality', name: 'Bluray-1080p', position: 1, enabled: false, upgradeUntil: true },
      { type: 'group', name: 'WEB', position: 2, enabled: true, upgradeUntil: false, members: [{ name: 'WEBDL-720p' }] }
    ],
    minimumScore: 10,
    customFormatScores: [{ customFormatName: 'HDR', arrType: 'radarr', score: 250 }]
  };
  assertCoversDiff('qualityProfile', 'qualityProfile', undefined, base as ResolvedEntityPayload, resolved as ResolvedEntityPayload);
});

Deno.test('projection: naming covers each Arr mapping (radarr/sonarr/lidarr)', () => {
  const radarrBase = { name: 'N', rename: true, movieFormat: 'a', movieFolderFormat: 'b', replaceIllegalCharacters: true, colonReplacementFormat: 'smart' };
  const radarrResolved = { ...radarrBase, movieFormat: 'z', colonReplacementFormat: 'delete' };
  assertCoversDiff('radarr naming', 'naming', 'radarr', radarrBase as ResolvedEntityPayload, radarrResolved as ResolvedEntityPayload);

  const sonarrBase = { name: 'N', rename: true, standardEpisodeFormat: 'a', dailyEpisodeFormat: 'b', animeEpisodeFormat: 'c', seriesFolderFormat: 'd', seasonFolderFormat: 'e', replaceIllegalCharacters: true, colonReplacementFormat: 'smart', customColonReplacementFormat: null, multiEpisodeStyle: 'prefixedRange' };
  const sonarrResolved = { ...sonarrBase, standardEpisodeFormat: 'z', multiEpisodeStyle: 'extend' };
  assertCoversDiff('sonarr naming', 'naming', 'sonarr', sonarrBase as ResolvedEntityPayload, sonarrResolved as ResolvedEntityPayload);

  const lidarrBase = { name: 'N', rename: true, standardTrackFormat: 'a', artistName: 'b', multiDiscTrackFormat: 'c', artistFolderFormat: 'd', replaceIllegalCharacters: true, colonReplacementFormat: 'smart', customColonReplacementFormat: null };
  const lidarrResolved = { ...lidarrBase, artistName: 'z', rename: false };
  assertCoversDiff('lidarr naming', 'naming', 'lidarr', lidarrBase as ResolvedEntityPayload, lidarrResolved as ResolvedEntityPayload);
});

Deno.test('projection: mediaSettings covers each Arr mapping', () => {
  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const base = { name: 'MS', propersRepacks: 'doNotPrefer', enableMediaInfo: true };
    const resolved = { ...base, propersRepacks: 'preferAndUpgrade', enableMediaInfo: false };
    assertCoversDiff(`${arrType} mediaSettings`, 'mediaSettings', arrType, base as ResolvedEntityPayload, resolved as ResolvedEntityPayload);
  }
});

Deno.test('projection: qualityDefinitions covers entries for each Arr mapping (AC6 nested lists)', () => {
  for (const arrType of ['radarr', 'sonarr', 'lidarr'] as const) {
    const base = { name: 'QD', entries: [{ quality_name: 'WEBDL-1080p', min_size: 0, max_size: 100, preferred_size: 50 }] };
    const resolved = { name: 'QD', entries: [{ quality_name: 'WEBDL-1080p', min_size: 5, max_size: 100, preferred_size: 80 }] };
    assertCoversDiff(`${arrType} qualityDefinitions`, 'qualityDefinitions', arrType, base as ResolvedEntityPayload, resolved as ResolvedEntityPayload);
  }
});

Deno.test('projection: lidarrMetadataProfile covers primary/secondary/release type arrays (AC6 nested lists)', () => {
  const base = {
    name: 'MP',
    description: 'a',
    primaryTypes: [{ id: 0, name: 'Album', allowed: true }],
    secondaryTypes: [{ id: 0, name: 'Studio', allowed: true }],
    releaseStatuses: [{ id: 0, name: 'Official', allowed: true }]
  };
  const resolved = {
    ...base,
    primaryTypes: [{ id: 0, name: 'Album', allowed: false }],
    secondaryTypes: [{ id: 0, name: 'Studio', allowed: false }],
    releaseStatuses: [{ id: 0, name: 'Official', allowed: false }]
  };
  assertCoversDiff('lidarrMetadataProfile', 'lidarrMetadataProfile', 'lidarr', base as ResolvedEntityPayload, resolved as ResolvedEntityPayload);
});
