<script lang="ts">
  import { enhance } from '$app/forms';
  import { alertStore } from '$alerts/store';
  import { Bell, CheckCircle, Loader2, RotateCw, XCircle } from 'lucide-svelte';
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
    { key: 'attempts', header: 'Attempts', sortable: true },
    { key: 'sent_at', header: 'Time', sortable: true },
  ];

  let resendingId: number | null = null;

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
    <h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">Recent Notifications</h2>
  </div>

  <Table {columns} data={history} emptyMessage="No notification history available yet." compact responsive>
    <svelte:fragment slot="cell" let:row let:column>
      {#if column.key === 'title'}
        <span class="font-medium">{row.title}</span>
      {:else if column.key === 'service_id'}
        {getServiceName(row.service_id)}
      {:else if column.key === 'notification_type'}
        <Badge variant="neutral">{formatNotificationType(row.notification_type)}</Badge>
      {:else if column.key === 'status'}
        {#if row.status === 'success'}
          <Badge variant="success" icon={CheckCircle}>Success</Badge>
        {:else}
          <span title={row.error ?? undefined}>
            <Badge variant="danger" icon={XCircle}>Failed</Badge>
          </span>
        {/if}
      {:else if column.key === 'attempts'}
        <Badge variant="neutral" mono>{row.attempts}</Badge>
      {:else if column.key === 'sent_at'}
        <Badge variant="neutral" mono>{getRelativeTime(row.sent_at)}</Badge>
      {/if}
    </svelte:fragment>

    <svelte:fragment slot="actions" let:row>
      {#if row.status === 'failed'}
        <form
          method="POST"
          action="?/resend"
          use:enhance={() => {
            resendingId = row.id;
            return async ({ result, update }) => {
              if (result.type === 'failure' && result.data) {
                alertStore.add('error', (result.data as { error?: string }).error || 'Failed to resend notification');
              } else if (result.type === 'success') {
                alertStore.add('success', 'Notification resent successfully');
              }
              resendingId = null;
              await update();
            };
          }}
        >
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            disabled={resendingId === row.id}
            class="text-accent-600 dark:text-accent-400 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-neutral-300 bg-white transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            title="Resend notification"
            aria-label="Resend notification"
          >
            {#if resendingId === row.id}
              <Loader2 size={12} class="animate-spin" />
            {:else}
              <RotateCw size={12} />
            {/if}
          </button>
        </form>
      {/if}
    </svelte:fragment>
  </Table>
</div>
