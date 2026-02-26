import { decryptArrInstanceApiKey, encryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials.ts';
import { databaseInstanceCredentialsQueries } from '$db/queries/databaseInstanceCredentials.ts';
import { db } from '$db/db.ts';

interface DatabaseCredentialEnvelope {
  keyVersion: string;
  nonce: string;
  ciphertext: string;
}

/**
 * Encrypts a personal access token for database instance storage.
 *
 * @param personalAccessToken - The plaintext personal access token to encrypt
 * @returns An object containing the encrypted credential envelope
 */
export async function encryptDatabasePersonalAccessToken(personalAccessToken: string): Promise<{
  credential: DatabaseCredentialEnvelope;
}> {
  const encrypted = await encryptArrInstanceApiKey(personalAccessToken);
  return {
    credential: {
      keyVersion: encrypted.credential.keyVersion,
      nonce: encrypted.credential.nonce,
      ciphertext: encrypted.credential.ciphertext,
    },
  };
}

/**
 * Decrypts a stored personal access token credential envelope.
 *
 * @param payload - The credential envelope containing the key version, nonce, and ciphertext
 * @returns The decrypted plaintext personal access token
 */
export async function decryptDatabasePersonalAccessToken(payload: DatabaseCredentialEnvelope): Promise<string> {
  return decryptArrInstanceApiKey(payload);
}

/**
 * Retrieves and decrypts the personal access token for a database instance, falling back to legacy
 * plaintext storage.
 *
 * @param instanceId - The database instance ID to retrieve the token for
 * @returns The decrypted personal access token, or undefined if none is stored
 */
export async function getDecryptedDatabasePersonalAccessToken(instanceId: number): Promise<string | undefined> {
  const credential = databaseInstanceCredentialsQueries.getByInstanceId(instanceId);
  if (credential) {
    const token = await decryptDatabasePersonalAccessToken({
      keyVersion: credential.key_version,
      nonce: credential.nonce,
      ciphertext: credential.ciphertext,
    });

    return token || undefined;
  }

  const legacy = db.queryFirst<{ personal_access_token: string | null }>(
    'SELECT personal_access_token FROM database_instances WHERE id = ?',
    instanceId
  );

  return legacy?.personal_access_token?.trim() || undefined;
}
