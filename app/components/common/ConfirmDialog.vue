<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'

const props = withDefaults(defineProps<{ open: boolean, title: string, description?: string, confirmLabel?: string, destructive?: boolean }>(), { confirmLabel: undefined, destructive: true, description: '' })
const emit = defineEmits<{ 'update:open': [v: boolean], 'confirm': [] }>()
// `confirm` is emitted before the dialog closes, as long as the page still has its state (e.g. the target).

const HOLD_MS = 700
const progress = ref(false) // drives the CSS fill
let timer: ReturnType<typeof setTimeout> | undefined
function finish() {
  cancel()
  emit('confirm')
  emit('update:open', false)
}
function start() {
  if (timer) return
  progress.value = true
  timer = setTimeout(finish, HOLD_MS)
}
function cancel() {
  clearTimeout(timer)
  timer = undefined
  progress.value = false
}
// Destructive actions need a deliberate hold with mouse/touch/keyboard. A click without a pointer
// (detail 0: assistive tech, scripted) confirms at once so nobody is locked out.
function onClick(e: MouseEvent) {
  if (!props.destructive || e.detail === 0) finish()
}
function onKey(e: KeyboardEvent) {
  if (!props.destructive || e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  start()
}
onBeforeUnmount(cancel)
</script>

<template>
  <AlertDialog :open="open" @update:open="cancel(); emit('update:open', $event)">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription as="div">
          <slot>{{ description }}</slot>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ $t('common.cancel') }}</AlertDialogCancel>
        <Button
          type="button" class="relative select-none overflow-hidden" :class="destructive ? 'bg-destructive-soft text-white hover:bg-destructive-soft/90' : ''"
          :aria-describedby="destructive ? 'hold-hint' : undefined"
          @click="onClick" @pointerdown="destructive && start()" @pointerup="cancel" @pointerleave="cancel" @pointercancel="cancel"
          @keydown="onKey" @keyup="cancel" @blur="cancel" @contextmenu.prevent
        >
          <span v-if="destructive" aria-hidden="true" class="hold-fill absolute inset-y-0 left-0 bg-black/30" :class="progress && 'is-holding'" :style="{ '--hold-ms': `${HOLD_MS}ms` }" />
          <span class="relative">{{ confirmLabel ?? $t('common.confirm') }}</span>
        </Button>
      </AlertDialogFooter>
      <p v-if="destructive" id="hold-hint" class="text-xs text-muted-foreground">{{ $t('common.holdToConfirm') }}</p>
    </AlertDialogContent>
  </AlertDialog>
</template>
