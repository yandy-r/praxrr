import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { discoverTrashGuideFiles } from '$trashguide/fetcher.ts';
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
