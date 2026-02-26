<script lang="ts">
	import { Database, Sparkles } from 'lucide-svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import Card from '$ui/card/Card.svelte';
	import StickyCard from '$ui/card/StickyCard.svelte';
</script>

<svelte:head>
	<title>Add Data Source - Praxrr</title>
</svelte:head>

<div class="p-4 md:p-8">
	<div class="space-y-6">
		<StickyCard position="top">
			<svelte:fragment slot="left">
				<h1 class="text-neutral-900 dark:text-neutral-50">Add Data Source</h1>
				<p class="text-neutral-600 dark:text-neutral-400">
					Choose a source for quality profiles, custom formats, and other configurations.
				</p>
			</svelte:fragment>
		</StickyCard>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- TRaSH Guides card -->
			<Card hoverable href="/databases/new/trash-guide" padding="lg">
				<div class="flex flex-col gap-3">
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-100 dark:bg-accent-900/30"
						>
							<Sparkles size={20} class="text-accent-600 dark:text-accent-400" />
						</div>
						<div class="flex items-center gap-2">
							<span class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
								TRaSH Guides
							</span>
							<Badge variant="accent" size="sm">Recommended</Badge>
						</div>
					</div>
					<p class="text-sm text-neutral-600 dark:text-neutral-400">
						Curated quality profiles and custom formats from TRaSH Guides for Radarr and
						Sonarr.
					</p>
					<p class="text-xs text-neutral-500 dark:text-neutral-500">
						Auto-configured, just select your Arr type
					</p>
				</div>
			</Card>

			<!-- Custom PCD Database card -->
			<Card hoverable href="/databases/new/custom" padding="lg">
				<div class="flex flex-col gap-3">
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800"
						>
							<Database size={20} class="text-neutral-600 dark:text-neutral-400" />
						</div>
						<span class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
							Custom PCD Database
						</span>
					</div>
					<p class="text-sm text-neutral-600 dark:text-neutral-400">
						Link your own Praxrr Compliant Database from any Git repository.
					</p>
					<p class="text-xs text-neutral-500 dark:text-neutral-500">
						Full control over repository, credentials, and sync
					</p>
				</div>
			</Card>
		</div>
	</div>
</div>
