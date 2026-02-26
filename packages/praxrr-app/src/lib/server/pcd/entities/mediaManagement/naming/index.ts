/**
 * Naming queries index
 */

// Read
export {
  list,
  getLidarrByName,
  getRadarrByName,
  getSonarrByName,
  getRadarrDefaults,
  getSonarrDefaults,
  getLidarrDefaults,
} from './read.ts';

// Create
export { createLidarrNaming, createRadarrNaming, createSonarrNaming } from './create.ts';

// Update
export { updateLidarrNaming, updateRadarrNaming, updateSonarrNaming } from './update.ts';

// Delete
export { removeLidarrNaming, removeRadarrNaming, removeSonarrNaming } from './delete.ts';
