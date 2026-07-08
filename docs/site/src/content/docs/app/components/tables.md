---
title: Tables & Lists
description: 'Data table and list components: sortable tables, expandable rows, reorderable lists, and per-row action buttons.'
---

This category covers the reusable data-display components for tabular and list content: sortable tables, expandable detail rows, drag-and-drop reordering, and compact per-row action buttons. All components live under `$ui/` (source: `packages/praxrr-app/src/lib/client/ui/`).

## Column, SortState & SortDirection (types)

Shared TypeScript type module that defines the column contract and sort state consumed by `Table` and `ExpandableTable`. Import these types to build strongly-typed column definitions.

```svelte
import type {(Column, SortState, SortDirection)} from '$ui/table/types';
```

| Prop                          | Type                                                                   | Default              | Required | Description                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `SortDirection`               | `type SortDirection = 'asc' \| 'desc'`                                 | —                    | No       | Sort direction union.                                                                           |
| `SortState`                   | `interface SortState { key: string; direction: SortDirection }`        | —                    | No       | Active sort descriptor: the sorted column key and its direction.                                |
| `Column<T>`                   | `interface Column<T>`                                                  | —                    | No       | Column definition object. Fields below.                                                         |
| `Column.key`                  | `string`                                                               | —                    | Yes      | Unique column key; also the default nested value path (supports dotted paths like `user.name`). |
| `Column.header`               | `string`                                                               | —                    | Yes      | Header text to display.                                                                         |
| `Column.headerIcon`           | `ComponentType`                                                        | `undefined`          | No       | Icon component rendered before the header text (Table only, size 14).                           |
| `Column.width`                | `string`                                                               | `undefined`          | No       | Optional Tailwind width class (e.g. `w-32`, `w-1/4`).                                           |
| `Column.align`                | `'left' \| 'center' \| 'right'`                                        | `'left'` (effective) | No       | Text/content alignment for the column.                                                          |
| `Column.sortable`             | `boolean`                                                              | `false`              | No       | Whether the header is clickable to sort.                                                        |
| `Column.sortAccessor`         | `(row: T) => string \| number \| boolean \| Date \| null \| undefined` | `undefined`          | No       | Custom value accessor used for sorting instead of key lookup.                                   |
| `Column.sortComparator`       | `(a: T, b: T) => number`                                               | `undefined`          | No       | Full-row comparator; takes precedence over `sortAccessor` / key comparison.                     |
| `Column.defaultSortDirection` | `SortDirection`                                                        | `'asc'` (effective)  | No       | Direction applied when the column is first sorted.                                              |
| `Column.cell`                 | `(row: T) => string \| ComponentType \| { html: string }`              | `undefined`          | No       | Custom cell renderer (used by `Table`; `ExpandableTable` renders cells via its `cell` slot).    |
| `Column.hideOnMobile`         | `boolean`                                                              | `false`              | No       | Hide the column in the mobile/responsive card layout.                                           |

### Usage

```ts
import type { Column, SortState } from '$ui/table/types';

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'score', header: 'Score', sortable: true, align: 'right' },
];
const initialSort: SortState = { key: 'name', direction: 'asc' };
```

### Notes

- `Column.cell` is consumed by `Table.svelte` only; `ExpandableTable` ignores the cell function and uses its `cell` named slot.
- Sort precedence: `sortComparator` wins over `sortAccessor`, which wins over key-path value lookup.

## Table

A generic, sortable data table (Svelte 5, generic over `T extends object`) with per-column custom cell rendering, click-to-sort headers, row click / row href navigation, progressive lazy loading, and an optional responsive mobile card layout.

```svelte
import Table from '$ui/table/Table.svelte';
```

| Prop            | Type                                                     | Default               | Required | Description                                                                                                                      |
| --------------- | -------------------------------------------------------- | --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `columns`       | `Column<T>[]`                                            | —                     | Yes      | Column definitions (see Column type). Drives headers, alignment, sorting, and cell rendering.                                    |
| `data`          | `T[]`                                                    | —                     | Yes      | Array of row objects to render. Sorting is applied internally to produce the displayed order.                                    |
| `hoverable`     | `boolean`                                                | `true`                | No       | Apply hover background highlight on desktop rows.                                                                                |
| `compact`       | `boolean`                                                | `false`               | No       | Tighter cell padding (`px-4 py-2` vs `px-6 py-4`).                                                                               |
| `emptyMessage`  | `string`                                                 | `'No data available'` | No       | Message shown when data is empty.                                                                                                |
| `onRowClick`    | `((row: T) => void) \| undefined`                        | `undefined`           | No       | Callback fired when a row is clicked; makes rows show a pointer cursor.                                                          |
| `rowHref`       | `((row: T) => string \| null \| undefined) \| undefined` | `undefined`           | No       | Returns an href per row; renders an overlay anchor covering the row/cell (supports right-click / open-in-new-tab).               |
| `initialSort`   | `SortState \| null`                                      | `null`                | No       | Initial sort key/direction applied on mount.                                                                                     |
| `onSortChange`  | `((sort: SortState \| null) => void) \| undefined`       | `undefined`           | No       | Callback fired whenever the sort state changes (null when sort is cleared on third click).                                       |
| `actionsHeader` | `string`                                                 | `'Actions'`           | No       | Header text for the actions column (only rendered when the `actions` slot is used).                                              |
| `responsive`    | `boolean`                                                | `false`               | No       | Enable mobile card layout below 767px via `matchMedia`.                                                                          |
| `pageSize`      | `number \| undefined`                                    | `undefined`           | No       | When set, enables progressive batch rendering via `createProgressiveList`; rows render in pages as a sentinel scrolls into view. |

### Usage

```svelte
<script>
  import Table from '$ui/table/Table.svelte';
  import TableActionButton from '$ui/table/TableActionButton.svelte';
  import { Trash2 } from 'lucide-svelte';
</script>

<Table columns={demoTableColumns} data={demoTableData} compact>
  <svelte:fragment slot="actions" let:row>
    <TableActionButton icon={Trash2} title="Delete" variant="danger" />
  </svelte:fragment>
</Table>
```

### Slots & Events

- `cell` slot with `let:row`, `let:column`, `let:rowIndex` — fallback cell renderer when a column has no `cell` function.
- `actions` slot with `let:row`, `let:rowIndex` — renders a trailing actions column/cell; its presence toggles the actions header column via `$$slots.actions`.
- Events are callback props (`onRowClick(row)`, `onSortChange(sort)`); there are no `createEventDispatcher` events.

### Variants & Notes

- Desktop table layout vs mobile card layout (`responsive`); compact vs default padding; sortable vs static columns; row navigation via `onRowClick` or `rowHref`.
- Cell renderers from `Column.cell` may return a string, an object `{ html }` (rendered with `@html`), or a Svelte `ComponentType` (mounted with prop `row`).
- Sorting supports `column.sortComparator` (full-row), `column.sortAccessor`, or nested key-path lookup (e.g. `user.name`). Sort cycles asc → desc → cleared.
- `Column.headerIcon` renders at size 14 before the header text.

## ExpandableTable

A sortable data table (generic over `T extends object`) that adds expandable detail rows toggled by a chevron button or row click, with per-row expand disabling, configurable chevron position, and a responsive mobile card layout. Requires a stable row id.

```svelte
import ExpandableTable from '$ui/table/ExpandableTable.svelte';
```

| Prop                | Type                            | Default               | Required | Description                                                                                                          |
| ------------------- | ------------------------------- | --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `columns`           | `Column<T>[]`                   | —                     | Yes      | Column definitions. Cells render via the `cell` slot (not `Column.cell`); the default falls back to key-path lookup. |
| `data`              | `T[]`                           | —                     | Yes      | Array of row objects.                                                                                                |
| `getRowId`          | `(row: T) => string \| number`  | —                     | Yes      | Returns a stable unique id per row, used to track expanded state.                                                    |
| `compact`           | `boolean`                       | `false`               | No       | Tighter cell padding.                                                                                                |
| `emptyMessage`      | `string`                        | `'No data available'` | No       | Message shown when data is empty.                                                                                    |
| `defaultSort`       | `SortState \| null`             | `null`                | No       | Initial sort key/direction.                                                                                          |
| `flushExpanded`     | `boolean`                       | `false`               | No       | Render expanded content with no padding/indent (removes `px`/`py` and the `ml-6` indent).                            |
| `flushBottom`       | `boolean`                       | `false`               | No       | Remove bottom rounding and bottom border of the table container (for stacking under another element).                |
| `expandedRows`      | `Set<string \| number>`         | `new Set()`           | No       | The set of currently expanded row ids (bindable to control/observe expansion externally).                            |
| `chevronPosition`   | `'left' \| 'right'`             | `'right'`             | No       | Which side the expand chevron column appears on (desktop).                                                           |
| `expandOnRowClick`  | `boolean`                       | `true`                | No       | Toggle expansion when a row is clicked (in addition to the chevron button).                                          |
| `onRowClick`        | `((row: T) => void) \| null`    | `null`                | No       | Callback fired on row click, invoked before expansion toggling.                                                      |
| `primaryColumnKey`  | `string \| null`                | `null`                | No       | Which column acts as the mobile card title; defaults to the first visible column when null.                          |
| `disableExpandWhen` | `((row: T) => boolean) \| null` | `null`                | No       | Predicate to disable expansion (and hide the chevron) for specific rows.                                             |
| `responsive`        | `boolean`                       | `false`               | No       | Enable mobile card layout below 767px.                                                                               |
| `pageSize`          | `number \| undefined`           | `undefined`           | No       | Enable progressive batch rendering with a scroll sentinel.                                                           |

### Usage

```svelte
<script>
  import ExpandableTable from '$ui/table/ExpandableTable.svelte';
</script>

<ExpandableTable
  columns={demoTableColumns}
  data={demoTableData}
  getRowId={(row) => row.id}
  compact
>
  <svelte:fragment slot="expanded" let:row>
    <p>Details for {row.name} — score: {row.score}, status: {row.status}</p>
  </svelte:fragment>
</ExpandableTable>
```

### Slots & Events

- `cell` slot with `let:row`, `let:column`, `let:index` (or `let:expanded`); the default renders the key-path value. On mobile the `cell` slot also receives `let:expanded`.
- `expanded` slot with `let:row` — detail content shown when a row is expanded; defaults to `No additional details`.
- `actions` slot with `let:row` — per-row action controls; click propagation is stopped so actions do not toggle expansion.
- `onRowClick(row)` is the only callback prop. Sort state is internal (no callback exposed) and there are no `createEventDispatcher` events.

### Variants & Notes

- Desktop table vs mobile card layout; `chevronPosition` left/right; `compact`; `flushExpanded` / `flushBottom` layout modifiers; expandable vs per-row-disabled expansion.
- Uses `lucide-svelte` icons (`ChevronUp`/`ChevronDown` for the expand toggle; `ArrowUp`/`ArrowDown`/`ArrowUpDown` for sort indicators) and the shared `$ui/button/Button` component for the chevron toggle (`size='xs'`).
- Unlike `Table`, cells are rendered exclusively through the `cell` slot — `Column.cell` functions are not invoked here.
- Sort supports `sortComparator` / `sortAccessor` / key-path with case-insensitive string, numeric, boolean, and Date-aware comparison. Sort cycles asc → desc → cleared.
- Columns with `hideOnMobile` are dropped from the mobile card view.

## ReorderableList

A drag-and-drop reorderable vertical list (generic over `T`) that renders each item via a default slot and emits the reordered array live during dragging, with a sensitivity dead-zone to reduce flicker.

```svelte
import ReorderableList from '$ui/table/ReorderableList.svelte';
```

| Prop          | Type                            | Default       | Required | Description                                                                                                            |
| ------------- | ------------------------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `items`       | `T[]`                           | —             | Yes      | The list items to render and reorder. Mutated in place during drag; parent should bind or update via `onReorder`.      |
| `onReorder`   | `(items: T[]) => void`          | —             | Yes      | Callback fired with the new item order whenever an item moves position during dragging.                                |
| `getKey`      | `(item: T) => string \| number` | —             | Yes      | Returns a stable unique key per item for the keyed `#each` block.                                                      |
| `dragGap`     | `string`                        | `'space-y-6'` | No       | Tailwind spacing class applied to the container while a drag is in progress.                                           |
| `normalGap`   | `string`                        | `'space-y-4'` | No       | Tailwind spacing class applied to the container when not dragging.                                                     |
| `sensitivity` | `number`                        | `0.3`         | No       | Fraction (0-1) of an item's height the pointer must cross before swapping position; larger values widen the dead zone. |

### Usage

```svelte
<script>
  import ReorderableList from '$ui/table/ReorderableList.svelte';

  let demoReorderItems = [
    { id: 1, label: 'First' },
    { id: 2, label: 'Second' },
  ];
</script>

<ReorderableList
  items={demoReorderItems}
  getKey={(item) => item.id}
  onReorder={(items) => (demoReorderItems = items)}
>
  <svelte:fragment let:item let:index>
    <div class="flex items-center gap-3">
      <span>{index + 1}</span>
      <span>{item.label}</span>
    </div>
  </svelte:fragment>
</ReorderableList>
```

### Slots & Events

- Default slot with `let:item` and `let:index` for rendering each list item's content.
- `onReorder(items)` is the only callback prop. Native HTML drag events (`dragstart`, `dragover`, `drop`, `dragend`) are used internally and are not re-exposed to the parent.

### Variants & Notes

- Gap tightens/loosens between `dragGap` and `normalGap` during drag; the dragged item is styled with `scale-95 opacity-50`.
- Each item wrapper is draggable with a `cursor-move` handle over the whole row.
- Dragging near the top/bottom 50px of the container jumps the item to the first/last position.
- Reordering happens continuously during `dragover` (not only on drop), so `onReorder` can fire multiple times per drag.
- This file uses tab indentation.

## TableActionButton

A compact square icon-only button intended for table row actions, with neutral/danger/accent hover styling, two sizes, and optional click-propagation stopping.

```svelte
import TableActionButton from '$ui/table/TableActionButton.svelte';
```

| Prop              | Type                                | Default     | Required | Description                                                                                                |
| ----------------- | ----------------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `icon`            | `ComponentType`                     | —           | Yes      | The icon component to render (e.g. a `lucide-svelte` icon); sized automatically (sm=12, md=14).            |
| `title`           | `string`                            | —           | Yes      | Tooltip / accessible title attribute on the button.                                                        |
| `variant`         | `'neutral' \| 'danger' \| 'accent'` | `'neutral'` | No       | Hover color treatment: neutral (grey), danger (red), or accent (theme accent).                             |
| `size`            | `'sm' \| 'md'`                      | `'md'`      | No       | Button box size: sm = `h-6 w-6` (icon 12), md = `h-7 w-7` (icon 14).                                       |
| `type`            | `'button' \| 'submit'`              | `'button'`  | No       | Native button type.                                                                                        |
| `disabled`        | `boolean`                           | `false`     | No       | Disable the button (`cursor-not-allowed`, reduced opacity).                                                |
| `stopPropagation` | `boolean`                           | `false`     | No       | Call `event.stopPropagation()` on click before dispatching, to avoid triggering row click/expand handlers. |

### Usage

```svelte
<script>
  import TableActionButton from '$ui/table/TableActionButton.svelte';
  import { Trash2 } from 'lucide-svelte';

  function handleDelete() {
    // delete the row
  }
</script>

<TableActionButton
  icon={Trash2}
  title="Delete"
  variant="danger"
  on:click={handleDelete}
/>
```

### Variants & Notes

- `variant`: neutral, danger, or accent; `size`: sm or md; plus a `disabled` state.
- Dispatches a Svelte `click` event with the `MouseEvent` payload via `createEventDispatcher<{ click: MouseEvent }>` — subscribe with `on:click`.
- Renders the icon via `<svelte:component>` at the size mapped from `size`.
- Set `stopPropagation` when used inside clickable/expandable table rows.
- `Table`'s `actions` slot in the showcase uses this component without an `on:click` handler, relying on the dispatched event when wired.
- This file uses tab indentation.
