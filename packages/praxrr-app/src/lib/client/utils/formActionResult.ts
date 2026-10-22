import type { ActionResult } from '@sveltejs/kit';

export type FormActionResult =
  { ok: true; data: Record<string, unknown> } | { ok: false; message: string; status: number };

export function failedActionResponse(fallback: string, status: number): Extract<FormActionResult, { ok: false }> {
  return { ok: false, message: fallback, status };
}

export function interpretActionResult(result: ActionResult, fallback: string): FormActionResult {
  switch (result.type) {
    case 'success':
      return { ok: true, data: result.data ?? {} };
    case 'failure': {
      const error = result.data?.error;
      return {
        ok: false,
        message: typeof error === 'string' && error.trim().length > 0 ? error : fallback,
        status: result.status,
      };
    }
    case 'error':
      return failedActionResponse(fallback, result.status ?? 500);
    case 'redirect':
      return failedActionResponse(fallback, result.status);
    default:
      return failedActionResponse(fallback, 500);
  }
}
