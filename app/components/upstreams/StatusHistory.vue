<script setup lang="ts">
import type { HealthHistory, HealthHour } from '#shared/api-types'
import { formatPercent } from '~/lib/format'

/**
 * Availability and status history (draft `Detail`): 24 bars for the last day, below a heatmap of 7 days x 24 hours.
 * Colour is never the only carrier: every cell has a text title, the legend names the four states, and the text alternative
 * reports the hours with problems.
 */
const props = defineProps<{ history: HealthHistory }>()
const { t, locale } = useI18n()
const COLOR: Record<HealthHour, string> = { ok: 'var(--st-healthy-bar)', warn: 'var(--st-degraded-bar)', err: 'var(--st-open-bar)', none: '' }
const HATCH = 'repeating-linear-gradient(45deg, var(--muted), var(--muted) 3px, var(--st-disabled-bar) 3px, var(--st-disabled-bar) 4px)'
const bg = (h: HealthHour) => (h === 'none' ? HATCH : COLOR[h])
const last24 = computed(() => props.history.hours.slice(-24))
// Rows are calendar days (local time), columns the hour of the day; hours outside the 168-hour grid stay empty.
const rows = computed(() => {
  const start = new Date(props.history.start).getTime()
  const days = new Map<string, { label: string, short: string, cells: Array<{ h: HealthHour, tip: string }> }>()
  props.history.hours.forEach((h, i) => {
    const d = new Date(start + i * 3_600_000)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let row = days.get(key)
    if (!row) {
      const long = d.toLocaleDateString(locale.value, { weekday: 'short', day: '2-digit', month: '2-digit' })
      days.set(key, (row = { label: long, short: d.toLocaleDateString(locale.value, { weekday: 'short' }), cells: Array.from({ length: 24 }, (_, hh) => ({ h: 'none' as HealthHour, tip: `${long} ${String(hh).padStart(2, '0')}: ${t('upstreams.stats.legend.none')}` })) }))
    }
    const hh = d.getHours()
    row.cells[hh] = { h, tip: `${row.label} ${String(hh).padStart(2, '0')}: ${t(`upstreams.stats.legend.${h}`)}` }
  })
  return [...days.values()]
})
const problems = computed(() => props.history.hours.filter(h => h === 'err').length)
const aria = computed(() => t('upstreams.stats.heatAria', { err: problems.value, warn: props.history.hours.filter(h => h === 'warn').length }))
const availClass = computed(() => (props.history.availability == null ? 'bg-muted text-secondary-foreground' : props.history.availability >= 0.99 ? 'bg-ok-bg text-ok-fg' : 'bg-warn-bg text-warn-fg'))
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-[15px] font-semibold">{{ $t('upstreams.stats.statusTitle') }}</h3>
      <span class="rounded-md px-2.5 py-1 text-[13px] font-semibold" :class="availClass">{{ history.availability == null ? $t('upstreams.stats.availableNone') : $t('upstreams.stats.available', { pct: formatPercent(history.availability, 1) }) }}</span>
    </div>
    <div class="flex items-center gap-[3px]" aria-hidden="true"><span v-for="(h, i) in last24" :key="i" class="h-9 min-w-1 flex-1 rounded-[3px]" :style="{ background: bg(h) }" :title="$t(`upstreams.stats.legend.${h}`)" /></div>
    <div class="flex justify-between text-xs text-muted-foreground"><span>{{ $t('upstreams.stats.ago24h') }}</span><span>{{ $t('stats.now') }}</span></div>
    <div class="flex flex-col gap-1.5 border-t pt-2.5">
      <div class="text-xs font-medium text-secondary-foreground">{{ $t('upstreams.stats.heatTitle') }}</div>
      <div class="overflow-x-auto">
        <div role="img" :aria-label="aria" class="flex min-w-[300px] flex-col gap-0.5">
          <div class="grid grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-0.5 text-[10px] text-muted-foreground"><span /><span v-for="h in 24" :key="h">{{ (h - 1) % 6 === 0 ? h - 1 : '' }}</span></div>
          <div v-for="r in rows" :key="r.label" class="grid grid-cols-[28px_repeat(24,minmax(0,1fr))] items-center gap-0.5">
            <span class="text-[10px] text-secondary-foreground">{{ r.short }}</span>
            <span v-for="(c, i) in r.cells" :key="i" :title="c.tip" class="block h-3 rounded-[2px]" :style="{ background: bg(c.h) }" />
          </div>
        </div>
      </div>
      <ul class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-secondary-foreground">
        <li v-for="h in (['ok', 'warn', 'err', 'none'] as const)" :key="h" class="inline-flex items-center gap-1"><span class="size-2.5 rounded-[2px]" :style="{ background: bg(h) }" aria-hidden="true" />{{ $t(`upstreams.stats.legend.${h}`) }}</li>
      </ul>
    </div>
  </div>
</template>
