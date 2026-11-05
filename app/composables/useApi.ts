import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import type { Ref } from 'vue'

/** Data fetching only in the browser (A5). Pages never call $fetch directly. */
export function useApi<T>(key: string, fn: () => Promise<T>) {
  return useAsyncData<T>(key, fn, { server: false, lazy: true })
}

/** Auto-refresh in seconds (0 = off); pauses when the tab is hidden. */
export function usePolling(refresh: () => unknown, seconds: Ref<number>) {
  const visibility = useDocumentVisibility()
  const { pause, resume } = useIntervalFn(() => { if (visibility.value === 'visible') refresh() }, () => Math.max(seconds.value, 1) * 1000, { immediate: false })
  watch(seconds, s => (s > 0 ? resume() : pause()), { immediate: true })
}
