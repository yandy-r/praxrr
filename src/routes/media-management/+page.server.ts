import type { ServerLoad } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';

export const load: ServerLoad = ({ url }) => {
  // Get all databases
  const databases = pcdManager.getAll();

  // Check for section query param (naming, media-settings, quality-definitions)
  const rawSection = url.searchParams.get('section');
  const allowedSections = new Set(['naming', 'media-settings', 'quality-definitions']);
  const section = rawSection && allowedSections.has(rawSection) ? rawSection : 'naming';
  const sectionFromUrl = rawSection ? allowedSections.has(rawSection) : false;

  return {
    databases,
    section,
    sectionFromUrl,
  };
};
