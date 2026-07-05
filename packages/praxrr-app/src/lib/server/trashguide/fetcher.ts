import { checkout, clone, pull } from '$utils/git/index.ts';
import {
  TRASHGUIDE_ENTITY_TYPES,
  TRASHGUIDE_METADATA_ENTITY_PATH_KEYS,
  type TrashGuideDiscoveredFilesByEntity,
  type TrashGuideDiscoveryResult,
  type TrashGuideFetchAction,
  type TrashGuideFetchOptions,
  type TrashGuideFetchResult,
  type TrashGuideMetadataArrPaths,
  type TrashGuideMetadataDocument,
  type TrashGuideMetadataEntityPathKey,
  type TrashGuideSourceFile,
  type TrashGuideSupportedArrType,
  TrashGuideFetcherError,
} from './types.ts';
import { isRecord } from './utils.ts';

const DEFAULT_BRANCH = 'master';

const OPTIONAL_METADATA_KEYS: ReadonlySet<TrashGuideMetadataEntityPathKey> = new Set(['custom_format_groups']);

const REQUIRED_METADATA_KEYS = (
  Object.keys(TRASHGUIDE_METADATA_ENTITY_PATH_KEYS) as TrashGuideMetadataEntityPathKey[]
).filter((key) => !OPTIONAL_METADATA_KEYS.has(key));

const ALL_METADATA_KEYS = Object.keys(TRASHGUIDE_METADATA_ENTITY_PATH_KEYS) as TrashGuideMetadataEntityPathKey[];

export async function fetchTrashGuideSource(options: TrashGuideFetchOptions): Promise<TrashGuideFetchResult> {
  const arrType = options.arr_type;
  const branch = normalizeBranch(options.branch);
  const action = await syncRepository({
    repository_url: options.repository_url,
    local_path: options.local_path,
    personal_access_token: options.personal_access_token,
    branch,
  });
  const discovery = await discoverTrashGuideFiles({
    local_path: options.local_path,
    arr_type: arrType,
  });

  return {
    repository_url: options.repository_url,
    local_path: options.local_path,
    branch,
    arr_type: arrType,
    action,
    discovery,
  };
}

export async function discoverTrashGuideFiles(params: {
  readonly local_path: string;
  readonly arr_type: TrashGuideSupportedArrType;
}): Promise<TrashGuideDiscoveryResult> {
  const metadataPath = toAbsolutePath(params.local_path, 'metadata.json');
  const metadata = await readMetadata(metadataPath, params.local_path);
  const arrPaths = resolveArrPaths(metadata, params.arr_type, params.local_path);
  const discovered = createEmptyDiscoveredFilesByEntity();

  for (const metadataKey of ALL_METADATA_KEYS) {
    const entityType = TRASHGUIDE_METADATA_ENTITY_PATH_KEYS[metadataKey];
    const files = new Map<string, TrashGuideSourceFile>();
    const configuredPaths = arrPaths[metadataKey] ?? [];

    if (configuredPaths.length === 0 && OPTIONAL_METADATA_KEYS.has(metadataKey)) {
      discovered[entityType] = [];
      continue;
    }

    for (const configuredPath of configuredPaths) {
      const repoPath = normalizeMetadataPath(configuredPath);
      const collected = await collectJsonFilesFromMetadataPath({
        repository_root: params.local_path,
        repo_relative_path: repoPath,
        entity_type: entityType,
        metadata_key: metadataKey,
        arr_type: params.arr_type,
      });
      for (const file of collected) {
        files.set(file.relative_path, file);
      }
    }

    discovered[entityType] = [...files.values()].sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  }

  const totalFiles = TRASHGUIDE_ENTITY_TYPES.reduce((total, entityType) => total + discovered[entityType].length, 0);

  return {
    arr_type: params.arr_type,
    metadata_path: metadataPath,
    files_by_entity: discovered,
    total_files: totalFiles,
  };
}

async function syncRepository(params: {
  readonly repository_url: string;
  readonly local_path: string;
  readonly branch: string;
  readonly personal_access_token?: string;
}): Promise<TrashGuideFetchAction> {
  const repositoryUrl = params.repository_url.trim();
  if (!repositoryUrl) {
    throw new TrashGuideFetcherError('repository_url_invalid', 'Repository URL is required', false, {
      operation: 'clone',
      local_path: params.local_path,
    });
  }

  const stat = await Deno.stat(params.local_path).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  });

  if (!stat) {
    try {
      await clone(repositoryUrl, params.local_path, params.branch, params.personal_access_token);
      return 'cloned';
    } catch (error) {
      throw classifyGitError(error, {
        operation: 'clone',
        repository_url: repositoryUrl,
        local_path: params.local_path,
        branch: params.branch,
      });
    }
  }

  if (!stat.isDirectory) {
    throw new TrashGuideFetcherError(
      'local_path_invalid',
      `Local path is not a directory: ${params.local_path}`,
      false,
      {
        local_path: params.local_path,
      }
    );
  }

  const gitDirectory = await Deno.stat(toAbsolutePath(params.local_path, '.git')).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  });
  if (!gitDirectory || !gitDirectory.isDirectory) {
    throw new TrashGuideFetcherError(
      'local_path_invalid',
      `Local path exists but is not a git repository: ${params.local_path}`,
      false,
      {
        local_path: params.local_path,
      }
    );
  }

  try {
    await checkout(params.local_path, params.branch);
  } catch (error) {
    throw classifyGitError(error, {
      operation: 'checkout',
      repository_url: repositoryUrl,
      local_path: params.local_path,
      branch: params.branch,
    });
  }

  try {
    await pull(params.local_path);
  } catch (error) {
    throw classifyGitError(error, {
      operation: 'pull',
      repository_url: repositoryUrl,
      local_path: params.local_path,
      branch: params.branch,
    });
  }

  return 'updated';
}

async function readMetadata(metadataPath: string, localPath: string): Promise<TrashGuideMetadataDocument> {
  let contents: string;
  try {
    contents = await Deno.readTextFile(metadataPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new TrashGuideFetcherError('metadata_missing', `TRaSH metadata file not found: ${metadataPath}`, false, {
        operation: 'metadata',
        local_path: localPath,
        metadata_path: metadataPath,
      });
    }
    throw new TrashGuideFetcherError(
      'metadata_invalid',
      `Unable to read TRaSH metadata file: ${metadataPath}`,
      false,
      {
        operation: 'metadata',
        local_path: localPath,
        metadata_path: metadataPath,
      },
      { cause: error }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new TrashGuideFetcherError(
      'metadata_invalid',
      `TRaSH metadata file is not valid JSON: ${metadataPath}`,
      false,
      {
        operation: 'metadata',
        local_path: localPath,
        metadata_path: metadataPath,
      },
      { cause: error }
    );
  }

  if (!isMetadataDocument(parsed)) {
    throw new TrashGuideFetcherError(
      'metadata_invalid',
      `TRaSH metadata file is missing required "json_paths": ${metadataPath}`,
      false,
      {
        operation: 'metadata',
        local_path: localPath,
        metadata_path: metadataPath,
      }
    );
  }

  return parsed;
}

function resolveArrPaths(
  metadata: TrashGuideMetadataDocument,
  arrType: TrashGuideSupportedArrType,
  localPath: string
): TrashGuideMetadataArrPaths {
  const arrPaths = metadata.json_paths[arrType];
  if (!arrPaths || !isRecord(arrPaths)) {
    throw new TrashGuideFetcherError(
      'arr_type_unsupported',
      `TRaSH metadata has no json_paths entry for "${arrType}"`,
      false,
      {
        operation: 'metadata',
        local_path: localPath,
        arr_type: arrType,
      }
    );
  }

  for (const key of REQUIRED_METADATA_KEYS) {
    const value = arrPaths[key];
    if (!Array.isArray(value) || value.length === 0 || value.some((path) => typeof path !== 'string' || !path.trim())) {
      throw new TrashGuideFetcherError(
        'metadata_path_missing',
        `TRaSH metadata missing required "${key}" path list for "${arrType}"`,
        false,
        {
          operation: 'metadata',
          local_path: localPath,
          arr_type: arrType,
          metadata_key: key,
        }
      );
    }
  }

  return arrPaths;
}

async function collectJsonFilesFromMetadataPath(params: {
  readonly repository_root: string;
  readonly repo_relative_path: string;
  readonly entity_type: TrashGuideSourceFile['entity_type'];
  readonly metadata_key: TrashGuideMetadataEntityPathKey;
  readonly arr_type: TrashGuideSupportedArrType;
}): Promise<readonly TrashGuideSourceFile[]> {
  const absolutePath = toAbsolutePath(params.repository_root, params.repo_relative_path);
  const stat = await Deno.stat(absolutePath).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  });

  if (!stat) {
    throw new TrashGuideFetcherError(
      'metadata_path_missing',
      `Configured metadata path not found: ${params.repo_relative_path}`,
      false,
      {
        operation: 'discover',
        local_path: params.repository_root,
        arr_type: params.arr_type,
        metadata_key: params.metadata_key,
        metadata_path: params.repo_relative_path,
      }
    );
  }

  if (stat.isFile) {
    if (!params.repo_relative_path.endsWith('.json')) {
      return [];
    }
    return [
      {
        entity_type: params.entity_type,
        relative_path: params.repo_relative_path,
        absolute_path: absolutePath,
      },
    ];
  }

  if (!stat.isDirectory) {
    throw new TrashGuideFetcherError(
      'metadata_path_missing',
      `Configured metadata path is not a file or directory: ${params.repo_relative_path}`,
      false,
      {
        operation: 'discover',
        local_path: params.repository_root,
        arr_type: params.arr_type,
        metadata_key: params.metadata_key,
        metadata_path: params.repo_relative_path,
      }
    );
  }

  const files: TrashGuideSourceFile[] = [];
  await walkDirectoryForJson(params.repository_root, params.entity_type, params.repo_relative_path, files);
  return files.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

async function walkDirectoryForJson(
  repositoryRoot: string,
  entityType: TrashGuideSourceFile['entity_type'],
  repoRelativePath: string,
  collector: TrashGuideSourceFile[]
): Promise<void> {
  const absolutePath = toAbsolutePath(repositoryRoot, repoRelativePath);
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(absolutePath)) {
      entries.push(entry);
    }
  } catch (error) {
    throw new TrashGuideFetcherError(
      'metadata_invalid',
      `Unable to read TRaSH metadata directory: ${repoRelativePath}`,
      false,
      {
        operation: 'discover',
        local_path: repositoryRoot,
        metadata_path: repoRelativePath,
      },
      { cause: error }
    );
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const childRelativePath = `${repoRelativePath}/${entry.name}`;
    if (entry.isDirectory) {
      await walkDirectoryForJson(repositoryRoot, entityType, childRelativePath, collector);
      continue;
    }
    if (entry.isFile && entry.name.endsWith('.json')) {
      collector.push({
        entity_type: entityType,
        relative_path: childRelativePath,
        absolute_path: toAbsolutePath(repositoryRoot, childRelativePath),
      });
    }
  }
}

function createEmptyDiscoveredFilesByEntity(): {
  -readonly [K in keyof TrashGuideDiscoveredFilesByEntity]: TrashGuideSourceFile[];
} {
  return {
    custom_format: [],
    custom_format_group: [],
    quality_profile: [],
    quality_size: [],
    naming: [],
  };
}

function normalizeBranch(branch?: string): string {
  const value = branch?.trim();
  return value && value.length > 0 ? value : DEFAULT_BRANCH;
}

function normalizeMetadataPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+/g, '/');

  if (!normalized) {
    throw new TrashGuideFetcherError('metadata_invalid', 'TRaSH metadata contains an empty path', false);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new TrashGuideFetcherError(
      'metadata_invalid',
      `TRaSH metadata path must stay inside repository root: ${path}`,
      false
    );
  }

  return segments.join('/');
}

function toAbsolutePath(rootPath: string, relativePath: string): string {
  return `${rootPath.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`;
}

function classifyGitError(
  error: unknown,
  details: {
    readonly operation: 'clone' | 'checkout' | 'pull';
    readonly repository_url: string;
    readonly local_path: string;
    readonly branch: string;
  }
): TrashGuideFetcherError {
  if (error instanceof TrashGuideFetcherError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const messageLower = message.toLowerCase();
  const baseDetails = {
    operation: details.operation,
    repository_url: details.repository_url,
    local_path: details.local_path,
    branch: details.branch,
  } as const;

  if (
    messageLower.includes('pathspec') ||
    messageLower.includes("couldn't find remote ref") ||
    messageLower.includes('remote branch') ||
    messageLower.includes('did not match any file') ||
    messageLower.includes('unknown revision') ||
    messageLower.includes('invalid refspec')
  ) {
    return new TrashGuideFetcherError(
      'git_ref_error',
      `Git branch/ref error for "${details.branch}": ${message}`,
      false,
      baseDetails,
      { cause: error instanceof Error ? error : undefined }
    );
  }

  if (
    messageLower.includes('authentication') ||
    messageLower.includes('personal access token') ||
    messageLower.includes('permission denied') ||
    messageLower.includes('access denied') ||
    messageLower.includes('repository not found')
  ) {
    return new TrashGuideFetcherError('git_auth_error', `Git authentication failed: ${message}`, true, baseDetails, {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (
    messageLower.includes('could not resolve host') ||
    messageLower.includes('failed to connect') ||
    messageLower.includes('network is unreachable') ||
    messageLower.includes('connection timed out') ||
    messageLower.includes('timed out') ||
    messageLower.includes('tls') ||
    messageLower.includes('eai_again')
  ) {
    return new TrashGuideFetcherError('git_network_error', `Git network failure: ${message}`, true, baseDetails, {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (details.operation === 'pull') {
    return new TrashGuideFetcherError('git_pull_error', `Git pull failed: ${message}`, true, baseDetails, {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (messageLower.includes('repository url must be a valid github repository')) {
    return new TrashGuideFetcherError(
      'repository_url_invalid',
      `Invalid repository URL: ${message}`,
      false,
      baseDetails,
      { cause: error instanceof Error ? error : undefined }
    );
  }

  return new TrashGuideFetcherError(
    'git_operation_failed',
    `Git ${details.operation} failed: ${message}`,
    true,
    baseDetails,
    {
      cause: error instanceof Error ? error : undefined,
    }
  );
}

function isMetadataDocument(value: unknown): value is TrashGuideMetadataDocument {
  return isRecord(value) && isRecord(value.json_paths);
}
