import { assertRejects } from '@std/assert';
import {
  ParityVerifierRemovedError,
  getParityVerifierDeprecationMessage,
  verifyPcdParity,
} from '$pcd/migration/parityVerifier.ts';

Deno.test('parityVerifier: verifyPcdParity fails fast after SQL-vs-YAML parity command removal', async () => {
  await assertRejects(
    () => verifyPcdParity({ pcdPath: '/tmp' }),
    ParityVerifierRemovedError,
    getParityVerifierDeprecationMessage()
  );
});
