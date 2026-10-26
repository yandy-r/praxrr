<script lang="ts">
  import QualityDefinitionsForm from '../../components/QualityDefinitionsForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import PageTitle from '$ui/meta/PageTitle.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
</script>

<PageTitle parts={[data.qualityDefinitionsConfig.name, 'Radarr Quality Definitions', data.currentDatabase.name]} />

<QualityDefinitionsForm
  mode="edit"
  arrType="radarr"
  databaseName={data.currentDatabase.name}
  canWriteToBase={data.canWriteToBase}
  actionUrl="?/update"
  availableQualities={data.availableQualities}
  initialData={data.qualityDefinitionsConfig}
/>

<DirtyModal />
