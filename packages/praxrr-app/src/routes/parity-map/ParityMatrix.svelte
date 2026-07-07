<script lang="ts">
  import Table from '$ui/table/Table.svelte';
  import type { Column } from '$ui/table/types';
  import Badge from '$ui/badge/Badge.svelte';
  import { buildParityRows, type ParityRow } from './parityRows.ts';
  import { ARR_APP_TYPES, getArrAppMetadata, type ArrAppType } from '$shared/arr/capabilities.ts';
  import type { ParityStatus } from '$shared/arr/parity.ts';
  import radarrLogo from '$lib/client/assets/Radarr.svg';
  import sonarrLogo from '$lib/client/assets/Sonarr.svg';
  import lidarrLogo from '$lib/client/assets/Lidarr.png';

  /** Matrix rows - pure/computed by default; override only for tests/composition. */
  export let rows: ParityRow[] = buildParityRows();

  // Logo assets keyed by app type. ArrAppMetadata carries label/iconKey only,
  // never a logo path, so the images are imported directly here.
  const appLogos: Record<ArrAppType, string> = {
    radarr: radarrLogo,
    sonarr: sonarrLogo,
    lidarr: lidarrLogo,
  };

  /** Tri-state parity status -> Badge variant. */
  function statusVariant(status: ParityStatus): 'success' | 'info' | 'warning' {
    if (status === 'native') return 'success';
    if (status === 'shared') return 'info';
    return 'warning';
  }

  function statusLabel(status: ParityStatus): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function getStatus(row: ParityRow, key: string): ParityStatus {
    return row[key as ArrAppType];
  }

  // Entity column + one column per Arr app, in ARR_APP_TYPES order.
  const columns: Column<ParityRow>[] = [
    { key: 'label', header: 'Entity', align: 'left' },
    ...ARR_APP_TYPES.map(
      (type): Column<ParityRow> => ({
        key: type,
        header: getArrAppMetadata(type).label,
        align: 'center',
      })
    ),
  ];
</script>

<div class="space-y-3">
  <!--
    App identity strip: logo + accent-colored label per app, mirroring the
    inline `style="... var(--arr-<type>-color)"` pattern used elsewhere (e.g.
    quality-definitions TableView.svelte) to surface Arr identity. Table.svelte's
    own header only supports plain text plus an icon ComponentType, so the logo
    and per-app color accent are surfaced here rather than inside its <thead>.
  -->
  <div class="flex flex-wrap items-center justify-end gap-6">
    {#each ARR_APP_TYPES as type (type)}
      <div class="flex items-center gap-2">
        <img src={appLogos[type]} alt="{getArrAppMetadata(type).label} logo" class="h-5 w-5 rounded" />
        <span class="text-sm font-semibold" style="color: var(--arr-{type}-color);">
          {getArrAppMetadata(type).label}
        </span>
      </div>
    {/each}
  </div>

  <Table {columns} data={rows}>
    <svelte:fragment slot="cell" let:row let:column>
      {#if column.key === 'label'}
        <span class="font-medium text-neutral-900 dark:text-neutral-100">{row.label}</span>
      {:else}
        {@const status = getStatus(row, column.key)}
        <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
      {/if}
    </svelte:fragment>
  </Table>
</div>
