import { db } from '../db.ts';
import { logger } from '$logger/logger.ts';
import {
  decryptArrInstanceApiKey,
  deriveArrInstanceApiKeyFingerprint,
  encryptArrInstanceApiKey,
} from '$server/utils/encryption/arr-credentials.ts';
import type { Migration } from '../migrations.ts';

/**
 * Migration 20260221: Add Arr instance API key credential scaffolding and backfill
 *
 * Adds:
 * - `arr_instances.api_key_fingerprint` for deterministic duplicate and env matching
 * - `arr_instance_credentials` for encrypted API key persistence metadata
 *
 * Backfill sequence:
 * 1. Build schema prerequisites if missing.
 * 2. Backfill all plain-text `arr_instances.api_key` rows into credential rows and
 *    encrypted fingerprints.
 * 3. Validate parity (Gate A) and unresolved checkpoints (Gate B).
 * 4. Enforce encrypted-only writes after explicit cutover gates (Gate D).
 *
 * Cutover gates:
 * - Gate A: parity is confirmed when every legacy row has a credential row and matching
 *   row/credential fingerprints.
 * - Gate B: no unresolved backfill failures/checkpoints remain.
 * - Gate C: Task 1.4 and Task 1.5 write-path hardening is assumed complete before hard enforcement.
 * - Gate D: rollback is available by restoring plaintext writes from backups and removing
 *   the two encrypted-only triggers only if needed.
 */

const MIGRATION_VERSION = 20260221;
const BACKFILL_BATCH_SIZE = 100;
const BACKFILL_STATE_TABLE = 'arr_instance_api_key_backfill_state';

interface ArrInstanceBackfillCandidate {
  id: number;
  api_key: string;
  api_key_fingerprint: string | null;
  ciphertext: string | null;
  nonce: string | null;
  key_version: string | null;
  credential_fingerprint: string | null;
}

interface TableInfoColumn {
  name: string;
}

interface BackfillStateRow {
  migration_version: number;
  state: 'running' | 'failed' | 'complete';
  last_instance_id: number;
  failure_instance_id: number | null;
  failure_reason: string | null;
}

type EncryptionState = 'running' | 'failed' | 'complete';

interface BackfillStateMutation {
  state: EncryptionState;
  lastInstanceId: number;
  failureInstanceId?: number | null;
  failureReason?: string | null;
}

function hasColumn(tableName: string, columnName: string): boolean {
  const columns = db.query<TableInfoColumn>(`PRAGMA table_info(${tableName})`);
  return columns.some((column) => column.name === columnName);
}

function ensureSchemaScaffold(): void {
  if (!hasColumn('arr_instances', 'api_key_fingerprint')) {
    db.exec(`
			ALTER TABLE arr_instances
				ADD COLUMN api_key_fingerprint TEXT;
		`);
  }

  db.exec(`
		CREATE TABLE IF NOT EXISTS arr_instance_credentials (
			instance_id INTEGER PRIMARY KEY,
			ciphertext TEXT NOT NULL,
			nonce TEXT NOT NULL,
			key_version TEXT NOT NULL,
			fingerprint TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE
		);
	`);

  db.exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_arr_instances_api_key_fingerprint
			ON arr_instances(api_key_fingerprint);
	`);

  db.exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_arr_instance_credentials_fingerprint
			ON arr_instance_credentials(fingerprint);
	`);

  db.exec(`
		CREATE TABLE IF NOT EXISTS ${BACKFILL_STATE_TABLE} (
			migration_version INTEGER PRIMARY KEY,
			state TEXT NOT NULL CHECK (state IN ('running', 'failed', 'complete')),
			last_instance_id INTEGER NOT NULL DEFAULT 0,
			failure_instance_id INTEGER,
			failure_reason TEXT,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`);
}

function getBackfillState(): BackfillStateRow | undefined {
  return db.queryFirst<BackfillStateRow>(`
		SELECT migration_version, state, last_instance_id, failure_instance_id, failure_reason
		FROM ${BACKFILL_STATE_TABLE}
		WHERE migration_version = ?
	`, MIGRATION_VERSION);
}

function setBackfillState({
	state,
	lastInstanceId,
	failureInstanceId = null,
	failureReason = null,
}: BackfillStateMutation): void {
  db.execute(`
		INSERT INTO ${BACKFILL_STATE_TABLE}
			(migration_version, state, last_instance_id, failure_instance_id, failure_reason)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (migration_version) DO UPDATE SET
			state = excluded.state,
			last_instance_id = excluded.last_instance_id,
			failure_instance_id = excluded.failure_instance_id,
			failure_reason = excluded.failure_reason,
			updated_at = CURRENT_TIMESTAMP
	`, MIGRATION_VERSION, state, lastInstanceId, failureInstanceId, failureReason);
}

function clearBackfillState(): void {
  db.execute(`
		DELETE FROM ${BACKFILL_STATE_TABLE}
		WHERE migration_version = ?
	`, MIGRATION_VERSION);
}

function getBackfillCandidates(cursorId: number): ArrInstanceBackfillCandidate[] {
  return db.query<ArrInstanceBackfillCandidate>(`
		SELECT
			ai.id,
			ai.api_key,
			ai.api_key_fingerprint,
			aic.ciphertext,
			aic.nonce,
			aic.key_version,
			aic.fingerprint AS credential_fingerprint
		FROM arr_instances ai
		LEFT JOIN arr_instance_credentials aic ON aic.instance_id = ai.id
		WHERE ai.id > ?
			AND ai.api_key IS NOT NULL
			AND TRIM(ai.api_key) != ''
		ORDER BY ai.id
		LIMIT ?
	`, cursorId, BACKFILL_BATCH_SIZE);
}

function getResumedCursor(existingState: BackfillStateRow | undefined): number {
  if (!existingState) {
    return 0;
  }

  if (existingState.state === 'failed' && existingState.failure_instance_id !== null) {
    return Math.max(existingState.failure_instance_id - 1, 0);
  }

  return existingState.last_instance_id;
}

function assertNoOpenCheckpointFailures(): void {
  const state = getBackfillState();
  if (!state || state.state !== 'failed') {
    return;
  }

  throw new Error(
    `Gate B check failed: unresolved Arr API key backfill checkpoint remains for migration ${MIGRATION_VERSION}, ` +
      `instance_id=${state.failure_instance_id ?? 'unknown'} failure=${state.failure_reason ?? 'none'}`,
  );
}

function upsertCredentialRow(input: {
	instanceId: number;
	ciphertext: string;
	nonce: string;
	keyVersion: string;
	fingerprint: string;
}): void {
  db.execute(
    `INSERT INTO arr_instance_credentials (instance_id, ciphertext, nonce, key_version, fingerprint)
		 VALUES (?, ?, ?, ?, ?)`,
    input.instanceId,
    input.ciphertext,
    input.nonce,
    input.keyVersion,
    input.fingerprint,
  );
}

async function normalizeRowFingerprint(
	apiKey: string,
	keyVersion: string,
): Promise<string> {
  const fingerprint = await deriveArrInstanceApiKeyFingerprint(apiKey, keyVersion);
  return fingerprint.value;
}

function setArrInstanceFingerprint(instanceId: number, fingerprint: string): void {
  db.execute(
    `UPDATE arr_instances
		 SET api_key_fingerprint = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
    fingerprint,
    instanceId,
  );
}

async function validateAndAlignCandidate(candidate: ArrInstanceBackfillCandidate): Promise<void> {
  if (
    candidate.ciphertext === null
    || candidate.nonce === null
    || candidate.key_version === null
    || candidate.credential_fingerprint === null
  ) {
    const writeData = await encryptArrInstanceApiKey(candidate.api_key);
    const roundTrip = await decryptArrInstanceApiKey(writeData.credential);
    if (roundTrip !== candidate.api_key) {
      throw new Error(`backfill integrity check failed for arr_instance ${candidate.id}: round-trip mismatch`);
    }

    const expectedFingerprint = writeData.fingerprint.value;
    db.beginTransaction();
    try {
      upsertCredentialRow({
        instanceId: candidate.id,
        ciphertext: writeData.credential.ciphertext,
        nonce: writeData.credential.nonce,
        keyVersion: writeData.credential.keyVersion,
        fingerprint: expectedFingerprint,
      });

      if (candidate.api_key_fingerprint !== expectedFingerprint) {
        setArrInstanceFingerprint(candidate.id, expectedFingerprint);
      }

      db.commit();
      return;
    } catch (error) {
      db.rollback();
      throw error;
    }
  }

  const decryptedKey = await decryptArrInstanceApiKey({
    keyVersion: candidate.key_version,
    nonce: candidate.nonce,
    ciphertext: candidate.ciphertext,
  });
  if (decryptedKey !== candidate.api_key) {
    throw new Error(`decryption integrity check failed for arr_instance ${candidate.id}`);
  }

  const expectedFingerprint = await normalizeRowFingerprint(
    candidate.api_key,
    candidate.key_version,
  );
  if (candidate.credential_fingerprint !== expectedFingerprint) {
    throw new Error(
      `Fingerprint integrity check failed for arr_instance ${candidate.id}: credential fingerprint mismatch`,
    );
  }

  if (candidate.api_key_fingerprint !== expectedFingerprint) {
    setArrInstanceFingerprint(candidate.id, expectedFingerprint);
  }
}

async function runBackfillWithCheckpoints(): Promise<void> {
  const existingState = getBackfillState();
  if (existingState?.state === 'complete') {
    // If a complete checkpoint exists, validate nothing is needed and return.
    return;
  }

  let cursorId = getResumedCursor(existingState);
  setBackfillState({
    state: 'running',
    lastInstanceId: cursorId,
    failureInstanceId: null,
    failureReason: null,
  });

  while (true) {
    const candidates = getBackfillCandidates(cursorId);
    if (candidates.length === 0) {
      break;
    }

    for (const candidate of candidates) {
      try {
        await validateAndAlignCandidate(candidate);
        cursorId = candidate.id;
        setBackfillState({ state: 'running', lastInstanceId: cursorId });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setBackfillState({
          state: 'failed',
          lastInstanceId: cursorId,
          failureInstanceId: candidate.id,
          failureReason: reason,
        });
        throw new Error(
          `Arr API key backfill failed at arr_instance id ${candidate.id}: ${reason}`,
        );
      }
    }
  }

  setBackfillState({ state: 'complete', lastInstanceId: cursorId });
}

async function assertGateAParity(): Promise<void> {
  const candidates = db.query<ArrInstanceBackfillCandidate>(`
		SELECT
			ai.id,
			ai.api_key,
			ai.api_key_fingerprint,
			aic.ciphertext,
			aic.nonce,
			aic.key_version,
			aic.fingerprint AS credential_fingerprint
		FROM arr_instances ai
		LEFT JOIN arr_instance_credentials aic ON aic.instance_id = ai.id
		WHERE ai.api_key IS NOT NULL
			AND TRIM(ai.api_key) != ''
		ORDER BY ai.id
	`);

  for (const candidate of candidates) {
    if (!candidate.ciphertext || !candidate.nonce || !candidate.key_version || !candidate.credential_fingerprint) {
      throw new Error(`Gate A check failed: arr_instance ${candidate.id} missing credential row`);
    }

    const decrypted = await decryptArrInstanceApiKey({
      keyVersion: candidate.key_version,
      nonce: candidate.nonce,
      ciphertext: candidate.ciphertext,
    });
    if (decrypted !== candidate.api_key) {
      throw new Error(`Gate A check failed: arr_instance ${candidate.id} ciphertext round-trip mismatch`);
    }

    const expectedFingerprint = await normalizeRowFingerprint(
      candidate.api_key,
      candidate.key_version,
    );
    if (candidate.api_key_fingerprint !== expectedFingerprint) {
      throw new Error(`Gate A check failed: arr_instance ${candidate.id} fingerprint in arr_instances is out of sync`);
    }

    if (candidate.credential_fingerprint !== expectedFingerprint) {
      throw new Error(`Gate A check failed: arr_instance ${candidate.id} credential fingerprint mismatch`);
    }
  }
}

function enforceEncryptedOnlyWrites(): void {
  db.execute(`
		UPDATE arr_instances
		SET api_key = ''
		WHERE api_key IS NOT NULL
			AND TRIM(api_key) != ''
			AND id IN (SELECT instance_id FROM arr_instance_credentials)
	`);

  db.execute(`
		DROP TRIGGER IF EXISTS trg_arr_instances_reject_plain_api_key_insert;
		DROP TRIGGER IF EXISTS trg_arr_instances_reject_plain_api_key_update;
	`);

  db.execute(`
		CREATE TRIGGER trg_arr_instances_reject_plain_api_key_insert
		BEFORE INSERT ON arr_instances
		WHEN NEW.api_key IS NOT NULL AND TRIM(NEW.api_key) != ''
		BEGIN
			SELECT RAISE(ABORT, 'Arr API keys must be written to arr_instance_credentials');
		END;
	`);

  db.execute(`
		CREATE TRIGGER trg_arr_instances_reject_plain_api_key_update
		BEFORE UPDATE OF api_key ON arr_instances
		WHEN NEW.api_key IS NOT NULL AND TRIM(NEW.api_key) != ''
		BEGIN
			SELECT RAISE(ABORT, 'Arr API keys must be written to arr_instance_credentials');
		END;
	`);
}

async function migrateArrApiKeyStorage(): Promise<void> {
  ensureSchemaScaffold();

  try {
    await runBackfillWithCheckpoints();
    await assertGateAParity();
    assertNoOpenCheckpointFailures();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error('Arr API key backfill failed', {
      source: 'DatabaseMigrations',
      meta: { migrationVersion: MIGRATION_VERSION, reason: message },
    });
    throw error;
  }

  enforceEncryptedOnlyWrites();

  clearBackfillState();
}

export const migration: Migration = {
  version: MIGRATION_VERSION,
  name: 'Add encrypted Arr instance credentials',

  up: `
		SELECT 1;
	`,

  down: `
		DROP TRIGGER IF EXISTS trg_arr_instances_reject_plain_api_key_update;
		DROP TRIGGER IF EXISTS trg_arr_instances_reject_plain_api_key_insert;
		DROP INDEX IF EXISTS idx_arr_instance_credentials_fingerprint;
		DROP INDEX IF EXISTS idx_arr_instances_api_key_fingerprint;
		DROP TABLE IF EXISTS arr_instance_credentials;
		DROP TABLE IF EXISTS ${BACKFILL_STATE_TABLE};
	`,

  afterUp: migrateArrApiKeyStorage,
};
