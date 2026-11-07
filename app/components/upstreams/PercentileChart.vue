<script setup lang="ts">
import type { UpstreamStats } from '#shared/api-types'

/** Latency over time: p50 solid, p95 dashed, p99 dotted (line style carries the meaning, not just colour). */
const props = defineProps<{ series: UpstreamStats['series'], start: string, end: string, label: string }>()
const W = 400; const L = 36; const R = 392; const T = 20; const B = 140
const top = computed(() => { const m = Math.max(100, ...props.series.map(p => p.p99Ms ?? 0)); const step = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / step) * step })
const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s` : `${ms} ms`)
const ticks = computed(() => [0, 1, 2, 3].map(i => ({ v: (top.value / 3) * i, y: B - (i / 3) * (B - T) })))
function line(k: 'p50Ms' | 'p95Ms' | 'p99Ms') {
  const n = props.series.length
  return props.series.map((p, i) => (p[k] == null ? null : `${L + (n > 1 ? (i / (n - 1)) * (R - L) : 0)},${B - (p[k]! / top.value) * (B - T)}`)).filter(Boolean).join(' ')
}
</script>

<template>
  <svg :viewBox="`0 0 ${W} 170`" role="img" :aria-label="label" class="h-auto w-full">
    <g class="stroke-border" stroke-width="1"><line v-for="t in ticks" :key="t.y" :x1="L" :y1="t.y" :x2="R" :y2="t.y" /></g>
    <g class="fill-muted-foreground" font-size="10">
      <text v-for="t in ticks" :key="t.y" :x="L - 6" :y="t.y + 4" text-anchor="end">{{ fmt(Math.round(t.v)) }}</text>
      <text :x="L" y="162">{{ start }}</text><text :x="R" y="162" text-anchor="end">{{ end }}</text>
    </g>
    <polyline fill="none" stroke="var(--st-auth_expired-dot)" stroke-width="2" :points="line('p50Ms')" />
    <polyline fill="none" stroke="var(--st-degraded-dot)" stroke-width="2" stroke-dasharray="6 3" :points="line('p95Ms')" />
    <polyline fill="none" class="stroke-secondary-foreground" stroke-width="2" stroke-dasharray="2 3" :points="line('p99Ms')" />
  </svg>
</template>
