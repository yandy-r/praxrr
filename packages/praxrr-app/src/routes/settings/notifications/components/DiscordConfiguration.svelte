<script lang="ts">
	import { Check } from 'lucide-svelte';
	import IconCheckbox from '$ui/form/IconCheckbox.svelte';

	export let config: Record<string, unknown> = {};
	export let mode: 'create' | 'edit' = 'create';

	// Extract config values with defaults
	let webhookUrl = (config.webhook_url as string) || '';
	let username = (config.username as string) || '';
	let avatarUrl = (config.avatar_url as string) || '';
	let enableMentions = (config.enable_mentions as boolean) || false;
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
>
	<h2 class="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
		Discord Configuration
	</h2>

	<div class="space-y-4">
		<!-- Webhook URL -->
		<div>
			<label
				for="webhook_url"
				class="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
			>
				Webhook URL
				{#if mode === 'create'}
					<span class="text-red-500">*</span>
				{/if}
			</label>
			<input
				type="url"
				id="webhook_url"
				name="webhook_url"
				required={mode === 'create'}
				placeholder="https://discord.com/api/webhooks/..."
				class="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
			/>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
				{#if mode === 'edit'}
					Leave blank to keep existing webhook URL
				{:else}
					Get this from Server Settings → Integrations → Webhooks in Discord
				{/if}
			</p>
		</div>

		<!-- Bot Username (Optional) -->
		<div>
			<label
				for="username"
				class="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
			>
				Bot Username (Optional)
			</label>
			<input
				type="text"
				id="username"
				name="username"
				bind:value={username}
				placeholder="Praxrr"
				class="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
			/>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
				Custom username for the webhook bot
			</p>
		</div>

		<!-- Avatar URL (Optional) -->
		<div>
			<label
				for="avatar_url"
				class="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
			>
				Avatar URL (Optional)
			</label>
			<input
				type="url"
				id="avatar_url"
				name="avatar_url"
				bind:value={avatarUrl}
				placeholder="https://example.com/avatar.png"
				class="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
			/>
			<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
				Custom avatar image for the webhook bot
			</p>
		</div>

		<!-- Enable Mentions -->
		<div class="flex items-start gap-3">
			<IconCheckbox
				icon={Check}
				checked={enableMentions}
				on:click={() => (enableMentions = !enableMentions)}
			/>
			<input type="hidden" name="enable_mentions" value={enableMentions ? 'on' : ''} />
			<button
				type="button"
				class="flex-1 text-left"
				on:click={() => (enableMentions = !enableMentions)}
			>
				<span class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
					Enable @here mentions
				</span>
				<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
					Mention @here in notifications to alert online users
				</p>
			</button>
		</div>
	</div>
</div>
