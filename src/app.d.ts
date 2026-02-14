// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { User } from '$db/queries/users.ts';
import type { Session } from '$db/queries/sessions.ts';

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      user: User | null;
      session: Session | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  // Extend RequestInit to support Deno HttpClient
  interface RequestInit {
    client?: Deno.HttpClient;
  }
}

export {};
