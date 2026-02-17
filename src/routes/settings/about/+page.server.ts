import { migrationRunner } from '$db/migrations.ts';
import { config } from '$config';
import packageJson from '../../../../package.json' with { type: 'json' };
import { getCachedReleases, type GitHubRelease } from '$lib/server/utils/github/cache.ts';

type VersionStatus = 'up-to-date' | 'out-of-date' | 'dev-build';

async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  return getCachedReleases('yandy-r', 'profilarr');
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  return 0;
}

function getVersionStatus(currentVersion: string, latestVersion: string | undefined): VersionStatus {
  if (!latestVersion) {
    return 'dev-build';
  }

  // Remove 'v' prefix if present
  const current = currentVersion.replace(/^v/, '');
  const latest = latestVersion.replace(/^v/, '');

  // Check if it's a dev build (e.g., has -dev, -alpha, -beta suffix)
  if (current.includes('-') || current.includes('dev')) {
    return 'dev-build';
  }

  // Compare versions semantically
  const comparison = compareVersions(current, latest);

  if (comparison > 0) {
    // Current version is greater than latest release - must be a dev build
    return 'dev-build';
  } else if (comparison === 0) {
    // Versions are equal
    return 'up-to-date';
  } else {
    // Current version is less than latest release
    return 'out-of-date';
  }
}

export const load = () => {
  const currentMigrationVersion = migrationRunner.getCurrentVersion();
  const appliedMigrations = migrationRunner.getAppliedMigrations();

  // Mark the latest migration (highest version)
  const migrationsWithLatest = appliedMigrations.map((migration) => ({
    ...migration,
    latest: migration.version === currentMigrationVersion,
  }));

  // Return synchronous data immediately, defer releases fetch
  const releasesPromise = fetchGitHubReleases().then((releases) => {
    const latestRelease = releases.find((r) => !r.prerelease);
    const versionStatus = getVersionStatus(packageJson.version, latestRelease?.tag_name);

    return {
      releases: releases.slice(0, 10),
      versionStatus,
    };
  });

  return {
    version: packageJson.version,
    versionStatus: 'dev-build' as VersionStatus, // Default until releases load
    timezone: config.timezone,
    paths: {
      base: config.paths.base,
      data: config.paths.data,
      logs: config.paths.logs,
      database: config.paths.database,
    },
    migration: {
      current: currentMigrationVersion,
      applied: migrationsWithLatest,
    },
    // Stream the releases data
    streamed: {
      releasesData: releasesPromise,
    },
  };
};
