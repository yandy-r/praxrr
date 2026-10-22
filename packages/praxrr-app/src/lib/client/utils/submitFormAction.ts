import { deserialize } from '$app/forms';
import { type FormActionResult, submitFormActionVia } from './formActionResult.ts';

export async function submitFormAction(action: string, body: FormData, fallback: string): Promise<FormActionResult> {
  return submitFormActionVia(fetch, deserialize, action, body, fallback);
}
