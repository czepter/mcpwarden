import { config } from '@vue/test-utils'
import { useI18n } from 'vue-i18n'
import { makeI18n } from './helpers/i18n'

// The existing specs assert German UI text; the app itself defaults to English.
config.global.plugins = [...(config.global.plugins ?? []), makeI18n('de')]
// Nuxt auto-imports `useI18n`; mirror that for components mounted outside Nuxt.
;(globalThis as Record<string, unknown>).useI18n = useI18n
