<script lang="ts">
  import Badge from '$ui/badge/Badge.svelte';
  import type { ArrSupportTier } from '$shared/arr/compatibility.ts';
  import { describeSupportTier } from './supportTier.ts';

  export let version: string | null;
  export let tier: ArrSupportTier;

  $: descriptor = describeSupportTier(tier);
  $: displayVersion = version && version.trim() !== '' ? version : 'unknown';
</script>

<span class="inline-flex items-center gap-1.5">
  <Badge variant={descriptor.variant} icon={descriptor.icon} size="sm">{descriptor.label}</Badge>
  <Badge variant="neutral" size="sm" mono>{displayVersion}</Badge>
</span>
