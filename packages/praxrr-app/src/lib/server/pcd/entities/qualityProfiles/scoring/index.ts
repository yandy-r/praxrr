/**
 * Quality profile scoring queries and mutations
 *
 * Types: import from '$shared/pcd/display.ts'
 */

// Queries
export { allCfScores, QualityProfileScoringNotFoundError, scoring } from './read.ts';

// Mutations
export { updateScoring } from './update.ts';
