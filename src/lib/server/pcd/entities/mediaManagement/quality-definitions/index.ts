/**
 * Quality definitions queries
 */

// Read
export { list, getRadarrByName, getSonarrByName, getLidarrByName, getAvailableQualities } from './read.ts';

// Create
export {
  createRadarrQualityDefinitions,
  createSonarrQualityDefinitions,
  createLidarrQualityDefinitions,
} from './create.ts';

// Update
export {
  updateRadarrQualityDefinitions,
  updateSonarrQualityDefinitions,
  updateLidarrQualityDefinitions,
} from './update.ts';

// Delete
export {
  removeRadarrQualityDefinitions,
  removeSonarrQualityDefinitions,
  removeLidarrQualityDefinitions,
} from './delete.ts';
