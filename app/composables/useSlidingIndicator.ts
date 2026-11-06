import { onMounted, ref, watch, type Ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'

/** Measures the active child of `container` so a single indicator can travel between items. */
export function useSlidingIndicator(container: Ref<HTMLElement | null>, active: () => unknown) {
  const style = ref<Record<string, string>>({ opacity: '0' })
  function measure() {
    const el = container.value?.querySelector<HTMLElement>('[data-active="true"]')
    if (!el) { style.value = { opacity: '0' }; return }
    style.value = { opacity: '1', width: `${el.offsetWidth}px`, transform: `translateX(${el.offsetLeft}px)` }
  }
  onMounted(measure)
  watch(active, () => nextTick(measure), { flush: 'post' })
  useResizeObserver(container, measure)
  return style
}
