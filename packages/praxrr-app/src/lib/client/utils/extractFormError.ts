export async function extractFormError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    if (body && typeof body === 'object' && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // fall through to fallback
  }

  return fallback;
}
