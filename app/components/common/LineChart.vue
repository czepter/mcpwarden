<script setup lang="ts">
import { formatNumber } from '~/lib/format'

/** Small line chart with round grid lines (0, half, top); the text alternative names the peak and the latest value. */
const props = defineProps<{ points: Array<{ t: string, v: number }>, label: string, start: string, end: string }>()
const W = 320; const H = 130; const L = 28; const R = 312; const T = 14; const B = 94
const top = computed(() => { const m = Math.max(1, ...props.points.map(p => p.v)); const step = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / step) * step })
const coords = computed(() => props.points.map((p, i) => `${L + (props.points.length > 1 ? (i / (props.points.length - 1)) * (R - L) : 0)},${B - (p.v / top.value) * (B - T)}`).join(' '))
const ticks = computed(() => [0, top.value / 2, top.value].map(v => ({ v, y: B - (v / top.value) * (B - T) })))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="label" class="h-auto w-full">
    <g class="stroke-border" stroke-width="1"><line v-for="t in ticks" :key="t.v" :x1="L" :y1="t.y" :x2="R" :y2="t.y" /></g>
    <g class="fill-muted-foreground" font-size="10">
      <text v-for="t in ticks" :key="t.v" :x="L - 6" :y="t.y + 4" text-anchor="end">{{ formatNumber(t.v) }}</text>
      <text :x="L" y="120">{{ start }}</text><text :x="R" y="120" text-anchor="end">{{ end }}</text>
    </g>
    <polyline fill="none" class="stroke-primary" stroke-width="2.5" stroke-linejoin="round" :points="coords" />
  </svg>
</template>
