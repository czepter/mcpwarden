<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Toaster position="bottom-right" />
</template>

<script setup lang="ts">
import Toaster from '~/components/ui/sonner/Sonner.vue'
import 'vue-sonner/style.css'
</script>
