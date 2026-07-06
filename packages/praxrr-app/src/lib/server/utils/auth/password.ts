// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Deno module typings for @felix/bcrypt
/// <reference path="../../../../deno.d.ts" />

/**
 * Password hashing utilities using bcrypt via @felix/bcrypt
 * Uses Rust bcrypt via Deno FFI
 */

import { hash, verify } from '@felix/bcrypt';

/**
 * Hash a password using bcrypt
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/**
 * Verify a password against a stored hash
 */
export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return verify(password, storedHash);
}
