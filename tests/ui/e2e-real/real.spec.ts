// E2E against the real backend (no MSW): first registration via the UI, login, dashboard, create and list upstream.
// The tests share a fresh instance and therefore run one after another.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { startFakeHttp, type FakeHttp } from '../../fixtures/fake-upstream/http'

test.describe.configure({ mode: 'serial' })

const ADMIN = { name: 'Real Admin', email: 'real-admin@example.test', password: 'real-admin-password-1' }
let fake: FakeHttp
const mockRequests: string[] = []

test.beforeAll(async () => { fake = await startFakeHttp() })
test.afterAll(async () => { await fake.close() })

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const bad = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([])
}
// The real build renders server-side: inputs before hydration are reset by Vue to the model value (empty) on mounting.
async function hydrated(page: Page) {
  await page.waitForFunction(() => (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp?.().isHydrating === false)
}
async function login(page: Page) {
  await page.goto('/login')
  await hydrated(page)
  await page.getByLabel('E-Mail').fill(ADMIN.email)
  await page.getByLabel('Passwort').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
}

test.beforeEach(({ page }) => {
  page.on('request', (r) => { if (/mockServiceWorker|\/__styleguide/.test(r.url())) mockRequests.push(r.url()) })
})

test('real build: no service worker, no mock banner, registration open on a fresh instance', async ({ page }) => {
  await page.goto('/login')
  // public-config.registrationOpen=true: the login page sends the first visitor to the registration
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading', { name: 'Registrieren', level: 1 })).toBeVisible()
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  await expect(page.getByText('Mock')).toHaveCount(0)
  expect((await page.request.get('/mockServiceWorker.js')).status()).not.toBe(200)
  await axe(page)
})

test('First registration via the UI makes the user an admin and lands on the dashboard', async ({ page }) => {
  await page.goto('/login')
  await expect(page).toHaveURL(/\/register$/)
  await page.getByLabel('Name').fill(ADMIN.name)
  await page.getByLabel('E-Mail').fill(ADMIN.email)
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.password)
  await page.getByLabel('Passwort bestätigen').fill(ADMIN.password)
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
  // Phase 2 pages without a backend route are not in the navigation
  await expect(page.getByRole('link', { name: 'Statistik' })).toHaveCount(0)
})

test('afterwards: registration only with an invitation; wrong password shows an error; login with correct credentials', async ({ page }) => {
  await page.goto('/login')
  await hydrated(page)
  await expect(page.getByText('nur mit Einladung')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Registrieren' })).toHaveCount(0)
  await page.getByLabel('E-Mail').fill(ADMIN.email)
  await page.getByLabel('Passwort').fill('wrong-password-123')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  await login(page)
  await axe(page)
})

test('Dashboard with real data: empty, navigation, pages without a backend redirect', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
  await page.goto('/stats')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
})

test('Upstream list: empty; create upstream via the UI (SSRF exception by the admin), connection ok, in the list', async ({ page }) => {
  await login(page)
  const base = new URL(page.url()).origin
  const put = await page.request.put('/api/admin/settings', { data: { 'ssrf.allow': ['127.0.0.0/8'] }, headers: { origin: base } })
  expect(put.status()).toBe(200)

  await page.goto('/upstreams')
  await expect(page.getByRole('heading', { name: 'Upstreams', level: 1 })).toBeVisible()
  await expect(page.getByText('Noch kein Upstream')).toBeVisible()

  await page.goto('/upstreams/new')
  // Phase 1: only HTTP and stdio, only None/Bearer/Header (no REST, no OAuth)
  await expect(page.getByText('REST')).toHaveCount(0)
  await expect(page.getByText('OAuth')).toHaveCount(0)
  await page.getByLabel('Anzeigename').fill('Fake MCP')
  await page.getByLabel('Kurzname').fill('fake')
  await page.getByLabel('Server-URL').fill(fake.url)
  await page.getByRole('button', { name: 'Anlegen und verbinden' }).click()
  await expect(page.getByRole('heading', { name: /„Fake MCP“ wurde angelegt/ })).toBeVisible()
  await expect(page.getByText(/echo/).first()).toBeVisible() // test result lists the tools of the fake upstream
  expect(fake.state.calls).toBeDefined()

  await page.goto('/upstreams')
  const row = page.getByRole('row').filter({ hasText: 'Fake MCP' })
  await expect(row).toBeVisible()
  await expect(row.getByText('HTTP')).toBeVisible()
  await axe(page)
  await page.getByRole('link', { name: /Fake MCP/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Fake MCP', level: 1 })).toBeVisible()
})

test('Admin pages and settings load against real routes', async ({ page }) => {
  await login(page)
  for (const [path, h1] of [['/admin/users', 'Admin'], ['/settings/tokens', 'Tokens'], ['/settings/connections', 'Clients'], ['/audit', 'Audit']] as const) {
    await page.goto(path)
    await expect(page.locator('h1').first()).toContainText(h1)
    await expect(page.getByText(/Fehler|nicht geladen/i)).toHaveCount(0)
  }
})

test.afterAll(() => { expect(mockRequests).toEqual([]) })
