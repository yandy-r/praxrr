import { AsyncLocalStorage } from 'node:async_hooks';
import { uuid } from '$shared/utils/uuid.ts';

const userOpActionStorage = new AsyncLocalStorage<{ actionId: string }>();

/** Run user-layer writes as one undo unit, preserving any outer action. */
export function withUserOpAction<T>(fn: () => Promise<T>, actionId?: string): Promise<T> {
  if (userOpActionStorage.getStore()) return fn();
  return userOpActionStorage.run({ actionId: actionId ?? uuid() }, fn);
}

export function currentUserOpActionId(): string | undefined {
  return userOpActionStorage.getStore()?.actionId;
}

/** Run `fn` as its own undo unit, ignoring any outer action (one fresh action per call). */
export function withNewUserOpAction<T>(fn: () => Promise<T>): Promise<T> {
  return userOpActionStorage.run({ actionId: uuid() }, fn);
}

/**
 * Run `fn` outside any user-op action context. Timer callbacks inherit the async context of the
 * code that armed them, so long-lived schedulers must exit it to avoid reusing a request's action.
 */
export function runOutsideUserOpAction<T>(fn: () => T): T {
  return userOpActionStorage.exit(fn);
}
