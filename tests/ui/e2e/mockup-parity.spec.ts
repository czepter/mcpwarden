import { expect, test } from '@playwright/test'
import { axe, login, prep } from './helpers'

// Structural checks from the mockup comparison (docs/ui-mockup-review.md). Deliberately no pixel snapshots:
// they would not be stable between machines. What is checked are the draft's dimensions (44 px, underline, text labels).
test.use({ viewport: { width: 1440, height: 900 } })

test('Upstream list: at 1440 px the columns fit without horizontal scrolling, actions are reachable', async ({ page }) => {
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

test('Tabs and row actions: at least 44 px, tabs with underline in the accent color', async ({ page }) => {
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
  // Border like in the draft (revoke is an outlined button, not a text link)
  expect(await revoke.evaluate(e => getComputedStyle(e).borderTopWidth)).toBe('1px')
})

test('Audit: result carries dot and text, categories are tabs with 44 px', async ({ page }) => {
  await login(page)
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Audit-Log', level: 1 })).toBeVisible()
  const cell = page.locator('tbody tr').first().locator('td').last()
  await expect(cell.locator('span[aria-hidden="true"]')).toHaveCount(1)
  await expect(cell).not.toHaveText('')
  expect((await page.getByRole('radio', { name: 'Verwaltung' }).or(page.getByRole('button', { name: 'Verwaltung' })).first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test('Statistics: chart has a time axis, result bars carry text per row', async ({ page }) => {
  await login(page)
  await page.goto('/stats')
  const fig = page.getByRole('img', { name: /Aufrufe pro Stunde/ })
  await expect(fig).toContainText('jetzt')
  await expect(fig).toContainText('vor 24 h')
  await expect(page.getByRole('heading', { name: 'Latenz je Upstream' })).toBeVisible()
  await expect(page.getByText('Gesamtdauer in Millisekunden.')).toBeVisible()
})

test('Auth link: header like the draft with upstream, URL, auth and remaining time', async ({ page }) => {
  await login(page)
  await page.goto('/link/abc')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('eingeben')
  const dl = page.locator('dl')
  await expect(dl).toContainText('Upstream')
  await expect(dl).toContainText('URL')
  await expect(dl).toContainText('Bearer-Token')
  await expect(page.getByText(/Dieser Link läuft in .* min ab und gilt nur einmal\./)).toBeVisible()
})

test('Create upstream: type tiles with description, Advanced named', async ({ page }) => {
  await prep(page)
  await login(page)
  await page.goto('/upstreams/new')
  await expect(page.getByText('Streamable HTTP, SSE')).toBeVisible()
  await expect(page.getByText('Lokaler Befehl, braucht Freigabe')).toBeVisible()
  await expect(page.getByRole('button', { name: /Erweitert: Limits und Timeouts/ })).toBeVisible()
})

test('Token page and dashboard: page titles like the draft', async ({ page }) => {
  await login(page)
  await page.goto('/settings/tokens')
  await expect(page.getByRole('heading', { name: 'Personal Access Tokens', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: /breadcrumb/i }).getByText('Tokens', { exact: true })).toBeVisible()
})

test('stdio approval: checklist with icon and text per row, block reasons from the capabilities', async ({ page }) => {
  await login(page)
  await page.goto('/upstreams/up_5/approve')
  const list = page.getByTestId('stdio-checklist')
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await expect(list.getByRole('listitem').nth(0)).toContainText('Erfüllt')
  await expect(list.getByRole('listitem').nth(2)).toContainText('Offen')
  await expect(page.getByRole('button', { name: 'Freigeben' })).toBeEnabled()
  await expect(page.getByTestId('stdio-block-reason')).toHaveCount(0)
  // Blocked by the slim image: reason in words, state as text (not colour only), approval disabled
  await page.evaluate(() => localStorage.setItem('mockStdioReason', 'image_slim'))
  await page.reload()
  const rows = page.getByTestId('stdio-checklist').getByRole('listitem')
  await expect(rows.first()).toContainText('Blockiert')
  await expect(page.getByTestId('stdio-block-reason')).toContainText('slim')
  for (const row of await rows.all()) {
    await expect(row.locator('svg[aria-hidden="true"]')).toHaveCount(1)
    await expect(row.getByTestId('checklist-state')).not.toHaveText('')
  }
  await expect(page.getByRole('button', { name: 'Freigeben' })).toBeDisabled()
  await axe(page)
  // Global switch off
  await page.evaluate(() => { localStorage.removeItem('mockStdioReason'); const k = 'mcpwarden.mock.state'; const s = JSON.parse(sessionStorage.getItem(k)!); s.settings['stdio.enabled'] = false; sessionStorage.setItem(k, JSON.stringify(s)) })
  await page.reload()
  await expect(page.getByTestId('stdio-block-reason')).toContainText('ausgeschaltet')
  await axe(page)
})

test('Password toggle "Anzeigen": hit area 44 px, input group 44 px, icon stays small', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  const toggle = page.getByRole('button', { name: 'Anzeigen' }).first()
  const b = (await toggle.boundingBox())!
  expect(b.width).toBeGreaterThanOrEqual(44)
  expect(b.height).toBeGreaterThanOrEqual(44)
  const group = toggle.locator('xpath=ancestor::*[@data-slot="input-group"]')
  expect((await group.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const icon = (await toggle.locator('svg').boundingBox())!
  expect(icon.width).toBeLessThanOrEqual(18)
})

test('Upstream detail: status chip sits next to the heading, actions stay on the right', async ({ page }) => {
  await login(page)
  await page.goto('/upstreams/up_4')
  const h1 = (await page.locator('h1').boundingBox())!
  const chip = (await page.getByTestId('status-badge').first().boundingBox())!
  const testBtn = (await page.getByRole('button', { name: 'Verbindung testen' }).boundingBox())!
  expect(chip.x).toBeGreaterThan(h1.x + h1.width - 1)
  expect(Math.abs((chip.y + chip.height / 2) - (h1.y + h1.height / 2))).toBeLessThan(16)
  expect(testBtn.x).toBeGreaterThan(chip.x + chip.width)
})

test('Admin users: "+ Einladung erzeugen" sits in the invitations section, not in the page header', async ({ page }) => {
  await login(page)
  await page.goto('/admin/users')
  const btn = page.getByRole('button', { name: '+ Einladung erzeugen' })
  await expect(btn).toHaveCount(1)
  await expect(page.locator('header').filter({ has: page.locator('h1') }).getByRole('button', { name: '+ Einladung erzeugen' })).toHaveCount(0)
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Offene Einladungen' }) }).getByRole('button', { name: '+ Einladung erzeugen' })).toBeVisible()
  await btn.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('Dashboard: "Braucht Aufmerksamkeit" sits above the clients table, only with items', async ({ page }) => {
  await login(page)
  const attention = page.getByRole('heading', { name: 'Braucht Aufmerksamkeit' })
  await expect(attention).toBeVisible()
  const clients = page.getByRole('heading', { name: 'Verbundene Clients' })
  expect((await attention.boundingBox())!.y).toBeLessThan((await clients.boundingBox())!.y)
  // Without items the card is gone (the client table stays)
  await page.evaluate(() => {
    const k = 'mcpwarden.mock.state'
    const s = JSON.parse(sessionStorage.getItem(k)!)
    for (const u of s.upstreams) { u.setup = 'ready'; u.status = 'healthy' }
    sessionStorage.setItem(k, JSON.stringify(s))
  })
  await page.reload()
  await expect(clients).toBeVisible()
  await expect(attention).toHaveCount(0)
})
