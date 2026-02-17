/**
 * Metadata profiles sync module
 * Exports handler and syncer for Lidarr metadata profile syncing
 */

// Handler (for registry)
export { metadataProfilesHandler } from './handler.ts';

// Syncer
export { MetadataProfileSyncer } from './syncer.ts';
