/**
 * PCD Manifest Parser and Validator
 * Handles reading and validating pcd.json files
 */

import { logger } from '$logger/logger.ts';
import { ManifestValidationError } from '../core/errors.ts';

export const SCHEMA_DEPENDENCY_URL = 'https://github.com/yandy-r/praxrr-schema';
const SCHEMA_DEPENDENCY_CODE = 'SCHEMA_DEPENDENCY_RESOLUTION_ERROR';
const SCHEMA_DEPENDENCY_PATTERN = /^https:\/\/github\.com\/[^/]+\/praxrr-schema$/;

export interface Manifest {
  name: string;
  version: string;
  description: string;
  dependencies?: Record<string, string>;
  arr_types?: string[];
  authors?: Array<{ name: string; email?: string }>;
  license?: string;
  repository?: string;
  tags?: string[];
  links?: {
    homepage?: string;
    documentation?: string;
    issues?: string;
  };
  praxrr: {
    minimum_version: string;
  };
}

function normalizeDependencyUrlForSchemaMatch(repoUrl: string): string {
  const trimmed = repoUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${pathname}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function isSchemaDependencyUrl(repoUrl: string): boolean {
  return SCHEMA_DEPENDENCY_PATTERN.test(normalizeDependencyUrlForSchemaMatch(repoUrl));
}

const DEPENDENCY_DIR_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const DEPENDENCY_KEY_PROTOCOL = 'https:';

/** Remove URL credentials so dependency keys can be echoed in errors and logs. */
function redactDependencyKey(repoUrl: string): string {
  return repoUrl.replace(/\/\/[^/@]*@/, '//');
}

/**
 * Derive the `deps/<name>` directory for a dependency key, e.g.
 * https://github.com/yandy-r/praxrr-schema -> praxrr-schema.
 * Manifests come from upstream repositories, so keys must be https URLs (local sources are
 * configured via PRAXRR_SCHEMA_LOCAL_PATH, never by the manifest) and the name must be one
 * plain path segment: anything that could resolve to `.`, `..`, another directory or a
 * platform-special name is rejected.
 */
export function getDependencyDirName(repoUrl: string): string {
  const invalid = (reason: string) =>
    new ManifestValidationError(`Invalid dependency ${JSON.stringify(redactDependencyKey(repoUrl))}: ${reason}`);
  let parsed: URL;
  try {
    parsed = new URL(repoUrl.trim());
  } catch {
    throw invalid('it must be an https repository URL');
  }
  if (parsed.protocol !== DEPENDENCY_KEY_PROTOCOL) {
    throw invalid('it must be an https repository URL');
  }
  const parts = parsed.pathname
    .replace(/\.git\/*$/i, '')
    .split('/')
    .filter(Boolean);
  const name = parts[parts.length - 1] ?? '';
  if (!DEPENDENCY_DIR_NAME_PATTERN.test(name) || name.endsWith('.')) {
    throw invalid('it must end in a plain repository name');
  }
  return name;
}

function validateDependencyEntries(dependencies: Record<string, unknown>): void {
  const seen = new Set<string>();
  for (const [repoUrl, ref] of Object.entries(dependencies)) {
    const key = JSON.stringify(redactDependencyKey(repoUrl));
    if (typeof ref !== 'string' || ref.trim() === '' || ref.startsWith('-')) {
      throw new ManifestValidationError(`Invalid ref for dependency ${key}`);
    }
    const name = getDependencyDirName(repoUrl).toLowerCase();
    if (seen.has(name)) {
      throw new ManifestValidationError(`Dependency ${key} shares its directory name with another dependency`);
    }
    seen.add(name);
  }
}

export function resolveSchemaDependencyUrl(dependencies: Record<string, string> | undefined): string {
  if (!dependencies || Object.keys(dependencies).length === 0) {
    return SCHEMA_DEPENDENCY_URL;
  }

  const exactMatch = Object.keys(dependencies).find((dependency) => dependency === SCHEMA_DEPENDENCY_URL);
  if (exactMatch) {
    return exactMatch;
  }

  const schemaDependencies = Object.keys(dependencies).filter(isSchemaDependencyUrl);
  if (schemaDependencies.length > 1) {
    const resolved = schemaDependencies.map((dependency) => `"${dependency}"`).join(', ');
    const error = new ManifestValidationError(
      `SCHEMA_DEPENDENCY_RESOLUTION_ERROR: found ${schemaDependencies.length} schema-like dependencies: ${resolved}`
    );
    Object.assign(error, {
      code: SCHEMA_DEPENDENCY_CODE,
    });
    throw error;
  }

  if (schemaDependencies.length === 1) {
    return schemaDependencies[0]!;
  }

  throw new ManifestValidationError('Manifest dependencies must include schema repository');
}

/**
 * Read manifest from a PCD repository
 */
export async function readManifest(pcdPath: string): Promise<Manifest> {
  const manifestPath = `${pcdPath}/pcd.json`;

  try {
    const manifestContent = await Deno.readTextFile(manifestPath);
    const manifest = JSON.parse(manifestContent);
    return manifest;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ManifestValidationError('pcd.json not found in repository');
    }
    if (error instanceof SyntaxError) {
      throw new ManifestValidationError('pcd.json contains invalid JSON');
    }
    throw error;
  }
}

/**
 * Validate a manifest object
 */
export function validateManifest(manifest: unknown): asserts manifest is Manifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new ManifestValidationError('Manifest must be an object');
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (typeof m.name !== 'string' || !m.name) {
    throw new ManifestValidationError('Manifest missing required field: name');
  }

  if (typeof m.version !== 'string' || !m.version) {
    throw new ManifestValidationError('Manifest missing required field: version');
  }

  if (typeof m.description !== 'string' || !m.description) {
    throw new ManifestValidationError('Manifest missing required field: description');
  }

  // Validate dependencies if present
  if (m.dependencies !== undefined) {
    if (typeof m.dependencies !== 'object' || m.dependencies === null) {
      throw new ManifestValidationError('Manifest field dependencies must be an object');
    }

    // Validate dependencies includes schema (only check for non-empty dependencies)
    const deps = m.dependencies as Record<string, unknown>;
    if (Object.keys(deps).length > 0) {
      validateDependencyEntries(deps);
      resolveSchemaDependencyUrl(deps as Record<string, string>);
    }
  }

  // Validate praxrr section
  if (!m.praxrr || typeof m.praxrr !== 'object') {
    throw new ManifestValidationError('Manifest missing required field: praxrr');
  }

  const praxrr = m.praxrr as Record<string, unknown>;
  if (typeof praxrr.minimum_version !== 'string' || !praxrr.minimum_version) {
    throw new ManifestValidationError('Manifest missing required field: praxrr.minimum_version');
  }

  // Optional fields validation
  if (m.arr_types !== undefined) {
    if (!Array.isArray(m.arr_types)) {
      throw new ManifestValidationError('Manifest field arr_types must be an array');
    }
    const validTypes = ['radarr', 'sonarr', 'readarr', 'lidarr', 'prowlarr', 'whisparr'];
    for (const type of m.arr_types) {
      if (typeof type !== 'string' || !validTypes.includes(type)) {
        throw new ManifestValidationError(`Invalid arr_type: ${type}. Must be one of: ${validTypes.join(', ')}`);
      }
    }
  }

  if (m.authors !== undefined) {
    if (!Array.isArray(m.authors)) {
      throw new ManifestValidationError('Manifest field authors must be an array');
    }
    for (const author of m.authors) {
      if (!author || typeof author !== 'object') {
        throw new ManifestValidationError('Each author must be an object');
      }
      const a = author as Record<string, unknown>;
      if (typeof a.name !== 'string' || !a.name) {
        throw new ManifestValidationError('Each author must have a name');
      }
    }
  }

  if (m.tags !== undefined) {
    if (!Array.isArray(m.tags)) {
      throw new ManifestValidationError('Manifest field tags must be an array');
    }
    for (const tag of m.tags) {
      if (typeof tag !== 'string') {
        throw new ManifestValidationError('Each tag must be a string');
      }
    }
  }
}

/**
 * Read and validate manifest from a PCD repository
 */
export async function loadManifest(pcdPath: string): Promise<Manifest> {
  const manifest = await readManifest(pcdPath);
  validateManifest(manifest);
  return manifest;
}

/**
 * Write manifest to a PCD repository
 */
export async function writeManifest(pcdPath: string, manifest: Manifest): Promise<void> {
  validateManifest(manifest);
  const manifestPath = `${pcdPath}/pcd.json`;
  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await logger.info(`Wrote manifest: ${manifest.name}`, {
    source: 'PCDManifest',
    meta: { path: pcdPath, manifest },
  });
}

// ============================================================================
// README HELPERS (merged from readme.ts)
// ============================================================================

/**
 * Read README from a PCD repository
 */
export async function readReadme(pcdPath: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(`${pcdPath}/README.md`);
  } catch {
    return null;
  }
}

/**
 * Write README to a PCD repository
 */
export async function writeReadme(pcdPath: string, content: string): Promise<void> {
  await Deno.writeTextFile(`${pcdPath}/README.md`, content);
  await logger.info('Wrote README', {
    source: 'PCDManifest',
    meta: { path: pcdPath, content },
  });
}

// Re-export error for convenience
export { ManifestValidationError };
