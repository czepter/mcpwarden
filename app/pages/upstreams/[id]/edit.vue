<script setup lang="ts">
import { meApi, upstreamApi } from '~/api'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import UpstreamForm from '~/components/upstreams/UpstreamForm.vue'

const { t } = useI18n()
useHead({ title: () => `${t('upstreams.edit.title')} · mcpwarden` })
const id = String(useRoute().params.id)
const up = useApi(`up-${id}`, () => upstreamApi.get(id))
const caps = useApi('caps', meApi.capabilities)
</script>

<template>
  <PageHeader :title="$t('upstreams.edit.title')" :crumbs="[{ label: $t('upstreams.list.title'), to: '/upstreams' }]" />
  <ErrorState v-if="up.error.value" :error="up.error.value" @retry="up.refresh()" />
  <LoadingRows v-else-if="!up.data.value || !caps.data.value" :rows="5" />
  <UpstreamForm v-else :caps="caps.data.value" :initial="up.data.value" @saved="navigateTo(`/upstreams/${id}`)" />
</template>
