<script setup lang="ts">
import { computed } from 'vue'
import { ApiError } from '~/api/http'
import { Button } from '~/components/ui/button'

const props = defineProps<{ error: unknown }>()
defineEmits<{ retry: [] }>()
const err = computed(() => (props.error instanceof ApiError ? props.error : null))
const forbidden = computed(() => err.value?.statusCode === 403)
const notFound = computed(() => err.value?.statusCode === 404)
</script>

<template>
  <div role="alert" class="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="error-state">
    <h3 class="text-[15px] font-semibold">
      {{ forbidden ? 'Kein Zugriff' : notFound ? 'Nicht gefunden' : 'Das hat nicht geklappt' }}
    </h3>
    <p class="max-w-md text-[13px] text-muted-foreground">
      {{ forbidden ? 'Du hast für diese Seite keine Berechtigung.' : notFound ? 'Diesen Eintrag gibt es nicht oder er gehört dir nicht.' : (err?.message ?? 'Unbekannter Fehler.') }}
    </p>
    <code v-if="err && !forbidden && !notFound" class="text-xs text-muted-foreground">{{ err.code }} · {{ err.statusCode }}</code>
    <Button v-if="!forbidden && !notFound" variant="outline" class="mt-2" @click="$emit('retry')">Erneut versuchen</Button>
  </div>
</template>
