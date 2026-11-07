<script setup lang="ts">
const { locale, locales, setLocale } = useI18n()
const options = computed(() => locales.value.map(l => (typeof l === 'string' ? { code: l, name: l } : { code: l.code, name: l.name ?? l.code })))
</script>

<template>
  <label class="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
    <span class="sr-only">{{ $t('common.language') }}</span>
    <select
      class="rounded-sm border bg-background px-2 py-1 text-[13px] text-foreground" data-testid="locale-switcher"
      :value="locale" :aria-label="$t('common.language')" @change="setLocale(($event.target as HTMLSelectElement).value as 'en' | 'de')"
    >
      <option v-for="o in options" :key="o.code" :value="o.code">{{ o.name }}</option>
    </select>
  </label>
</template>
