<script lang="ts">
	import { Bell, CheckCircle, XCircle } from 'lucide-svelte';
	import { parseUTC } from '$shared/utils/dates';
	import type { NotificationHistoryRecord } from '$db/queries/notificationHistory.ts';
	import Table from '$ui/table/Table.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import type { Column } from '$ui/table/types';

	export let history: NotificationHistoryRecord[];
	export let services: Array<{ id: string; name: string }>;

	const columns: Column<NotificationHistoryRecord>[] = [
		{ key: 'title', header: 'Title', sortable: true },
		{ key: 'service_id', header: 'Service', sortable: true },
		{ key: 'notification_type', header: 'Type', sortable: true },
		{ key: 'status', header: 'Status', sortable: true },
		{ key: 'sent_at', header: 'Time', sortable: true }
	];

	function formatDateTime(date: string): string {
		const d = parseUTC(date);
		return d ? d.toLocaleString() : '-';
	}

	function getRelativeTime(date: string): string {
		const d = parseUTC(date);
		if (!d) return '-';
		const now = new Date();
		const diff = now.getTime() - d.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'Just now';
	}

	function getServiceName(serviceId: string): string {
		const service = services.find((s) => s.id === serviceId);
		return service?.name || 'Unknown';
	}

	function formatNotificationType(type: string): string {
		const parts = type.split('.');
		if (parts.length >= 3) {
			const action = parts[1].replace(/_/g, ' ');
			const status = parts[2];
			return `${action.charAt(0).toUpperCase() + action.slice(1)} ${status.charAt(0).toUpperCase() + status.slice(1)}`;
		}
		return type;
	}
</script>

<div class="space-y-4">
	<div class="flex items-center gap-2">
		<Bell size={18} class="text-neutral-600 dark:text-neutral-400" />
		<h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">
			Recent Notifications
		</h2>
	</div>

	<Table
		{columns}
		data={history}
		emptyMessage="No notification history available yet."
		compact
		responsive
	>
		<svelte:fragment slot="cell" let:row let:column>
			{#if column.key === 'title'}
				<span class="font-medium">{row.title}</span>
			{:else if column.key === 'service_id'}
				{getServiceName(row.service_id)}
			{:else if column.key === 'notification_type'}
				<Badge variant="neutral">{formatNotificationType(row.notification_type)}</Badge>
			{:else if column.key === 'status'}
				<Badge
					variant={row.status === 'success' ? 'success' : 'danger'}
					icon={row.status === 'success' ? CheckCircle : XCircle}
				>
					{row.status === 'success' ? 'Success' : 'Failed'}
				</Badge>
			{:else if column.key === 'sent_at'}
				<Badge variant="neutral" mono>{getRelativeTime(row.sent_at)}</Badge>
			{/if}
		</svelte:fragment>
	</Table>
</div>
