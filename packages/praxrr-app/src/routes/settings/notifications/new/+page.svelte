<script lang="ts">
	import { ArrowLeft } from 'lucide-svelte';
	import NotificationServiceForm from '../components/NotificationServiceForm.svelte';
</script>

<div class="p-8">
	<!-- Header -->
	<div class="mb-8">
		<a
			href="/settings/notifications"
			class="mb-4 inline-flex items-center gap-2 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
		>
			<ArrowLeft size={16} />
			Back to Notifications
		</a>

		<div>
			<h1 class="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
				Add Notification Service
			</h1>
			<p class="mt-2 text-lg text-neutral-600 dark:text-neutral-400">
				Configure a new notification service
			</p>
		</div>
	</div>

	<!-- Form -->
	<NotificationServiceForm mode="create" />
</div>
