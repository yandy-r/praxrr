import { TrashGuideSourceNotFoundError } from '$lib/server/trashguide/manager.ts';

export function parseSourceId(raw: string | undefined): { value: number } | { error: string } {
  if (!raw) {
    return { error: 'Missing source id' };
  }

  if (!/^\d+$/.test(raw)) {
    return { error: 'Invalid source id' };
  }

  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Invalid source id' };
  }

  return { value: id };
}

export function mapReadErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceNotFoundError) {
    return 404;
  }

  return 500;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'TRaSH source request failed';
}

