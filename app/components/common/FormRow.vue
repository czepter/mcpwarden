<script setup lang="ts">
import { computed } from 'vue'
import { Field, FieldDescription, FieldError, FieldLabel } from '~/components/ui/field'

const props = defineProps<{ id: string, label: string, error?: string, description?: string, optional?: boolean }>()
const describedby = computed(() => [props.description && `${props.id}-d`, props.error && `${props.id}-e`].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <Field :data-invalid="!!error || undefined">
    <FieldLabel :for="id">{{ label }}<span v-if="optional" class="font-normal text-muted-foreground"> (optional)</span></FieldLabel>
    <slot :id="id" :invalid="!!error" :describedby="describedby" />
    <FieldDescription v-if="description" :id="`${id}-d`">{{ description }}</FieldDescription>
    <FieldError v-if="error" :id="`${id}-e`" :errors="[error]" />
  </Field>
</template>
