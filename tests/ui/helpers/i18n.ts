import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createI18n } from 'vue-i18n'
import { setI18n } from '~/lib/i18n'

const dir = join(__dirname, '../../../i18n/locales')
export function loadMessages(locale: string): Record<string, unknown> {
  return Object.assign({}, ...readdirSync(join(dir, locale)).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, locale, f), 'utf8'))))
}

/** Real vue-i18n instance with the shipped locale files; also registers the global `t()` helper from ~/lib/i18n. */
export function makeI18n(locale: 'en' | 'de' = 'de') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en: loadMessages('en'), de: loadMessages('de') } as never })
  setI18n(i18n.global as never)
  return i18n
}
