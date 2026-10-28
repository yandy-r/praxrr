---
title: Modals & Dialogs
description: 'Modal and dialog components: the base Modal shell plus info, clone, copy-to-database, and dirty-state confirmation dialogs.'
---

Modal and dialog components layer content above the page and manage backdrop, focus, and confirm/cancel flows. These are reusable components under `$ui/` (source: `packages/praxrr-app/src/lib/client/ui/`), ranging from the base `Modal` shell to purpose-built info, clone, copy-to-database, and unsaved-changes dialogs.

## Modal

Base confirm/cancel dialog with a header, a body slot (falling back to a plain message), and a two-button footer. Handles the backdrop, scale/fade transitions, focus trapping and restore, Escape-to-cancel, size/height sizing, plus loading and danger states.

Import:

```svelte
import Modal from '$ui/modal/Modal.svelte';
```

Props:

| Prop              | Type                                       | Default           | Required | Description                                                                                                                                        |
| ----------------- | ------------------------------------------ | ----------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`            | `boolean`                                  | `false`           | No       | Controls visibility. Typically bound with `bind:open` by the parent; Modal itself never mutates it (footer/backdrop emit events instead).          |
| `header`          | `string`                                   | `'Confirm'`       | No       | Title text rendered in the header bar.                                                                                                             |
| `bodyMessage`     | `string`                                   | `'Are you sure?'` | No       | Fallback paragraph shown in the body when no `body` slot content is provided.                                                                      |
| `confirmText`     | `string`                                   | `'Confirm'`       | No       | Label for the confirm (right) button.                                                                                                              |
| `cancelText`      | `string`                                   | `'Cancel'`        | No       | Label for the cancel (left) button.                                                                                                                |
| `confirmDanger`   | `boolean`                                  | `false`           | No       | When true, the confirm button uses the danger (red) variant; otherwise primary.                                                                    |
| `confirmDisabled` | `boolean`                                  | `false`           | No       | Disables the confirm button (also disabled while `loading`).                                                                                       |
| `loading`         | `boolean`                                  | `false`           | No       | Shows a `Loader2` spinner icon on confirm and disables both footer buttons.                                                                        |
| `size`            | `'sm' \| 'md' \| 'lg' \| 'xl' \| '2xl'`    | `'md'`            | No       | Max-width preset: `sm`=max-w-sm, `md`=max-w-md, `lg`=max-w-2xl, `xl`=max-w-4xl, `2xl`=max-w-6xl.                                                   |
| `height`          | `'auto' \| 'md' \| 'lg' \| 'xl' \| 'full'` | `'auto'`          | No       | Fixed viewport-height preset: `auto`='', `md`=h-[50vh], `lg`=h-[70vh], `xl`=h-[85vh], `full`=h-[95vh]. Always capped at max-h-[calc(100svh-2rem)]. |

Events:

- `on:confirm` — fired by the confirm button.
- `on:cancel` — fired by the cancel button, backdrop self-click, and the Escape key (while focus is inside the dialog panel).

Events are dispatched via `createEventDispatcher` with no detail payload.

Slots:

- `body` — named slot for custom body content; when omitted, renders `bodyMessage` as a paragraph.
- No footer slot — footer buttons are fixed (Cancel with `X` icon, Confirm with `Check`/`Loader2` icon).

Usage:

```svelte
<Modal
  bind:open={demoModalOpen}
  header={demoModalDanger ? 'Delete Profile' : 'Confirm Action'}
  bodyMessage="Are you sure you want to proceed with this action?"
  confirmText={demoModalDanger ? 'Delete' : 'Confirm'}
  confirmDanger={demoModalDanger}
  on:confirm={() => (demoModalOpen = false)}
  on:cancel={() => (demoModalOpen = false)}
/>
```

Keyboard and focus:

| Behavior      | Detail                                                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus trap    | The panel uses the `focusTrap` action while `open`. Tab on the last tabbable element wraps to the first; Shift+Tab on the first wraps to the last. Tab combined with Alt, Ctrl, or Meta is not intercepted.                                                                 |
| Initial focus | The first tabbable element in DOM order that is not the body scroll region: a control in the `body` slot if there is one, otherwise the Cancel button. If every button is disabled (for example while `loading`), the body region receives focus.                           |
| Focus restore | When the dialog closes, focus returns to the element that was focused when it opened, if that element is still in the document.                                                                                                                                             |
| Escape        | Handled by a `keydown` listener on the dialog panel, not on `window`. The event is prevented and stopped, so with nested modals only the innermost one cancels. Escape pressed while focus is outside the panel is ignored.                                                 |
| Labelling     | The panel has `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the header `<h2>` (id generated with `uniqueId('modal-title')`).                                                                                                                      |
| Body region   | The body wrapper is `role="region"`, `tabindex="0"`, and labelled by the header, so keyboard users can focus it and scroll long content with the arrow keys. It carries `data-focus-trap-region`, which excludes it from initial-focus selection when other controls exist. |

Variants and notes:

- Variants: `size` (sm/md/lg/xl/2xl), `height` (auto/md/lg/xl/full), `confirmDanger` (primary vs danger confirm button), and `loading` (spinner + disabled).
- Uses the Svelte 5 legacy API (`export let` props, `createEventDispatcher`, `on:click|self` backdrop) — not runes.
- z-index 100 backdrop with blur; the body region is scrollable (`overflow-auto`).
- Escape only cancels while open.
- Footer layout is `justify-between` (Cancel left, Confirm right). Depends on `$ui/button/Button.svelte`, `lucide-svelte` icons (`X`, `Check`, `Loader2`), and `$lib/client/utils/focusTrap` / `uniqueId`.

## InfoModal

Read-only informational dialog: a header with an `X` close button and a single default-slot body. It self-manages closing (sets `open = false` internally), traps focus while open, and has no confirm/cancel actions.

Import:

```svelte
import InfoModal from '$ui/modal/InfoModal.svelte';
```

Props:

| Prop        | Type      | Default                 | Required | Description                                                                                                  |
| ----------- | --------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `open`      | `boolean` | `false`                 | No       | Controls visibility. Component sets it to false on close (`X` button or Escape), so `bind:open` is expected. |
| `header`    | `string`  | `'Information'`         | No       | Title text in the header bar.                                                                                |
| `maxWidth`  | `string`  | `'min(42rem, 90vw)'`    | No       | Raw CSS value applied inline as `max-width` on the modal panel.                                              |
| `maxHeight` | `string`  | `'calc(100svh - 2rem)'` | No       | Raw CSS value applied inline as `max-height` on the modal panel.                                             |

Events:

- No dispatched events. Closing is internal: the `X` button, backdrop self-click, and Escape (while focus is inside the panel) set `open = false` directly (surfaced via `bind:open`).

Slots:

- Default slot (`<slot />`) for arbitrary body content. No named slots.

Usage:

```svelte
<InfoModal bind:open={demoInfoModalOpen} header="About Profiles">
  <div class="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
    <p>Profiles define quality preferences for your media library.</p>
    <p>
      Each profile can have custom formats, quality cutoffs, and upgrade rules.
    </p>
  </div>
</InfoModal>
```

Keyboard and focus:

- Same focus model as `Modal`: `focusTrap` keeps Tab/Shift+Tab inside the panel while open, and focus returns to the previously focused element on close.
- Initial focus goes to the first tabbable element that is not the body region. The header `X` button (`aria-label="Close"`) precedes the body in DOM order, so it receives focus.
- Escape is handled on the panel (prevented and stopped), so only the innermost open modal closes.
- The panel has `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the header `<h2>`.
- The body is a focusable `role="region"` (`tabindex="0"`, labelled by the header, `data-focus-trap-region`) so long content can be scrolled from the keyboard.

Variants and notes:

- Sizing is controlled purely via `maxWidth`/`maxHeight` CSS strings (no discrete size presets like `Modal`).
- Uses the Svelte 5 legacy API (`export let` props and `on:` directives).
- Shares Modal's backdrop styling, fade+scale transitions, and `z-[100]`. The header includes a dedicated icon close button (`lucide X`, size 20); backdrop self-click and Escape also close.
- The body is scrollable (`flex-1 overflow-auto`).

## CloneModal

Self-contained dialog for cloning a PCD entity within the same database. It wraps `Modal`, prompts for a new name (pre-filled `<source> (Copy)`), optionally lets the user pick the base/user layer, then exports the source entity in the single-entity shape and re-imports it under the new name via the PCD API. It copies only the entity itself, not its dependencies; use `CopyToDatabaseModal` to copy an entity with its dependencies into another database.

Import:

```svelte
import CloneModal from '$ui/modal/CloneModal.svelte';
```

Props:

| Prop             | Type                                          | Default | Required | Description                                                                                                                  |
| ---------------- | --------------------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `open`           | `boolean`                                     | `false` | No       | Controls visibility. Set to false internally on successful clone or cancel; use `bind:open`.                                 |
| `databaseId`     | `number`                                      | —       | Yes      | ID of the PCD database the entity belongs to; sent to export/import endpoints.                                               |
| `entityType`     | `EntityType` (from `$shared/pcd/portable.ts`) | —       | Yes      | PCD entity type being cloned; passed to export/import calls.                                                                 |
| `sourceName`     | `string`                                      | `''`    | No       | Name of the entity to clone. When set and the modal opens, seeds `newName` as `<sourceName> (Copy)`.                         |
| `existingNames`  | `string[]`                                    | `[]`    | No       | Existing entity names used for case-insensitive conflict detection against the trimmed new name.                             |
| `canWriteToBase` | `boolean`                                     | `false` | No       | When true, shows a Base/User layer radio group and defaults selection to `'base'`; otherwise clones into the `'user'` layer. |

Events:

- No outward-facing dispatched events. On confirm it performs a single-entity `GET /api/v1/pcd/export` then a single-entity `POST /api/v1/pcd/import`, emits alerts via `alertStore`, calls `invalidateAll()`, and closes.
- Internally consumes Modal's `on:confirm`/`on:cancel`.

Slots:

- None exposed to callers. It fills Modal's `body` slot internally with a `FormInput` ('New Name'), a conflict message, and the optional Base/User layer fieldset.

Usage:

```svelte
<CloneModal
  bind:open={cloneOpen}
  databaseId={db.id}
  entityType="custom_format"
  sourceName={selected.name}
  existingNames={allNames}
  canWriteToBase={hasBaseWriteAccess}
/>
```

Variants and notes:

- Two layouts: with `canWriteToBase` (Base/User radio group shown, defaults to `'base'`) vs without (silently targets the `'user'` layer).
- The confirm button auto-disables when the name is empty, conflicts, or a request is in flight.
- Uses the Svelte 5 legacy API (`export let`, reactive `$:` blocks). `nameConflict` and `confirmDisabled` are derived reactively; `handleConfirm` early-returns when disabled.
- Not featured in the dev showcase route. Renders `Modal` with `size="sm"` and header/confirmText `"Clone"`.
- Depends on `$alerts/store` (`alertStore`), `$app/navigation` (`invalidateAll`), `$ui/form/FormInput.svelte`, and the sibling `Modal.svelte`.

## CopyToDatabaseModal

Dialog behind the **Copy to database…** row action on entity list pages. When it opens, it exports the source entity with its dependencies as a bundle (`includeDependencies=true&format=bundle`) and loads the list of databases. The user then picks another enabled database, and the dialog embeds `BundleImportPanel` (without the paste/upload input) to dry-run and apply the bundle there.

Import:

```svelte
import CopyToDatabaseModal from '$ui/bundles/CopyToDatabaseModal.svelte';
```

Props:

| Prop         | Type                                          | Default | Required | Description                                                            |
| ------------ | --------------------------------------------- | ------- | -------- | ---------------------------------------------------------------------- |
| `open`       | `boolean`                                     | `false` | No       | Controls visibility; use `bind:open`. Closes after a successful apply. |
| `databaseId` | `number`                                      | —       | Yes      | Source database; excluded from the target list.                        |
| `entityType` | `EntityType` (from `$shared/pcd/portable.ts`) | —       | Yes      | Type of the entity to copy.                                            |
| `sourceName` | `string`                                      | —       | Yes      | Name of the entity to copy.                                            |

Usage:

```svelte
<CopyToDatabaseModal
  bind:open={copyModalOpen}
  databaseId={data.currentDatabase.id}
  entityType="quality_profile"
  sourceName={cloneSourceName}
/>
```

Variants and notes:

- Renders `Modal` with `size="xl"`, header `Copy to database…`, and a `Close` confirm button. Closing is blocked while an import request is running.
- The **Base** layer is offered only when the selected target has a personal access token and local ops disabled.
- If no other enabled database exists, it shows `Link another database before copying entities.`

## BundleImportPanel

Bundle import form shared by the **Databases → {database} → Import** page and `CopyToDatabaseModal`. It accepts pasted JSON or an uploaded `.json` file (up to 5 MiB), and has layer and default collision policy selects. **Dry run** sends `POST /api/v1/pcd/import` with `dryRun: true` and shows a preview table with a per-entity policy select (keyed `<entityType>:<name>`). **Apply bundle** resends the request with the dry run's `planDigest` as `expectedPlanDigest`.

Import:

```svelte
import BundleImportPanel from '$ui/bundles/BundleImportPanel.svelte';
```

Props:

| Prop             | Type                | Default | Required | Description                                                                                          |
| ---------------- | ------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `databaseId`     | `number`            | —       | Yes      | Target database.                                                                                     |
| `canWriteToBase` | `boolean`           | `false` | No       | Offers the **Base** layer option; otherwise the import targets `user`.                               |
| `bundle`         | `PcdBundle \| null` | `null`  | No       | Preloaded bundle (used by `CopyToDatabaseModal`); replaced by parsed input when `showInput` is true. |
| `showInput`      | `boolean`           | `true`  | No       | Shows the JSON textarea and file upload.                                                             |
| `busy`           | `boolean`           | `false` | No       | True while a request is running; bindable.                                                           |

Events:

- `on:applied` — fired after a successful apply, after `invalidateAll()`.

Variants and notes:

- **Apply bundle** is enabled only when the latest dry run matches the current inputs and reported no errors and no missing references. Changing the bundle, layer, or any policy requires a new dry run.
- A `409` response marks the preview stale and shows a warning to run another dry run. After a rolled-back `500`, an error alert is shown and the report stays visible.
- Uses the Svelte 5 legacy API (`export let`, `$:`, `createEventDispatcher`).

## DirtyModal

Global unsaved-changes guard. It renders a pre-configured `Modal` wired to the dirty store and intercepts SvelteKit navigation via `beforeNavigate` to prompt before leaving a page with unsaved changes.

Import:

```svelte
import DirtyModal from '$ui/modal/DirtyModal.svelte';
```

Props:

| Prop | Type | Default | Required | Description                                             |
| ---- | ---- | ------- | -------- | ------------------------------------------------------- |
| —    | —    | —       | —        | This component takes no props; mount it as a singleton. |

Events:

- No props and no outward events. Confirm calls `confirmDiscard()`; cancel calls `cancelDiscard()` (both from the dirty store). Navigation is intercepted internally through `beforeNavigate`.

Slots:

- None. Body and labels are hardcoded (header 'Unsaved Changes', danger 'Discard Changes' confirm, 'Stay on Page' cancel).

Usage:

```svelte
<script>
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
</script>

<!-- Mount once in a root layout; no props -->
<DirtyModal />
```

Variants and notes:

- None. It is a fixed composition of `Modal` with `confirmDanger={true}` and store-driven `open={$showModal}`. Uses the Svelte 5 legacy API and SvelteKit's `beforeNavigate`/`goto`.
- Depends on `$lib/client/stores/dirty` (`isDirty`, `showModal`, `confirmNavigation`, `confirmDiscard`, `cancelDiscard`) and `$app/navigation` (`beforeNavigate`, `goto`).
- On navigation while `$isDirty`, it cancels the nav, awaits `confirmNavigation()`, and re-issues `goto()` to the pending pathname only if the user confirms.
- Intended as a singleton in the app shell.
