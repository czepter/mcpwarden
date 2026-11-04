<script setup lang="ts">
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '~/components/ui/alert-dialog'

withDefaults(defineProps<{ open: boolean, title: string, description?: string, confirmLabel?: string, destructive?: boolean }>(), { confirmLabel: 'Bestätigen', destructive: true, description: '' })
const emit = defineEmits<{ 'update:open': [v: boolean], 'confirm': [] }>()
</script>

<template>
  <AlertDialog :open="open" @update:open="emit('update:open', $event)">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <slot>{{ description }}</slot>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
        <AlertDialogAction :class="destructive ? 'bg-destructive-soft text-white hover:bg-destructive' : ''" @click="emit('confirm')">
          {{ confirmLabel }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
