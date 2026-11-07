import { setI18n } from '~/lib/i18n'

export default defineNuxtPlugin((nuxtApp) => {
  setI18n(nuxtApp.$i18n as never)
})
