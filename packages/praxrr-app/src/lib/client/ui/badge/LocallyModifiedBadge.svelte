<script lang="ts">
  import { Pencil } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import { LOCALLY_MODIFIED_LABEL, LOCALLY_MODIFIED_TITLE } from '$ui/badge/locallyModified.ts';
</script>

<span class="inline-flex" title={LOCALLY_MODIFIED_TITLE}>
  <Badge variant="warning" size="sm" icon={Pencil}>{LOCALLY_MODIFIED_LABEL}</Badge>
</span>
