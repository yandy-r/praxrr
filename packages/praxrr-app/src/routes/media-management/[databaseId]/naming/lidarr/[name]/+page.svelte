<script lang="ts">
  import LidarrNamingForm from '../../components/LidarrNamingForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import PageTitle from '$ui/meta/PageTitle.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<PageTitle parts={[data.namingConfig.name, 'Lidarr Naming', data.currentDatabase.name]} />

<LidarrNamingForm
  mode="edit"
  databaseName={data.currentDatabase.name}
  canWriteToBase={data.canWriteToBase}
  actionUrl="?/update"
  initialData={data.namingConfig}
/>

<DirtyModal />
