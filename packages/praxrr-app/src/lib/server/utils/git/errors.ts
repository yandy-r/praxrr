const NOT_GIT_REPOSITORY_MARKER = 'not a git repository';

export class NotGitRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotGitRepositoryError';
  }
}

function getErrorMessage(input: unknown): string {
  if (input instanceof Error) {
    return input.message;
  }

  return typeof input === 'string' ? input : '';
}

export function isNotGitRepositoryMessage(message: string): boolean {
  return message.toLowerCase().includes(NOT_GIT_REPOSITORY_MARKER);
}

export function isNotGitRepositoryError(input: unknown): boolean {
  if (input instanceof Error && input.name === 'NotGitRepositoryError') {
    return true;
  }

  const message = getErrorMessage(input);
  return isNotGitRepositoryMessage(message);
}

