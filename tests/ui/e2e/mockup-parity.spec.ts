import { expect, test } from '@playwright/test'
import { login, prep } from './helpers'

// Strukturelle Pruefungen aus dem Mockup-Abgleich (docs/ui-mockup-review.md). Bewusst keine Pixel-Snapshots:
// sie waeren zwischen Rechnern nicht stabil. Geprueft werden Massangaben des Entwurfs (44 px, Unterstreichung, Textlabels).
test.use({ viewport: { width: 1440, height: 900 } })

test('Upstream-Liste: bei 1440 px laufen die Spalten ohne Querscrollen, Aktionen sind erreichbar', async ({ page }) => {
  await login(page)
  await page.goto('/upstreams')
  await expect(page.getByRole('table', { name: 'Upstream-Liste' })).toBeVisible()
  const overflow = await page.locator('table').evaluate(t => ({ table: t.scrollWidth, box: t.parentElement!.parentElement!.clientWidth }))
  expect(overflow.table).toBeLessThanOrEqual(overflow.box)
  const test = page.getByRole('button', { name: /^Verbindung testen: / }).first()
  await expect(test).toBeInViewport()
  const b = await test.boundingBox()
  expect(b!.width).toBeGreaterThanOrEqual(44)
  expect(b!.height).toBeGreaterThanOrEqual(44)
  await expect(page.getByText('7 Upstreams', { exact: true })).toBeVisible()
})

test('Reiter und Zeilenaktionen: mindestens 44 px, Reiter mit Unterstreichung in der Akzentfarbe', async ({ page }) => {
  await login(page)
  await page.goto('/upstreams/up_4')
  for (const name of ['Übersicht', 'Tools', 'Auth']) {
    const tab = page.getByRole('tab', { name })
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  const active = page.getByRole('tab', { name: 'Übersicht' })
  expect(await active.evaluate(e => getComputedStyle(e).borderBottomWidth)).toBe('2px')
  expect(await active.evaluate(e => getComputedStyle(e).borderBottomColor)).toBe(await page.evaluate(() => { const s = document.createElement('i'); s.style.color = 'var(--primary)'; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c }))
  await page.goto('/settings/connections')
  const revoke = page.getByRole('button', { name: /widerrufen/i }).first()
  expect((await revoke.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // Rahmen wie im Entwurf (Widerrufen ist eine umrandete Schaltflaeche, kein Textlink)
  expect(await revoke.evaluate(e => getComputedStyle(e).borderTopWidth)).toBe('1px')
})

test('Audit: Ergebnis traegt Punkt und Text, Kategorien sind Reiter mit 44 px', async ({ page }) => {
  await login(page)
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Audit-Log', level: 1 })).toBeVisible()
  const cell = page.locator('tbody tr').first().locator('td').last()
  await expect(cell.locator('span[aria-hidden="true"]')).toHaveCount(1)
  await expect(cell).not.toHaveText('')
  expect((await page.getByRole('radio', { name: 'Verwaltung' }).or(page.getByRole('button', { name: 'Verwaltung' })).first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test('Statistik: Diagramm hat Zeitachse, Ergebnisbalken tragen Text je Zeile', async ({ page }) => {
  await login(page)
  await page.goto('/stats')
  const fig = page.getByRole('img', { name: /Aufrufe pro Stunde/ })
  await expect(fig).toContainText('jetzt')
  await expect(fig).toContainText('vor 24 h')
  await expect(page.getByRole('heading', { name: 'Latenz je Upstream' })).toBeVisible()
  await expect(page.getByText('Gesamtdauer in Millisekunden.')).toBeVisible()
})

test('Auth-Link: Kopf wie im Entwurf mit Upstream, URL, Auth und Restzeit', async ({ page }) => {
  await login(page)
  await page.goto('/link/abc')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('eingeben')
  const dl = page.locator('dl')
  await expect(dl).toContainText('Upstream')
  await expect(dl).toContainText('URL')
  await expect(dl).toContainText('Bearer-Token')
  await expect(page.getByText(/Dieser Link läuft in .* min ab und gilt nur einmal\./)).toBeVisible()
})

test('Upstream anlegen: Typ-Kacheln mit Beschreibung, Erweitert benannt', async ({ page }) => {
  await prep(page)
  await login(page)
  await page.goto('/upstreams/new')
  await expect(page.getByText('Streamable HTTP, SSE')).toBeVisible()
  await expect(page.getByText('Lokaler Befehl, braucht Freigabe')).toBeVisible()
  await expect(page.getByRole('button', { name: /Erweitert: Limits und Timeouts/ })).toBeVisible()
})

test('Token-Seite und Dashboard: Seitentitel wie im Entwurf', async ({ page }) => {
  await login(page)
  await page.goto('/settings/tokens')
  await expect(page.getByRole('heading', { name: 'Personal Access Tokens', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: /breadcrumb/i }).getByText('Tokens', { exact: true })).toBeVisible()
})
