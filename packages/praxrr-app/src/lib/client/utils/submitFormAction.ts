import { deserialize } from '$app/forms';
import { failedActionResponse, interpretActionResult, type FormActionResult } from './formActionResult.ts';

export async function submitFormAction(action: string, body: FormData, fallback: string): Promise<FormActionResult> {
  const response = await fetch(`?/${action}`, { method: 'POST', body });
  const text = await response.text();
  try {
    return interpretActionResult(deserialize(text), fallback);
  } catch {
    return failedActionResponse(fallback, response.status);
  }
}
