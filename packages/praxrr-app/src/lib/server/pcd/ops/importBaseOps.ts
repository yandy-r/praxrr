import { logger } from '$logger/logger.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import {
  type MigrationEntityCandidate,
  type MigrationReaderIssue,
  type MigrationEntityStableIdentity,
  readMigrationEntitySources,
} from '$pcd/migration/reader.ts';
import { sortMigrationCandidatesByImportOrder } from '$pcd/migration/migrationImportUtils.ts';
import { compile } from '../database/compiler.ts';
import { getCache } from '../database/registry.ts';
import { withRepoImportWriteContext } from './writer.ts';

let compileForTests: typeof compile = compile;
let getCacheForTests = getCache;
type RepoImportWriteContext = Parameters<typeof withRepoImportWriteContext>[0];
type RepoImportWriteContextRunner = (
  context: RepoImportWriteContext,
  callback: () => Promise<unknown>
) => Promise<unknown>;
let withRepoImportWriteContextForTests: RepoImportWriteContextRunner =
  withRepoImportWriteContext as unknown as RepoImportWriteContextRunner;
let readMigrationEntitySourcesForTests = readMigrationEntitySources;

const ENTITY_OP_FILENAME_PREFIX = 'entities/';
// Entity ops are emitted as synthetic SQL ops and occupy a later sequence band.
const YAML_SEQUENCE_BASE = 4_000_000_000;
// Keep YAML entity filenames and op ordering deterministic even when entity counts are large.
const YAML_SEQUENCE_STRIDE = 10_000;

type SourceConflictRef = string;

type DeserializeResult = {
  success: boolean;
  filepath?: string;
  error?: string;
};

function isDeserializeResult(value: unknown): value is DeserializeResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('success' in value)) {
    return false;
  }

  if (typeof (value as { success: unknown }).success !== 'boolean') {
    return false;
  }

  return true;
}

function formatConflictIdentity(identity: MigrationEntityStableIdentity): string {
  return `${identity.key}=${identity.value}`;
}

function formatConflictPath(
  refs: [SourceConflictRef, SourceConflictRef],
  identity: MigrationEntityStableIdentity
): string {
  const [first, second] = refs;
  return `${formatConflictIdentity(identity)} in ${first} and ${second}`;
}

export class MigrationReaderError extends Error {
  readonly issues: ReadonlyArray<MigrationReaderIssue>;

  constructor(pcdPath: string, issues: ReadonlyArray<MigrationReaderIssue>) {
    super(`Failed to read migration entity sources from ${pcdPath}/entities\n${formatMigrationIssueList(issues)}`);
    this.name = 'MigrationReaderError';
    this.issues = issues;
  }
}

function formatMigrationIssueList(issues: ReadonlyArray<MigrationReaderIssue>): string {
  return issues.map((issue) => `${issue.relativePath}: ${issue.kind} - ${issue.message}`).join('\n');
}

function validateStableIdentityConflicts(
  migrationEntries: ReadonlyArray<{
    readonly stableIdentity: MigrationEntityStableIdentity;
    readonly sourcePath: string;
  }>
): void {
  const migrationSeen = new Map<string, SourceConflictRef>();

  for (const entry of migrationEntries) {
    if (!entry.stableIdentity) continue;
    const identity = formatConflictIdentity(entry.stableIdentity);
    if (migrationSeen.has(identity)) {
      const other = migrationSeen.get(identity);
      if (!other) continue;
      throw new Error(
        `Ambiguous duplicate base import identity (migration/duplicate): ${formatConflictPath(
          [other, entry.sourcePath],
          entry.stableIdentity
        )}`
      );
    }

    migrationSeen.set(identity, entry.sourcePath);
  }
}

type TestOnlyStableIdentityMigrationEntry = {
  readonly stableIdentity: MigrationEntityStableIdentity | null;
  readonly sourcePath: string;
};

export function __testOnly_validateStableIdentityConflicts(
  migrationEntries: ReadonlyArray<TestOnlyStableIdentityMigrationEntry>
): void {
  validateStableIdentityConflicts(
    migrationEntries.filter(
      (entry): entry is { readonly stableIdentity: MigrationEntityStableIdentity; readonly sourcePath: string } =>
        entry.stableIdentity !== null
    )
  );
}

export interface ImportBaseOpsResult {
  imported: number;
  orphaned: number;
}

export function __testOnly_setReadMigrationEntitySources(
  reader: (pcdPath: string) => Promise<{ candidates: MigrationEntityCandidate[]; issues: MigrationReaderIssue[] }>
): void {
  readMigrationEntitySourcesForTests = reader;
}

export function __testOnly_resetReadMigrationEntitySources(): void {
  readMigrationEntitySourcesForTests = readMigrationEntitySources;
}

export function __testOnly_setCompile(compilerFn: typeof compile): void {
  compileForTests = compilerFn;
}

export function __testOnly_resetCompile(): void {
  compileForTests = compile;
}

export function __testOnly_setWithRepoImportWriteContext(writer: RepoImportWriteContextRunner): void {
  withRepoImportWriteContextForTests = writer;
}

export function __testOnly_resetWithRepoImportWriteContext(): void {
  withRepoImportWriteContextForTests = withRepoImportWriteContext as unknown as RepoImportWriteContextRunner;
}

export function __testOnly_setGetCache(getCacheImpl: typeof getCache): void {
  getCacheForTests = getCacheImpl;
}

export function __testOnly_resetGetCache(): void {
  getCacheForTests = getCache;
}

export async function importBaseOps(
  databaseId: number,
  pcdPath: string
): Promise<ImportBaseOpsResult> {
  const migrationReaderResult = await readMigrationEntitySourcesForTests(pcdPath);

  if (migrationReaderResult.issues.length > 0) {
    throw new MigrationReaderError(pcdPath, migrationReaderResult.issues);
  }

  const migrationCandidates = migrationReaderResult.candidates;
  validateStableIdentityConflicts(migrationCandidates);

  const seenAt = new Date().toISOString();
  let imported = 0;

  if (migrationCandidates.length > 0) {
    await compileForTests(pcdPath, databaseId);
    const sortedCandidates = sortMigrationCandidatesByImportOrder(migrationCandidates);

    for (let i = 0; i < sortedCandidates.length; i++) {
      const candidate = sortedCandidates[i];
      const cache = getCacheForTests(databaseId);
      if (!cache) {
        throw new Error(`Cache not available while importing migration entity "${candidate.relativePath}"`);
      }

      await withRepoImportWriteContextForTests(
        {
          filenamePrefix: `${ENTITY_OP_FILENAME_PREFIX}${candidate.relativePath}`,
          sequenceStart: YAML_SEQUENCE_BASE + i * YAML_SEQUENCE_STRIDE,
          maxOperations: YAML_SEQUENCE_STRIDE,
          lastSeenInRepoAt: seenAt,
        },
        async () => {
          const result = await candidate.deserialize({
            databaseId,
            cache,
            layer: 'base',
            data: candidate.portable,
          });

          if (!isDeserializeResult(result)) {
            throw new Error(
              `Failed to import migration entity "${candidate.relativePath}": invalid deserialize result`
            );
          }

          if (result.success === false) {
            const error = result.error ?? 'unknown write failure';
            throw new Error(`Failed to import migration entity "${candidate.relativePath}": ${error}`);
          }
        }
      );

      imported += 1;
    }

    await compileForTests(pcdPath, databaseId);
  }

  const orphaned = pcdOpsQueries.markBaseOrphaned(databaseId, seenAt);

  await logger.debug('Imported base ops from repo', {
    source: 'PCDImporter',
    meta: {
      databaseId,
      imported,
      orphaned,
      migrationCandidates: migrationCandidates.length,
    },
  });

  return { imported, orphaned };
}
