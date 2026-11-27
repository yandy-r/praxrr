/**
 * The parts of SvelteKit's form `ActionResult` this module reads. Kit 3 only exports the type from
 * the virtual `$app/forms` module, which `deno test` cannot resolve; kit's `deserialize()` result is
 * assignable to this shape.
 */
export type ActionResult =
  | { type: 'success'; status: number; data?: Record<string, unknown> }
  | { type: 'failure'; status: number; data?: Record<string, unknown> }
  | { type: 'redirect'; status: number; location: string }
  | { type: 'error'; status?: number; error: unknown };

export type FormActionResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      message: string;
      status: number;
    };

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

type FetchLike = (input: string, init: { method: string; body: FormData }) => Promise<Response>;
type DeserializeLike = (text: string) => ActionResult;

export async function submitFormActionVia(
  fetchImpl: FetchLike,
  deserializeImpl: DeserializeLike,
  action: string,
  body: FormData,
  fallback: string
): Promise<FormActionResult> {
  const response = await fetchImpl(`?/${action}`, { method: 'POST', body });
  const text = await response.text();
  try {
    return interpretActionResult(deserializeImpl(text), fallback);
  } catch {
    return failedActionResponse(fallback, response.status);
  }
}
