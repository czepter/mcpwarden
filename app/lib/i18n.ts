/**
 * Translation helper for code outside components (labels, zod schemas, formatters, API errors).
 * Components use `useI18n().t` / `$t` directly. Call `t()` lazily (inside functions / zod `error` callbacks), never at module load.
 */
import type { Composer } from 'vue-i18n'

let instance: Composer | null = null
export function setI18n(c: Composer) { instance = c }

export function t(key: string, named?: Record<string, unknown>): string {
  return instance ? (named ? instance.t(key, named) : instance.t(key)) : key
}
/** BCP 47 tag of the active locale (for Intl / toLocale*String). */
export function currentLanguage(): string {
  const code = instance?.locale.value ?? 'en'
  return code === 'de' ? 'de-DE' : 'en-US'
}
