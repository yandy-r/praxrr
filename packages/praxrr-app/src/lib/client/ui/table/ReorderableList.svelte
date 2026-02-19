<script lang="ts" generics="T">
	export let items: T[];
	export let onReorder: (items: T[]) => void;
	export let getKey: (item: T) => string | number;
	export let dragGap: string = 'space-y-6';
	export let normalGap: string = 'space-y-4';
	export let sensitivity: number = 0.3;

	let draggedItemIndex: number | null = null;
	let lastTargetIndex: number | null = null;

	function handleDragStart(index: number) {
		draggedItemIndex = index;
		lastTargetIndex = index;
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();

		// Handle dragging way above or below the list
		if (draggedItemIndex !== null) {
			const container = e.currentTarget as HTMLElement;
			const rect = container.getBoundingClientRect();

			// If way above, move to top
			if (e.clientY < rect.top + 50) {
				if (lastTargetIndex !== 0) {
					moveItemToPosition(0);
				}
				return;
			}

			// If way below, move to bottom
			if (e.clientY > rect.bottom - 50) {
				const lastIndex = items.length - 1;
				if (lastTargetIndex !== lastIndex) {
					moveItemToPosition(lastIndex);
				}
				return;
			}
		}
	}

	function handleItemDragOver(e: DragEvent, targetIndex: number) {
		e.preventDefault();

		if (draggedItemIndex !== null) {
			const target = e.currentTarget as HTMLElement;
			const rect = target.getBoundingClientRect();
			const relativeY = e.clientY - rect.top;
			const itemHeight = rect.height;

			// If we're over a different item than our last target, require being in the middle zone
			if (lastTargetIndex !== targetIndex) {
				// Require being at least sensitivity% into the item before swapping to a NEW position
				if (relativeY < itemHeight * sensitivity || relativeY > itemHeight * (1 - sensitivity)) {
					return;
				}
			}
			// If we're over the same item we last swapped to, we're already in the right position
			// Don't do anything - this prevents flickering in the dead zones

			// Only reorder if we've moved to a different item
			if (lastTargetIndex === targetIndex) return;

			moveItemToPosition(targetIndex);
		}
	}

	function moveItemToPosition(targetIndex: number) {
		if (draggedItemIndex === null) return;

		lastTargetIndex = targetIndex;

		const newItems = [...items];
		const [movedItem] = newItems.splice(draggedItemIndex, 1);
		newItems.splice(targetIndex, 0, movedItem);

		items = newItems;
		onReorder(newItems);
		draggedItemIndex = targetIndex; // Update the dragged index
	}

	function handleItemDrop(e: DragEvent, targetIndex: number) {
		e.preventDefault();
		e.stopPropagation();

		draggedItemIndex = null;
	}

	function handleDragEnd() {
		draggedItemIndex = null;
		lastTargetIndex = null;
	}
</script>

<div
	class="{draggedItemIndex !== null ? dragGap : normalGap} transition-all duration-100"
	on:dragover={handleDragOver}
	role="list"
>
	{#each items as item, index (getKey(item))}
		<div
			draggable={true}
			on:dragstart={() => handleDragStart(index)}
			on:dragover={(e) => handleItemDragOver(e, index)}
			on:drop={(e) => handleItemDrop(e, index)}
			on:dragend={handleDragEnd}
			class="cursor-move rounded-lg border border-neutral-200 bg-neutral-50 p-3 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 {draggedItemIndex ===
			index
				? 'scale-95 opacity-50'
				: ''}"
			style="transition: opacity 100ms, transform 100ms;"
			role="listitem"
		>
			<slot {item} {index} />
		</div>
	{/each}
</div>
