<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Toaster position="bottom-right" />
</template>

<script setup lang="ts">
import Toaster from '~/components/ui/sonner/Sonner.vue'
import 'vue-sonner/style.css'

const head = useLocaleHead({ dir: false, seo: false })
useHead({ htmlAttrs: { lang: () => head.value.htmlAttrs?.lang } })
</script>
