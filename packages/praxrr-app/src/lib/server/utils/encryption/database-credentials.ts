import { decryptArrInstanceApiKey, encryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials.ts';
import { databaseInstanceCredentialsQueries } from '$db/queries/databaseInstanceCredentials.ts';
import { db } from '$db/db.ts';

interface DatabaseCredentialEnvelope {
  keyVersion: string;
  nonce: string;
  ciphertext: string;
}

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

export async function decryptDatabasePersonalAccessToken(payload: DatabaseCredentialEnvelope): Promise<string> {
  return decryptArrInstanceApiKey(payload);
}

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
