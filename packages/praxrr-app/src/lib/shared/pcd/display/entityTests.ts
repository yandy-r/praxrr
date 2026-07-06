import type { TestEntitiesRow, TestReleasesRow } from '../types.ts';

/** Test release with parsed arrays (JSON strings -> string[]) */
export type TestRelease = Omit<
  TestReleasesRow,
  'entity_type' | 'entity_tmdb_id' | 'languages' | 'indexers' | 'flags' | 'created_at' | 'updated_at'
> & {
  languages: string[];
  indexers: string[];
  flags: string[];
};

/** Test entity with nested releases */
export type TestEntity = Omit<TestEntitiesRow, 'created_at' | 'updated_at'> & {
  releases: TestRelease[];
};
