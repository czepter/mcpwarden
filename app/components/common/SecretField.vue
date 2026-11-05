<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '~/components/ui/input-group'

// Only the value just typed; no prefilling. It is cleared on leaving (section 10).
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
    <InputGroupAddon align="inline-end" class="py-0 pr-0.5">
      <InputGroupButton type="button" class="-my-px h-11 min-w-11 px-3" :aria-pressed="shown" :aria-label="shown ? 'Verbergen' : 'Anzeigen'" @click="shown = !shown">
        <component :is="shown ? EyeOff : Eye" class="size-4" aria-hidden="true" />
        {{ shown ? 'Verbergen' : 'Anzeigen' }}
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
