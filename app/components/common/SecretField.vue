<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '~/components/ui/input-group'

// Nur der gerade getippte Wert; kein Vorbefuellen. Beim Verlassen wird er geleert (Abschnitt 10).
defineProps<{ id?: string, invalid?: boolean, describedby?: string }>()
const model = defineModel<string>({ default: '' })
const shown = ref(false)
onBeforeUnmount(() => { model.value = '' })
</script>

<template>
  <InputGroup class="h-11">
    <InputGroupInput
      :id="id" v-model="model" :type="shown ? 'text' : 'password'" autocomplete="new-password" spellcheck="false" autocapitalize="off"
      :aria-invalid="invalid || undefined" :aria-describedby="describedby" data-secret="true"
    />
    <InputGroupAddon align="inline-end">
      <InputGroupButton type="button" :aria-pressed="shown" :aria-label="shown ? 'Verbergen' : 'Anzeigen'" @click="shown = !shown">
        <component :is="shown ? EyeOff : Eye" class="size-4" aria-hidden="true" />
        {{ shown ? 'Verbergen' : 'Anzeigen' }}
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
