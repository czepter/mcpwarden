<script setup lang="ts">
// Nur im Mock-Modus erreichbar: nuxt.config.ts entfernt die Route aus Produktions-Builds (hook pages:extend).
import { ref } from 'vue'
import EmptyState from '~/components/common/EmptyState.vue'
import FormRow from '~/components/common/FormRow.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import OneTimeSecret from '~/components/common/OneTimeSecret.vue'
import SecretField from '~/components/common/SecretField.vue'
import SparkBars from '~/components/common/SparkBars.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import StatusDot from '~/components/common/StatusDot.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { HEALTH_VALUES, SETUP_VALUES, OUTCOME_VALUES, healthLabel, outcomeLabel, setupLabel } from '~/lib/labels'

useHead({ title: 'Styleguide · mcpwarden', meta: [{ name: 'robots', content: 'noindex' }] })
const secret = ref('')
const tokens = ['background', 'foreground', 'card', 'primary', 'secondary', 'muted', 'accent', 'destructive', 'border', 'input-strong', 'ring']
</script>

<template>
  <PageHeader title="Styleguide" description="Farben, Status, Typografie und Bausteine. Nur im Mock-Modus." />
  <section class="rounded-lg border bg-card p-5" aria-labelledby="sg-farben">
    <h2 id="sg-farben" class="mb-3 text-base font-semibold">Farben</h2>
    <ul class="grid grid-cols-2 gap-3 min-[700px]:grid-cols-4">
      <li v-for="t in tokens" :key="t" class="flex items-center gap-2">
        <span class="size-8 rounded-sm border" :style="{ background: `var(--${t})` }" aria-hidden="true" />
        <code class="text-xs">--{{ t }}</code>
      </li>
    </ul>
  </section>
  <section class="rounded-lg border bg-card p-5" aria-labelledby="sg-status">
    <h2 id="sg-status" class="mb-3 text-base font-semibold">Status (immer Farbe plus Text)</h2>
    <ul class="flex flex-wrap gap-3">
      <li v-for="h in HEALTH_VALUES" :key="h" class="flex items-center gap-2"><StatusBadge :status="h" /><code class="text-xs">{{ h }} = {{ healthLabel(h) }}</code></li>
    </ul>
    <ul class="mt-3 flex flex-wrap gap-3">
      <li v-for="s in SETUP_VALUES.filter(v => v !== 'ready')" :key="s" class="flex items-center gap-2"><StatusBadge status="healthy" :setup="s" /><code class="text-xs">{{ s }} = {{ setupLabel(s) }}</code></li>
    </ul>
    <ul class="mt-3 flex flex-wrap gap-3 text-[13px]">
      <li v-for="o in OUTCOME_VALUES" :key="o"><code class="text-xs">{{ o }}</code> = {{ outcomeLabel(o) }}</li>
    </ul>
    <p class="mt-3 flex items-center gap-4 text-[13px]"><span><StatusDot :active="true" /> aktiv</span><span><StatusDot :active="false" /> inaktiv</span></p>
  </section>
  <section class="rounded-lg border bg-card p-5" aria-labelledby="sg-typo">
    <h2 id="sg-typo" class="mb-3 text-base font-semibold">Typografie</h2>
    <p class="text-xl font-semibold">Überschrift 20 px, Inter</p>
    <p>Fließtext 14 px mit Zahlen <span class="tnum">9 874</span> und <code>mono_text</code>.</p>
    <p class="text-[13px] text-secondary-foreground">Sekundärtext 13 px</p>
    <p class="text-xs text-muted-foreground">Hilfetext 12 px</p>
  </section>
  <section class="rounded-lg border bg-card p-5" aria-labelledby="sg-form">
    <h2 id="sg-form" class="mb-3 text-base font-semibold">Schaltflächen und Formularzeilen</h2>
    <div class="mb-4 flex flex-wrap gap-2">
      <Button>Primär</Button><Button variant="outline">Sekundär</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Löschen</Button><Button disabled>Deaktiviert</Button>
    </div>
    <div class="grid max-w-md gap-4">
      <FormRow id="sg-name" label="Anzeigename" description="Hilfetext unter dem Feld."><Input id="sg-name" /></FormRow>
      <FormRow id="sg-err" label="Mit Fehler" error="So sieht ein Feldfehler aus."><Input id="sg-err" aria-invalid="true" /></FormRow>
      <FormRow id="sg-secret" label="Secret"><SecretField id="sg-secret" v-model="secret" /></FormRow>
    </div>
  </section>
  <section class="rounded-lg border bg-card p-5" aria-labelledby="sg-bausteine">
    <h2 id="sg-bausteine" class="mb-3 text-base font-semibold">Bausteine</h2>
    <div class="mb-4 grid gap-3 min-[700px]:grid-cols-3">
      <KpiCard label="Aufrufe/min" value="42" note="Beispiel" />
      <KpiCard label="Erfolgsrate" value="98,7" unit="%" />
      <KpiCard label="p95" value="212" unit="ms" />
    </div>
    <SparkBars :items="['ok', 'ok', 'warn', 'err', 'none', 'ok']" />
    <div class="my-4"><OneTimeSecret title="Token „beispiel“ erzeugt" value="mcpw_pat_BEISPIELWERT" /></div>
    <LoadingRows :rows="2" />
    <EmptyState title="Noch nichts da" text="So sieht ein Leerzustand aus." />
  </section>
</template>
