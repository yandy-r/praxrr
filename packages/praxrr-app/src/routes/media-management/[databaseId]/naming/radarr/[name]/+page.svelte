<script lang="ts">
  import RadarrNamingForm from '../../components/RadarrNamingForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import PageTitle from '$ui/meta/PageTitle.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<PageTitle parts={[data.namingConfig.name, 'Radarr Naming', data.currentDatabase.name]} />

<RadarrNamingForm
  mode="edit"
  databaseName={data.currentDatabase.name}
  canWriteToBase={data.canWriteToBase}
  actionUrl="?/update"
  initialData={data.namingConfig}
/>

<DirtyModal />
