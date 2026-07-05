import { assertEquals, assertFalse, assertInstanceOf, assertRejects, assertStringIncludes } from '@std/assert';
import { discoverTrashGuideFiles, fetchTrashGuideSource } from '$trashguide/fetcher.ts';
import type { TrashGuideSupportedArrType } from '$trashguide/types.ts';
import { TrashGuideFetcherError } from '$trashguide/types.ts';

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
}

/** Build a metadata.json document string carrying a radarr json_paths block. */
function radarrMetadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    json_paths: {
      radarr: {
        custom_formats: ['custom_formats'],
        quality_profiles: ['quality_profiles'],
        qualities: ['qualities'],
        naming: ['naming'],
        ...overrides,
      },
    },
  });
}

/** Seed <root> with a valid radarr metadata.json plus one .json under each referenced path. */
async function seedTrashGuideRepo(root: string): Promise<void> {
  await Deno.writeTextFile(
    `${root}/metadata.json`,
    JSON.stringify({
      json_paths: {
        radarr: {
          custom_formats: ['custom_formats'],
          quality_profiles: ['quality_profiles'],
          qualities: ['qualities'],
          naming: ['naming/naming.json'],
        },
      },
    })
  );
  await Deno.mkdir(`${root}/custom_formats`, { recursive: true });
  await Deno.writeTextFile(`${root}/custom_formats/cf1.json`, '{}');
  await Deno.mkdir(`${root}/quality_profiles`, { recursive: true });
  await Deno.writeTextFile(`${root}/quality_profiles/qp1.json`, '{}');
  await Deno.mkdir(`${root}/qualities`, { recursive: true });
  await Deno.writeTextFile(`${root}/qualities/q1.json`, '{}');
  await Deno.mkdir(`${root}/naming`, { recursive: true });
  await Deno.writeTextFile(`${root}/naming/naming.json`, '{}');
}

interface StubCommandResult {
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** Build a Deno.Command replacement whose output() is driven by a per-args handler. */
function makeCommandStub(handler: (args: readonly string[]) => StubCommandResult): typeof Deno.Command {
  const encoder = new TextEncoder();
  class StubCommand {
    readonly #args: readonly string[];
    constructor(_command: string | URL, options?: Deno.CommandOptions) {
      this.#args = options?.args ?? [];
    }
    output(): Promise<Deno.CommandOutput> {
      const result = handler(this.#args);
      return Promise.resolve({
        code: result.code,
        success: result.code === 0,
        signal: null,
        stdout: encoder.encode(result.stdout ?? ''),
        stderr: encoder.encode(result.stderr ?? ''),
      });
    }
  }
  return StubCommand as unknown as typeof Deno.Command;
}

/**
 * Drive fetchTrashGuideSource through the update branch (existing .git repo) with a stubbed
 * git subprocess so classifyGitError classifies the failure. Returns the thrown fetcher error.
 */
async function expectSyncGitError(
  commandHandler: (args: readonly string[]) => StubCommandResult,
  branch: string
): Promise<TrashGuideFetcherError> {
  const localPath = await Deno.makeTempDir();
  await Deno.mkdir(`${localPath}/.git`);
  const restores: Restore[] = [];
  patchTarget(
    Deno as unknown as { Command: typeof Deno.Command },
    'Command',
    makeCommandStub(commandHandler),
    restores
  );
  try {
    return await assertRejects(
      () =>
        fetchTrashGuideSource({
          repository_url: 'https://github.com/o/r',
          local_path: localPath,
          branch,
          arr_type: 'radarr',
        }),
      TrashGuideFetcherError
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    await Deno.remove(localPath, { recursive: true }).catch(() => undefined);
  }
}

/** Write metadata + optional fixtures, then assert discoverTrashGuideFiles rejects with a fetcher error. */
async function expectDiscoveryFetcherError(
  metadata: string,
  arrType: TrashGuideSupportedArrType,
  setup?: (root: string) => Promise<void>
): Promise<TrashGuideFetcherError> {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(`${root}/metadata.json`, metadata);
  if (setup) {
    await setup(root);
  }
  try {
    return await assertRejects(
      () => discoverTrashGuideFiles({ local_path: root, arr_type: arrType }),
      TrashGuideFetcherError
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// classifyGitError — exercised indirectly through fetchTrashGuideSource's git flow
// ---------------------------------------------------------------------------

Deno.test({
  name: 'fetchTrashGuideSource classifies branch/ref git stderr as git_ref_error',
  sanitizeResources: false,
  fn: async () => {
    const pathspecError = await expectSyncGitError(
      (args) =>
        args[0] === 'checkout'
          ? { code: 1, stderr: "error: pathspec 'nope' did not match any file(s) known to git" }
          : { code: 0 },
      'nope'
    );
    assertEquals(pathspecError.code, 'git_ref_error');
    assertEquals(pathspecError.retryable, false);
    assertStringIncludes(pathspecError.message, 'Git branch/ref error for "nope"');
    assertEquals(pathspecError.details?.operation, 'checkout');
    assertEquals(pathspecError.details?.branch, 'nope');

    const remoteRefError = await expectSyncGitError(
      (args) =>
        args[0] === 'checkout' ? { code: 1, stderr: "fatal: couldn't find remote ref refs/heads/nope" } : { code: 0 },
      'nope'
    );
    assertEquals(remoteRefError.code, 'git_ref_error');
  },
});

Deno.test({
  name: 'fetchTrashGuideSource classifies authentication git stderr as git_auth_error',
  sanitizeResources: false,
  fn: async () => {
    const authError = await expectSyncGitError(
      (args) =>
        args[0] === 'checkout'
          ? { code: 1, stderr: "fatal: Authentication failed for 'https://github.com/o/r.git/'" }
          : { code: 0 },
      'main'
    );
    assertEquals(authError.code, 'git_auth_error');
    assertEquals(authError.retryable, true);
    assertStringIncludes(authError.message, 'Git authentication failed:');

    const notFoundError = await expectSyncGitError(
      (args) => (args[0] === 'checkout' ? { code: 1, stderr: 'remote: Repository not found.' } : { code: 0 }),
      'main'
    );
    assertEquals(notFoundError.code, 'git_auth_error');
  },
});

Deno.test({
  name: 'fetchTrashGuideSource classifies network git stderr as git_network_error',
  sanitizeResources: false,
  fn: async () => {
    const resolveHostError = await expectSyncGitError(
      (args) =>
        args[0] === 'checkout'
          ? { code: 1, stderr: "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com" }
          : { code: 0 },
      'main'
    );
    assertEquals(resolveHostError.code, 'git_network_error');
    assertEquals(resolveHostError.retryable, true);
    assertStringIncludes(resolveHostError.message, 'Git network failure:');

    const timeoutError = await expectSyncGitError(
      (args) =>
        args[0] === 'checkout'
          ? { code: 1, stderr: 'ssh: connect to host github.com port 22: Connection timed out' }
          : { code: 0 },
      'main'
    );
    assertEquals(timeoutError.code, 'git_network_error');
  },
});

Deno.test({
  name: 'fetchTrashGuideSource classifies an unrecognized pull failure as git_pull_error',
  sanitizeResources: false,
  fn: async () => {
    const pullError = await expectSyncGitError(
      (args) =>
        args[0] === 'pull'
          ? { code: 1, stderr: 'error: Your local changes to the following files would be overwritten by merge' }
          : { code: 0 },
      'main'
    );
    assertEquals(pullError.code, 'git_pull_error');
    assertEquals(pullError.retryable, true);
    assertStringIncludes(pullError.message, 'Git pull failed:');
    assertEquals(pullError.details?.operation, 'pull');
  },
});

Deno.test({
  name: 'fetchTrashGuideSource classifies invalid-GitHub-URL git stderr as repository_url_invalid',
  sanitizeResources: false,
  fn: async () => {
    const urlError = await expectSyncGitError(
      (args) =>
        args[0] === 'checkout'
          ? {
              code: 1,
              stderr: 'Repository URL must be a valid GitHub repository (https://github.com/username/repo)',
            }
          : { code: 0 },
      'main'
    );
    assertEquals(urlError.code, 'repository_url_invalid');
    assertEquals(urlError.retryable, false);
    assertStringIncludes(urlError.message, 'Invalid repository URL:');
  },
});

Deno.test({
  name: 'fetchTrashGuideSource classifies unrecognized git stderr as git_operation_failed',
  sanitizeResources: false,
  fn: async () => {
    const genericError = await expectSyncGitError(
      (args) =>
        args[0] === 'checkout' ? { code: 1, stderr: 'fatal: something totally unexpected happened' } : { code: 0 },
      'main'
    );
    assertEquals(genericError.code, 'git_operation_failed');
    assertEquals(genericError.retryable, true);
    assertStringIncludes(genericError.message, 'Git checkout failed:');
  },
});

// ---------------------------------------------------------------------------
// normalizeMetadataPath — security boundary exercised through discoverTrashGuideFiles
// (custom_formats is the first ALL_METADATA_KEYS entry, so it is normalized first)
// ---------------------------------------------------------------------------

Deno.test({
  name: 'discoverTrashGuideFiles rejects metadata paths that escape the repository root',
  sanitizeResources: false,
  fn: async () => {
    const traversalInputs = ['../secrets', 'a/../b', 'a/./b', '..\\..\\etc'];
    for (const input of traversalInputs) {
      const error = await expectDiscoveryFetcherError(radarrMetadata({ custom_formats: [input] }), 'radarr');
      assertEquals(error.code, 'metadata_invalid');
      assertStringIncludes(error.message, 'must stay inside repository root');
    }
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles neutralizes absolute metadata paths to repo-relative paths',
  sanitizeResources: false,
  fn: async () => {
    const absoluteError = await expectDiscoveryFetcherError(
      radarrMetadata({ custom_formats: ['/etc/passwd'] }),
      'radarr'
    );
    assertEquals(absoluteError.code, 'metadata_path_missing');
    assertEquals(absoluteError.details?.metadata_path, 'etc/passwd');

    const doubleSlashError = await expectDiscoveryFetcherError(
      radarrMetadata({ custom_formats: ['//a//b'] }),
      'radarr'
    );
    assertEquals(doubleSlashError.code, 'metadata_path_missing');
    assertEquals(doubleSlashError.details?.metadata_path, 'a/b');
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles rejects metadata paths that normalize to empty',
  sanitizeResources: false,
  fn: async () => {
    const error = await expectDiscoveryFetcherError(radarrMetadata({ custom_formats: ['/'] }), 'radarr');
    assertEquals(error.code, 'metadata_invalid');
    assertStringIncludes(error.message, 'contains an empty path');
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles accepts and canonicalizes valid relative metadata paths',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        `${root}/metadata.json`,
        radarrMetadata({ custom_formats: ['./custom_formats//movie//cf.json'] })
      );
      await Deno.mkdir(`${root}/custom_formats/movie`, { recursive: true });
      await Deno.writeTextFile(`${root}/custom_formats/movie/cf.json`, '{}');
      await Deno.mkdir(`${root}/quality_profiles`);
      await Deno.mkdir(`${root}/qualities`);
      await Deno.mkdir(`${root}/naming`);

      const result = await discoverTrashGuideFiles({ local_path: root, arr_type: 'radarr' });
      const customFormats = result.files_by_entity.custom_format;
      assertEquals(customFormats.length, 1);
      assertEquals(customFormats[0].relative_path, 'custom_formats/movie/cf.json');
      assertEquals(customFormats[0].entity_type, 'custom_format');
      assertEquals(customFormats[0].absolute_path, `${root}/custom_formats/movie/cf.json`);
    });
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles surfaces a raw TypeError for NUL-byte metadata paths (current gap)',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      const nulPath = `media${String.fromCharCode(0)}.json`;
      await Deno.writeTextFile(`${root}/metadata.json`, radarrMetadata({ custom_formats: [nulPath] }));

      const error = await assertRejects(
        () => discoverTrashGuideFiles({ local_path: root, arr_type: 'radarr' }),
        TypeError,
        'NUL byte'
      );
      // Documents the boundary gap: the null byte escapes the typed fetcher contract.
      assertFalse(error instanceof TrashGuideFetcherError);
    });
  },
});

// ---------------------------------------------------------------------------
// readMetadata — error paths exercised through discoverTrashGuideFiles
// ---------------------------------------------------------------------------

Deno.test({
  name: 'discoverTrashGuideFiles surfaces metadata_missing when metadata.json is absent',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      const error = await assertRejects(
        () => discoverTrashGuideFiles({ local_path: root, arr_type: 'radarr' }),
        TrashGuideFetcherError
      );
      assertEquals(error.code, 'metadata_missing');
      assertStringIncludes(error.message, 'TRaSH metadata file not found');
      assertEquals(error.details?.operation, 'metadata');
      assertEquals(error.details?.metadata_path, `${root}/metadata.json`);
      assertEquals(error.details?.local_path, root);
    });
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles surfaces metadata_invalid on malformed metadata JSON',
  sanitizeResources: false,
  fn: async () => {
    const error = await expectDiscoveryFetcherError('not json {{{', 'radarr');
    assertEquals(error.code, 'metadata_invalid');
    assertStringIncludes(error.message, 'not valid JSON');
    assertInstanceOf(error.cause, SyntaxError);
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles surfaces metadata_invalid when json_paths is missing or not an object',
  sanitizeResources: false,
  fn: async () => {
    const missingError = await expectDiscoveryFetcherError('{"foo":1}', 'radarr');
    assertEquals(missingError.code, 'metadata_invalid');
    assertStringIncludes(missingError.message, 'missing required "json_paths"');

    const nonObjectError = await expectDiscoveryFetcherError('{"json_paths":5}', 'radarr');
    assertEquals(nonObjectError.code, 'metadata_invalid');
    assertStringIncludes(nonObjectError.message, 'missing required "json_paths"');
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles surfaces arr_type_unsupported when the arr_type has no json_paths entry',
  sanitizeResources: false,
  fn: async () => {
    const metadata = JSON.stringify({
      json_paths: {
        sonarr: {
          custom_formats: ['custom_formats'],
          quality_profiles: ['quality_profiles'],
          qualities: ['qualities'],
          naming: ['naming'],
        },
      },
    });
    const error = await expectDiscoveryFetcherError(metadata, 'radarr');
    assertEquals(error.code, 'arr_type_unsupported');
    assertStringIncludes(error.message, 'no json_paths entry for "radarr"');
    assertEquals(error.details?.arr_type, 'radarr');
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles surfaces metadata_path_missing when a required path list is absent',
  sanitizeResources: false,
  fn: async () => {
    const metadata = JSON.stringify({
      json_paths: {
        radarr: {
          quality_profiles: ['quality_profiles'],
          qualities: ['qualities'],
          naming: ['naming'],
        },
      },
    });
    const error = await expectDiscoveryFetcherError(metadata, 'radarr');
    assertEquals(error.code, 'metadata_path_missing');
    assertStringIncludes(error.message, 'missing required "custom_formats" path list');
    assertEquals(error.details?.metadata_key, 'custom_formats');
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles surfaces metadata_invalid on a non-NotFound metadata read failure',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(`${root}/metadata.json`, radarrMetadata());
      const restores: Restore[] = [];
      const denied = new Deno.errors.PermissionDenied('denied');
      patchTarget(
        Deno as unknown as { readTextFile: typeof Deno.readTextFile },
        'readTextFile',
        (() => Promise.reject(denied)) as typeof Deno.readTextFile,
        restores
      );
      try {
        const error = await assertRejects(
          () => discoverTrashGuideFiles({ local_path: root, arr_type: 'radarr' }),
          TrashGuideFetcherError
        );
        assertEquals(error.code, 'metadata_invalid');
        assertStringIncludes(error.message, 'Unable to read TRaSH metadata file');
        assertInstanceOf(error.cause, Deno.errors.PermissionDenied);
      } finally {
        for (const restore of restores.reverse()) {
          restore();
        }
      }
    });
  },
});

// ---------------------------------------------------------------------------
// fetchTrashGuideSource — clone / pull orchestration
// ---------------------------------------------------------------------------

Deno.test({
  name: 'fetchTrashGuideSource clones from a local-path source and discovers files',
  sanitizeResources: false,
  fn: async () => {
    const source = await Deno.makeTempDir();
    const targetBase = await Deno.makeTempDir();
    const target = `${targetBase}/repo`;
    await seedTrashGuideRepo(source);

    try {
      const result = await fetchTrashGuideSource({
        repository_url: source,
        local_path: target,
        arr_type: 'radarr',
      });

      assertEquals(result.action, 'cloned');
      assertEquals(result.branch, 'master');
      assertEquals(result.arr_type, 'radarr');
      assertEquals(result.discovery.total_files, 4);
      assertEquals(result.discovery.metadata_path, `${target}/metadata.json`);
      assertEquals(result.discovery.files_by_entity.custom_format_group, []);
      assertEquals(result.discovery.files_by_entity.custom_format, [
        {
          entity_type: 'custom_format',
          relative_path: 'custom_formats/cf1.json',
          absolute_path: `${target}/custom_formats/cf1.json`,
        },
      ]);
    } finally {
      await Deno.remove(source, { recursive: true }).catch(() => undefined);
      await Deno.remove(targetBase, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: 'fetchTrashGuideSource records the normalized branch on clone',
  sanitizeResources: false,
  fn: async () => {
    const source = await Deno.makeTempDir();
    const targetBase = await Deno.makeTempDir();
    await seedTrashGuideRepo(source);

    try {
      const custom = await fetchTrashGuideSource({
        repository_url: source,
        local_path: `${targetBase}/develop`,
        branch: 'develop',
        arr_type: 'radarr',
      });
      assertEquals(custom.branch, 'develop');

      const blank = await fetchTrashGuideSource({
        repository_url: source,
        local_path: `${targetBase}/blank`,
        branch: '   ',
        arr_type: 'radarr',
      });
      assertEquals(blank.branch, 'master');
    } finally {
      await Deno.remove(source, { recursive: true }).catch(() => undefined);
      await Deno.remove(targetBase, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: 'fetchTrashGuideSource pulls an existing git repository and reports action=updated',
  sanitizeResources: false,
  fn: async () => {
    const localPath = await Deno.makeTempDir();
    await seedTrashGuideRepo(localPath);
    await Deno.mkdir(`${localPath}/.git`);

    const invocations: string[][] = [];
    const restores: Restore[] = [];
    patchTarget(
      Deno as unknown as { Command: typeof Deno.Command },
      'Command',
      makeCommandStub((args) => {
        invocations.push([...args]);
        return { code: 0 };
      }),
      restores
    );

    try {
      const result = await fetchTrashGuideSource({
        repository_url: 'https://github.com/o/r',
        local_path: localPath,
        branch: 'main',
        arr_type: 'radarr',
      });

      assertEquals(result.action, 'updated');
      assertEquals(result.branch, 'main');
      assertEquals(result.discovery.total_files, 4);
      assertEquals(invocations, [['checkout', 'main'], ['pull']]);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await Deno.remove(localPath, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: 'fetchTrashGuideSource rejects an empty repository_url',
  sanitizeResources: false,
  fn: async () => {
    const error = await assertRejects(
      () =>
        fetchTrashGuideSource({
          repository_url: '   ',
          local_path: '/nonexistent/praxrr-test-target',
          arr_type: 'radarr',
        }),
      TrashGuideFetcherError
    );
    assertEquals(error.code, 'repository_url_invalid');
    assertStringIncludes(error.message, 'Repository URL is required');
    assertEquals(error.details?.operation, 'clone');
  },
});

Deno.test({
  name: 'fetchTrashGuideSource rejects when local_path exists but is a file',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      const filePath = `${root}/not-a-dir`;
      await Deno.writeTextFile(filePath, 'x');

      const error = await assertRejects(
        () =>
          fetchTrashGuideSource({
            repository_url: 'https://github.com/o/r',
            local_path: filePath,
            arr_type: 'radarr',
          }),
        TrashGuideFetcherError
      );
      assertEquals(error.code, 'local_path_invalid');
      assertStringIncludes(error.message, 'is not a directory');
    });
  },
});

Deno.test({
  name: 'fetchTrashGuideSource rejects when local_path is a directory without a git repository',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      const error = await assertRejects(
        () =>
          fetchTrashGuideSource({
            repository_url: 'https://github.com/o/r',
            local_path: root,
            arr_type: 'radarr',
          }),
        TrashGuideFetcherError
      );
      assertEquals(error.code, 'local_path_invalid');
      assertStringIncludes(error.message, 'exists but is not a git repository');
    });
  },
});

// ---------------------------------------------------------------------------
// walkDirectoryForJson — recursion, sorting, mid-walk failure context
// ---------------------------------------------------------------------------

Deno.test({
  name: 'discoverTrashGuideFiles wraps a mid-walk nested directory read error with child path context',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(`${root}/metadata.json`, radarrMetadata({ custom_formats: ['cf'] }));
      await Deno.mkdir(`${root}/cf/sub`, { recursive: true });

      const restores: Restore[] = [];
      const originalReadDir = Deno.readDir;
      const patchedReadDir: typeof Deno.readDir = (path) => {
        if (typeof path === 'string' && path === `${root}/cf/sub`) {
          throw new Deno.errors.PermissionDenied('nested dir unavailable');
        }
        return originalReadDir(path);
      };
      patchTarget(Deno as unknown as { readDir: typeof Deno.readDir }, 'readDir', patchedReadDir, restores);

      try {
        const error = await assertRejects(
          () => discoverTrashGuideFiles({ local_path: root, arr_type: 'radarr' }),
          TrashGuideFetcherError
        );
        assertEquals(error.code, 'metadata_invalid');
        assertStringIncludes(error.message, 'Unable to read TRaSH metadata directory: cf/sub');
        assertEquals(error.details?.operation, 'discover');
        assertEquals(error.details?.metadata_path, 'cf/sub');
        assertEquals(error.details?.local_path, root);
      } finally {
        for (const restore of restores.reverse()) {
          restore();
        }
      }
    });
  },
});

Deno.test({
  name: 'discoverTrashGuideFiles recurses nested directories, sorts, and skips non-json files',
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(`${root}/metadata.json`, radarrMetadata({ custom_formats: ['cf'] }));
      await Deno.mkdir(`${root}/cf/sub`, { recursive: true });
      await Deno.writeTextFile(`${root}/cf/a.json`, '{}');
      await Deno.writeTextFile(`${root}/cf/b.txt`, 'x');
      await Deno.writeTextFile(`${root}/cf/sub/c.json`, '{}');
      await Deno.mkdir(`${root}/quality_profiles`);
      await Deno.mkdir(`${root}/qualities`);
      await Deno.mkdir(`${root}/naming`);

      const result = await discoverTrashGuideFiles({ local_path: root, arr_type: 'radarr' });
      const customFormats = result.files_by_entity.custom_format;
      assertEquals(
        customFormats.map((file) => file.relative_path),
        ['cf/a.json', 'cf/sub/c.json']
      );
      assertEquals(customFormats[0].entity_type, 'custom_format');
      assertEquals(customFormats[0].absolute_path, `${root}/cf/a.json`);
    });
  },
});

// ---------------------------------------------------------------------------
// Preserved original coverage: top-level configured directory read failure
// ---------------------------------------------------------------------------

Deno.test({
  name: 'discoverTrashGuideFiles wraps directory read errors with contextual fetcher error',
  sanitizeResources: false,
  fn: async () => {
    const localPath = await Deno.makeTempDir();
    const metadataPath = `${localPath}/metadata.json`;
    const metadataDir = `${localPath}/metadata-folder`;
    await Deno.mkdir(metadataDir);

    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify({
        json_paths: {
          radarr: {
            custom_formats: ['metadata-folder'],
            quality_profiles: ['metadata-folder'],
            qualities: ['metadata-folder'],
            naming: ['metadata-folder'],
          },
        },
      })
    );

    const restores: Restore[] = [];
    const originalReadDir = Deno.readDir;
    const patchedReadDir: typeof Deno.readDir = (path) => {
      if (typeof path === 'string' && path === metadataDir) {
        throw new Deno.errors.PermissionDenied('directory unavailable');
      }
      return originalReadDir(path);
    };
    patchTarget(Deno as unknown as { readDir: typeof Deno.readDir }, 'readDir', patchedReadDir, restores);

    try {
      const error = await assertRejects(
        () => discoverTrashGuideFiles({ local_path: localPath, arr_type: 'radarr' }),
        TrashGuideFetcherError
      );

      assertEquals(error.code, 'metadata_invalid');
      assertStringIncludes(error.message, `Unable to read TRaSH metadata directory: metadata-folder`);
      assertEquals(error.details?.operation, 'discover');
      assertEquals(error.details?.metadata_path, 'metadata-folder');
      assertEquals(error.details?.local_path, localPath);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
      await Deno.remove(localPath, { recursive: true });
    }
  },
});
