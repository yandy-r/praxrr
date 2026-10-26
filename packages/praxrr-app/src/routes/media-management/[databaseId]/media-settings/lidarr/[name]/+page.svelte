<script lang="ts">
  import MediaSettingsForm from '../../components/MediaSettingsForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import PageTitle from '$ui/meta/PageTitle.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<PageTitle parts={[data.mediaSettingsConfig.name, 'Lidarr Media Settings', data.currentDatabase.name]} />

<MediaSettingsForm
  mode="edit"
  arrType="lidarr"
  databaseName={data.currentDatabase.name}
  canWriteToBase={data.canWriteToBase}
  actionUrl="?/update"
  initialData={data.mediaSettingsConfig}
/>

<DirtyModal />
