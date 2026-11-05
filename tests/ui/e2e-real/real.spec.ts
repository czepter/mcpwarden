// E2E gegen das echte Backend (kein MSW): Erst-Registrierung ueber die Oberflaeche, Login, Dashboard, Upstream anlegen und listen.
// Die Tests teilen sich eine frische Instanz und laufen deshalb der Reihe nach.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { startFakeHttp, type FakeHttp } from '../../fixtures/fake-upstream/http'

test.describe.configure({ mode: 'serial' })

const ADMIN = { name: 'Real Admin', email: 'real-admin@example.test', password: 'real-admin-passwort-1' }
let fake: FakeHttp
const mockRequests: string[] = []

test.beforeAll(async () => { fake = await startFakeHttp() })
test.afterAll(async () => { await fake.close() })

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const bad = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([])
}
async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('E-Mail').fill(ADMIN.email)
  await page.getByLabel('Passwort').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
}

test.beforeEach(({ page }) => {
  page.on('request', (r) => { if (/mockServiceWorker|\/__styleguide/.test(r.url())) mockRequests.push(r.url()) })
})

test('echter Build: kein Service Worker, kein Mock-Banner, Registrierung offen auf frischer Instanz', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Anmelden', level: 1 })).toBeVisible()
  // public-config.registrationOpen=true: Link zur Registrierung statt "nur mit Einladung"
  await expect(page.getByRole('link', { name: 'Registrieren' })).toBeVisible()
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  await expect(page.getByText('Mock')).toHaveCount(0)
  expect((await page.request.get('/mockServiceWorker.js')).status()).not.toBe(200)
  await axe(page)
})

test('Erst-Registrierung ueber die Oberflaeche macht den Nutzer zum Admin und landet auf dem Dashboard', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Registrieren' }).click()
  await expect(page).toHaveURL(/\/register$/)
  await page.getByLabel('Name').fill(ADMIN.name)
  await page.getByLabel('E-Mail').fill(ADMIN.email)
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.password)
  await page.getByLabel('Passwort bestätigen').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
  // Phase-2-Seiten ohne Backend-Route sind nicht in der Navigation
  await expect(page.getByRole('link', { name: 'Statistik' })).toHaveCount(0)
})

test('danach: Registrierung nur mit Einladung; falsches Passwort zeigt Fehler; Login mit richtigen Daten', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('nur mit Einladung')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Registrieren' })).toHaveCount(0)
  await page.getByLabel('E-Mail').fill(ADMIN.email)
  await page.getByLabel('Passwort').fill('falsches-passwort-123')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  await login(page)
  await axe(page)
})

test('Dashboard mit echten Daten: leer, Navigation, Seiten ohne Backend leiten um', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
  await page.goto('/stats')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
})

test('Upstream-Liste: leer; Upstream ueber die Oberflaeche anlegen (SSRF-Ausnahme durch den Admin), Verbindung ok, in der Liste', async ({ page }) => {
  await login(page)
  const base = new URL(page.url()).origin
  const put = await page.request.put('/api/admin/settings', { data: { 'ssrf.allow': ['127.0.0.0/8'] }, headers: { origin: base } })
  expect(put.status()).toBe(200)

  await page.goto('/upstreams')
  await expect(page.getByRole('heading', { name: 'Upstreams', level: 1 })).toBeVisible()
  await expect(page.getByText('Noch kein Upstream')).toBeVisible()

  await page.goto('/upstreams/new')
  // Phase 1: nur HTTP und stdio, nur Keine/Bearer/Header (kein REST, kein OAuth)
  await expect(page.getByText('REST')).toHaveCount(0)
  await expect(page.getByText('OAuth')).toHaveCount(0)
  await page.getByLabel('Anzeigename').fill('Fake MCP')
  await page.getByLabel('Kurzname').fill('fake')
  await page.getByLabel('Server-URL').fill(fake.url)
  await page.getByRole('button', { name: 'Anlegen und verbinden' }).click()
  await expect(page.getByRole('heading', { name: /„Fake MCP“ wurde angelegt/ })).toBeVisible()
  await expect(page.getByText(/echo/).first()).toBeVisible() // Testergebnis listet die Tools des Fake-Upstreams
  expect(fake.state.calls).toBeDefined()

  await page.goto('/upstreams')
  const row = page.getByRole('row').filter({ hasText: 'Fake MCP' })
  await expect(row).toBeVisible()
  await expect(row.getByText('HTTP')).toBeVisible()
  await axe(page)
  await page.getByRole('link', { name: /Fake MCP/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Fake MCP', level: 1 })).toBeVisible()
})

test('Admin-Seiten und Einstellungen laden gegen echte Routen', async ({ page }) => {
  await login(page)
  for (const [path, h1] of [['/admin/users', 'Admin'], ['/settings/tokens', 'Tokens'], ['/settings/connections', 'Clients'], ['/audit', 'Audit']] as const) {
    await page.goto(path)
    await expect(page.locator('h1').first()).toContainText(h1)
    await expect(page.getByText(/Fehler|nicht geladen/i)).toHaveCount(0)
  }
})

test.afterAll(() => { expect(mockRequests).toEqual([]) })
