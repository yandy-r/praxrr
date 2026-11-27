/**
 * Store-compatible `page` for non-runes components.
 *
 * SvelteKit 3 removed `$app/stores` (importing it throws). Its replacement, `page` from
 * `$app/state`, only reports changes to runes code, while this codebase uses legacy reactivity
 * (`$page`, `$:`). This readable store re-exposes `$app/state`'s `page` with the old
 * `$app/stores` semantics: subscribers are notified whenever any page field changes.
 *
 * The underlying store is created per subscription, because on the server `$app/state` can only
 * be read while a component is rendering.
 */
import { page as pageState, type Page } from '$app/state';
import { toStore, type Readable } from 'svelte/store';

function snapshot(): Page {
  return {
    data: pageState.data,
    error: pageState.error,
    form: pageState.form,
    params: pageState.params,
    route: pageState.route,
    shallow: pageState.shallow,
    state: pageState.state,
    status: pageState.status,
    url: pageState.url,
  };
}

export const page: Readable<Page> = {
  subscribe(run, invalidate) {
    return toStore(snapshot).subscribe(run, invalidate);
  },
};
