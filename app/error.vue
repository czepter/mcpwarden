<script setup lang="ts">
import type { NuxtError } from '#app'
import { Button } from '~/components/ui/button'

defineProps<{ error: NuxtError }>()
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
    <h1 class="text-xl font-semibold">{{ error.statusCode === 404 ? 'Seite nicht gefunden' : 'Etwas ist schiefgelaufen' }}</h1>
    <p class="text-[13px] text-muted-foreground">{{ error.statusCode === 404 ? 'Diese Adresse gibt es nicht.' : error.message }}</p>
    <Button @click="clearError({ redirect: '/' })">Zum Dashboard</Button>
  </main>
</template>
