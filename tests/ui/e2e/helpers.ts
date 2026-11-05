import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export async function prep(page: Page, o: { role?: string, scenario?: string, mail?: 'on' | 'off' } = {}) {
  await page.addInitScript(([r, s, m]) => {
    if (!sessionStorage.getItem('__init')) { localStorage.setItem('mockRole', r!); localStorage.setItem('mockScenario', s!); localStorage.setItem('mockMail', m!); sessionStorage.setItem('__init', '1') }
    ;(globalThis as { __mockNoDelay?: boolean }).__mockNoDelay = true
  }, [o.role ?? 'admin', o.scenario ?? 'default', o.mail ?? 'on'])
}
export async function login(page: Page, o: { role?: string, scenario?: string } = {}) {
  await prep(page, o)
  await page.goto('/login')
  await page.getByLabel('E-Mail').fill('admin@example.test')
  await page.getByLabel('Passwort').fill('irgendeinpasswort')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
}
export async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const bad = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([])
}
