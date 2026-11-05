<script setup lang="ts">
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '~/components/ui/breadcrumb'
import { SidebarTrigger } from '~/components/ui/sidebar'

defineProps<{ title: string, crumb?: string, description?: string, crumbs?: Array<{ label: string, to?: string }> }>()
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-3 py-1">
    <div class="flex items-start gap-2">
      <SidebarTrigger class="min-[700px]:hidden size-11" aria-label="Navigation öffnen" />
      <div class="flex flex-col gap-0.5">
        <Breadcrumb>
          <BreadcrumbList class="text-xs">
            <BreadcrumbItem><BreadcrumbLink as-child><NuxtLink to="/">Home</NuxtLink></BreadcrumbLink></BreadcrumbItem>
            <template v-for="c in crumbs ?? []" :key="c.label">
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbLink v-if="c.to" as-child><NuxtLink :to="c.to">{{ c.label }}</NuxtLink></BreadcrumbLink><span v-else>{{ c.label }}</span></BreadcrumbItem>
            </template>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{{ crumb ?? title }}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <h1 class="text-xl font-semibold tracking-tight">{{ title }}</h1>
        <p v-if="description" class="text-[13px] text-muted-foreground">{{ description }}</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2"><slot /></div>
  </header>
</template>
