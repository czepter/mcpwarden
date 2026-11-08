<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import LoadingButton from '~/components/common/LoadingButton.vue'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

// Rename the optional device label of a token or connection. `save` performs the API call; empty input clears the label.
const props = defineProps<{ open: boolean, subject: string, initial: string | null, save: (name: string | null) => Promise<unknown> }>()
const emit = defineEmits<{ 'update:open': [boolean], saved: [] }>()
const { t } = useI18n()
const value = ref('')
const busy = ref(false)
watch(() => props.open, (o) => { if (o) value.value = props.initial ?? '' }, { immediate: true })
async function onSubmit() {
  busy.value = true
  try { await props.save(value.value.trim() || null); toast.success(t('common.device.saved')); emit('saved'); emit('update:open', false) } catch { toast.error(t('common.device.failed')) } finally { busy.value = false }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
        <DialogHeader><DialogTitle>{{ $t('common.device.title', { name: subject }) }}</DialogTitle><DialogDescription>{{ $t('common.device.desc') }}</DialogDescription></DialogHeader>
        <div class="flex flex-col gap-1.5">
          <Label for="device-name">{{ $t('common.device.label') }}</Label>
          <Input id="device-name" v-model="value" maxlength="64" autocomplete="off" :placeholder="$t('common.device.placeholder')" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">{{ $t('common.cancel') }}</Button>
          <LoadingButton type="submit" :busy="busy">{{ $t('common.device.save') }}</LoadingButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
