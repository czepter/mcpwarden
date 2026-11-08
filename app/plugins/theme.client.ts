export default defineNuxtPlugin(() => {
  const { theme, apply } = useTheme()
  apply()
  watch(theme, apply)
  // 'system' follows the OS while the page is open
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
})
