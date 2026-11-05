<script setup lang="ts">
import type { UpstreamTestResult as TestResultT, UpstreamDetail } from '#shared/api-types'
import { meApi } from '~/api'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import TestResult from '~/components/upstreams/TestResult.vue'
import UpstreamForm from '~/components/upstreams/UpstreamForm.vue'

useHead({ title: 'Upstream anlegen · mcpwarden' })
const { data: caps, error, refresh } = useApi('caps', meApi.capabilities)
const done = ref<{ u: UpstreamDetail, test: TestResultT | null } | null>(null)
</script>

<template>
  <PageHeader title="Upstream anlegen" :crumbs="[{ label: 'Upstreams', to: '/upstreams' }]" />
  <ErrorState v-if="error" :error="error" @retry="refresh()" />
  <LoadingRows v-else-if="!caps" :rows="5" />
  <div v-else-if="done" class="flex max-w-[600px] flex-col gap-4 rounded-lg border bg-card p-5">
    <h2 class="text-base font-semibold">„{{ done.u.name }}“ wurde angelegt</h2>
    <TestResult v-if="done.test" :result="done.test" />
    <div class="flex gap-2"><Button as-child><NuxtLink :to="`/upstreams/${done.u.id}`">Zum Upstream</NuxtLink></Button></div>
  </div>
  <UpstreamForm v-else :caps="caps" @saved="(u, test) => (done = { u, test })" />
</template>
