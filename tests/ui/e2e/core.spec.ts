import { expect, test } from '@playwright/test'
import { axe, holdConfirm, login, prep } from './helpers'

test('Login, navigation, collapsing persists after reload, Ctrl+B', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
  await page.getByTestId('collapse').click()
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute('data-state', 'collapsed')
  await page.reload()
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute('data-state', 'collapsed')
  await page.keyboard.press('Control+b')
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute('data-state', 'expanded')
  const panel = page.locator('[data-sidebar="sidebar"]').first().locator('xpath=..')
  await expect.poll(() => panel.evaluate(e => e.getBoundingClientRect().width)).toBe(248)
})

test('wrong password shows an error, registration without an invitation is blocked', async ({ page }) => {
  await prep(page)
  await page.goto('/login')
  await page.getByLabel('E-Mail').fill('a@b.de')
  await page.getByLabel('Passwort').fill('wrong')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'stimmt nicht' })).toBeVisible()
  await page.goto('/register')
  await page.getByLabel('Name').fill('Neu')
  await page.getByLabel('E-Mail').fill('new@example.test')
  await page.getByLabel('Passwort', { exact: true }).fill('longenoughpassword')
  await page.getByLabel('Passwort bestätigen').fill('longenoughpassword')
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByText('nur mit Einladung')).toBeVisible()
})

test('Login redirects to the registration only with public-config.registrationOpen', async ({ page }) => {
  await prep(page)
  await page.goto('/login')
  await expect(page.getByText('nur mit Einladung')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Registrieren' })).toHaveCount(0)
  await page.evaluate(() => localStorage.setItem('mockRegistration', 'open'))
  await page.reload()
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByRole('heading', { name: 'Registrieren', level: 1 })).toBeVisible()
})

test('Invitation: valid, bound, expired, used', async ({ page }) => {
  await prep(page)
  await page.goto('/invite/expired-token')
  await expect(page.getByText('abgelaufen')).toBeVisible()
  await page.goto('/invite/used-token')
  await expect(page.getByText('bereits verwendet')).toBeVisible()
  await page.goto('/invite/bound-token')
  await expect(page.getByLabel('E-Mail')).toHaveValue('new@example.test')
  await expect(page.getByLabel('E-Mail')).toHaveJSProperty('readOnly', true)
  await page.goto('/invite/valid-token')
  await page.getByLabel('Name').fill('Neu')
  await page.getByLabel('E-Mail').fill('n@example.test')
  await page.getByLabel('Passwort', { exact: true }).fill('longenoughpassword')
  await page.getByLabel('Passwort bestätigen').fill('longenoughpassword')
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  expect(await page.locator('meta[name="referrer"]').count()).toBe(0) // meta only on the link page
})

test('Consent: unknown client needs a checkbox, known one does not, invalid signature', async ({ page }) => {
  await login(page)
  await page.goto('/consent?client_id=agent-x&sig=ok')
  const allow = page.getByRole('button', { name: 'Zugriff erlauben' })
  await expect(page.getByText('Unbekannter Client')).toBeVisible()
  await expect(allow).toBeDisabled()
  await page.getByRole('checkbox').click()
  await expect(allow).toBeEnabled()
  await expect(page.getByText('mcp:tools')).toBeVisible()
  await expect(page.getByText('mcpwarden:admin')).toHaveCount(0)
  // Even if the server already offers the admin scope (phase 2): no switch until then.
  await page.goto('/consent?client_id=agent-admin&sig=ok')
  await expect(page.getByRole('heading', { name: 'Dieser Client darf' })).toBeVisible()
  await expect(page.getByText('mcpwarden:admin')).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(0)
  await page.goto('/consent?client_id=claude-code&sig=ok')
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Zugriff erlauben' })).toBeEnabled()
  await expect(page.getByText('localhost').first()).toBeVisible()
  await page.goto('/consent?client_id=bad-sig&sig=bad')
  await expect(page.getByText('nicht gültig oder abgelaufen')).toBeVisible()
})

test('Create upstream in under 2 minutes, test, tool switch, slug collision, delete', async ({ page }) => {
  await login(page)
  const t0 = Date.now()
  await page.goto('/upstreams/new')
  await page.getByLabel('Anzeigename').fill('Demo')
  await page.getByLabel('Kurzname').fill('demo')
  await page.getByLabel('Server-URL').fill('https://mcp.demo.example/mcp')
  await page.getByRole('button', { name: 'Anlegen und verbinden' }).click()
  await expect(page.getByTestId('test-ok')).toBeVisible()
  expect(Date.now() - t0).toBeLessThan(120_000)
  await page.getByRole('link', { name: 'Zum Upstream' }).click()
  await page.getByRole('tab', { name: 'Tools' }).click()
  const sw = page.getByRole('checkbox', { name: /^Tool .* aktiv$/ }).first()
  await expect(sw).toBeChecked()
  await sw.click()
  await expect(sw).not.toBeChecked()
  await page.goto('/upstreams/new')
  await page.getByLabel('Anzeigename').fill('Dup')
  await page.getByLabel('Kurzname').fill('github')
  await page.getByLabel('Server-URL').fill('https://mcp.dup.example/mcp')
  await page.getByRole('button', { name: 'Anlegen und verbinden' }).click()
  await expect(page.getByText('schon vergeben')).toBeVisible()
  await page.goto('/upstreams')
  await expect(page.getByRole('row', { name: /Demo/ })).toBeVisible()
  await page.getByRole('link', { name: 'Demo mcp.demo.example/mcp' }).click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await holdConfirm(page, page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }))
  await expect(page).toHaveURL(/\/upstreams$/)
})

test('Upstream list: filter without hits, foreign ID 404, stdio blocked for users', async ({ page }) => {
  await login(page, { role: 'user' })
  await page.goto('/upstreams')
  await page.getByLabel('Upstreams suchen').fill('zzzz')
  await expect(page.getByText('Keine Treffer')).toBeVisible()
  await page.goto('/upstreams/foreign')
  await expect(page.getByText('Nicht gefunden')).toBeVisible()
  await page.goto('/upstreams/new')
  await expect(page.getByTestId('stdio-reason')).toContainText('nicht freigegeben')
})

test('Tokens: plaintext once, nowhere afterwards (canary)', async ({ page }) => {
  await login(page)
  await page.goto('/settings/tokens')
  await page.getByRole('button', { name: '+ Token erzeugen' }).click()
  await page.getByLabel('Name', { exact: true }).fill('canary')
  await page.getByRole('button', { name: 'Erzeugen' }).click()
  const token = await page.getByTestId('one-time-value').innerText()
  expect(token).toMatch(/^mcpw_pat_/)
  await page.getByRole('button', { name: 'Schließen' }).click()
  await expect(page.getByTestId('one-time-secret')).toHaveCount(0)
  for (const p of ['/settings/tokens', '/', '/settings', '/audit']) {
    await page.goto(p)
    expect(await page.content()).not.toContain(token)
  }
  await page.waitForLoadState('networkidle')
  const stores = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage, document.cookie]))
  expect(stores).not.toContain(token)
  await page.goto('/settings/tokens')
  await page.getByRole('button', { name: 'Token canary widerrufen' }).click()
  await holdConfirm(page, page.getByRole('alertdialog').getByRole('button', { name: 'Widerrufen' }))
  await expect(page.getByText('Token widerrufen.')).toBeVisible()
})

test('Secret canary: entered, saved, never visible again', async ({ page }) => {
  const canary = 'CANARY-7f3a9c-secret'
  const logs: string[] = []
  page.on('console', m => logs.push(m.text()))
  const bodies: string[] = []
  page.on('response', async (r) => { if (r.url().includes('/api/')) bodies.push(await r.text().catch(() => '')) })
  await login(page)
  await page.goto('/upstreams/new')
  await page.getByLabel('Anzeigename').fill('Geheim')
  await page.getByLabel('Kurzname').fill('geheim')
  await page.getByLabel('Server-URL').fill('https://mcp.geheim.example/mcp')
  await page.getByText('Bearer', { exact: true }).click()
  await page.getByLabel('Secret', { exact: true }).fill(canary)
  await page.getByRole('button', { name: 'Anlegen und verbinden' }).click()
  await expect(page.getByRole('link', { name: 'Zum Upstream' })).toBeVisible()
  for (const p of ['/', '/upstreams', '/settings', '/settings/tokens', '/settings/connections', '/audit', '/admin/users', '/admin/oauth', '/admin/settings']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    expect(await page.content()).not.toContain(canary)
  }
  await page.getByRole('link', { name: 'Upstreams' }).first().click()
  await page.getByRole('link', { name: /^Geheim/ }).click()
  await page.getByRole('tab', { name: 'Auth' }).click()
  await expect(page.getByText('Gesetzt').first()).toBeVisible()
  expect(await page.getByLabel('Neues Secret').inputValue()).toBe('')
  const stores = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage, document.cookie]))
  expect(stores).not.toContain(canary)
  expect(bodies.join('')).not.toContain(canary) // responses never contain the secret
  expect(logs.join('\n')).not.toContain(canary)
})

test('User: admin area redirects, nav without admin', async ({ page }) => {
  await login(page, { role: 'user' })
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0)
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await expect(page.getByText('nur für Admins')).toBeVisible()
})

test('Admin: create invitation (one-time link), ban user, allowlist entry, instance', async ({ page }) => {
  await login(page)
  await page.goto('/admin/users')
  await expect(page.getByTestId('admin-hint')).toBeVisible()
  await page.getByRole('button', { name: '+ Einladung erzeugen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Erzeugen' }).click()
  await expect(page.getByTestId('one-time-value')).toContainText('/invite/')
  await page.getByRole('button', { name: 'Mara sperren' }).click()
  await holdConfirm(page, page.getByRole('alertdialog').getByRole('button', { name: 'Sperren' }))
  await expect(page.getByText('Gesperrt', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Christian sperren' })).toBeDisabled()
  await page.goto('/admin/oauth')
  await page.getByRole('button', { name: '+ Eintrag' }).click()
  await page.getByLabel('Bezeichnung').fill('Mein Tool')
  await page.getByLabel('Name-Muster').fill('Mein*')
  await page.getByLabel('Redirect-Muster').fill('myapp://*')
  await page.getByRole('button', { name: 'Hinzufügen' }).click()
  await expect(page.getByText('Mein Tool')).toBeVisible()
  await page.goto('/admin/settings')
  await page.getByLabel('Neue Ausnahme').fill('169.254.169.254/32')
  await page.getByRole('button', { name: '+ Eintrag' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Metadaten' })).toBeVisible()
})

test('Dashboard: waiting upstreams appear in the attention list with a matching action', async ({ page }) => {
  await login(page)
  await page.evaluate(() => {
    const k = 'mcpwarden.mock.state'
    const s = JSON.parse(sessionStorage.getItem(k)!)
    s.upstreams[0].setup = 'awaiting_auth'; s.upstreams[0].status = 'unknown'; s.upstreams[0].name = 'Waiting-Auth'
    s.upstreams[1].setup = 'awaiting_approval'; s.upstreams[1].status = 'unknown'; s.upstreams[1].name = 'Waiting-Approval'
    sessionStorage.setItem(k, JSON.stringify(s))
  })
  await page.reload()
  const auth = page.getByRole('listitem').filter({ hasText: 'Waiting-Auth' })
  await expect(auth.getByTestId('status-badge')).toHaveText('Wartet auf Anmeldedaten')
  await expect(auth.getByRole('link', { name: 'Zugangsdaten eintragen' })).toHaveAttribute('href', /tab=auth/)
  const appr = page.getByRole('listitem').filter({ hasText: 'Waiting-Approval' })
  await expect(appr.getByTestId('status-badge')).toHaveText('Wartet auf Freigabe')
  await expect(appr.getByRole('link', { name: 'Entwurf prüfen' })).toHaveAttribute('href', /\/approve$/)
  await expect(page.getByTestId('nothing-to-do')).toHaveCount(0)
})

test('Dashboard empty, error, 403 and nothing-to-do', async ({ page }) => {
  await login(page, { scenario: 'empty' })
  await expect(page.getByTestId('mcp-url')).toBeVisible()
  await expect(page.getByTestId('nothing-to-do')).toBeVisible()
  await page.evaluate(() => localStorage.setItem('mockScenario', 'error'))
  await page.reload()
  await expect(page.getByTestId('error-state').first()).toBeVisible()
  await page.evaluate(() => localStorage.setItem('mockScenario', 'forbidden'))
  await page.goto('/audit')
  await expect(page.getByText('Kein Zugriff')).toBeVisible()
})

test('Dropped features are reachable nowhere (F12)', async ({ page }) => {
  await login(page)
  // Mockup update: "Alle testen" (upstream toolbar), "Konto löschen" and the theme choice (Darstellung) are part of the mockup now.
  const banned = [/E-Mail ändern/]
  for (const p of ['/', '/upstreams', '/settings', '/settings/connections', '/admin/settings', '/upstreams/up_1']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    const text = await page.locator('body').innerText()
    for (const b of banned) expect(text, `${p} ${b}`).not.toMatch(b)
    // Status mails (P1 mailer) are provided only on /settings and only with an active mailer (there: own test)
    if (p !== '/settings') expect(text, `${p} Benachrichtigung`).not.toMatch(/Benachrichtigung/)
  }
  await page.goto('/settings')
  await expect(page.getByRole('radio')).toHaveCount(3) // theme choice from the mockup (Hell/Dunkel are disabled until supported)
})

test('Admin: send invitation by email only with an active mailer and an entered address', async ({ page }) => {
  await login(page)
  await page.goto('/admin/users')
  await page.getByRole('button', { name: '+ Einladung erzeugen' }).click()
  const box = page.getByRole('dialog').getByRole('checkbox', { name: /Per E-Mail senden/ })
  await expect(box).toBeVisible()
  await expect(box).toBeDisabled() // not selectable without an address
  await page.getByRole('dialog').getByLabel('E-Mail (optional)').fill('new@example.test')
  await expect(box).toBeEnabled()
  await box.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Erzeugen' }).click()
  await expect(page.getByTestId('one-time-value')).toContainText('/invite/') // link stays visible once
  await expect(page.getByText('Einladung per E-Mail versendet')).toBeVisible()
})

test('Admin: without a mailer the option „Per E-Mail senden“ does not exist', async ({ page }) => {
  await prep(page, { mail: 'off' })
  await page.goto('/login')
  await page.getByLabel('E-Mail').fill('admin@example.test')
  await page.getByLabel('Passwort').fill('anypassword')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await page.goto('/admin/users')
  await page.getByRole('button', { name: '+ Einladung erzeugen' }).click()
  await expect(page.getByRole('dialog').getByLabel('E-Mail (optional)')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Per E-Mail senden/ })).toHaveCount(0)
})

test('Settings: status mail switch only with a mailer, default on, toggling persists after reload', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  const sw = page.getByRole('switch', { name: 'E-Mail bei Statuswechsel meiner Upstreams' })
  await expect(sw).toBeChecked()
  await axe(page)
  await sw.click()
  await expect(page.getByText('Benachrichtigungen ausgeschaltet.')).toBeVisible()
  await expect(sw).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'E-Mail bei Statuswechsel meiner Upstreams' })).not.toBeChecked()
})

test('Settings: without a mailer the notifications section is missing', async ({ page }) => {
  await prep(page, { mail: 'off' })
  await page.goto('/login')
  await page.getByLabel('E-Mail').fill('admin@example.test')
  await page.getByLabel('Passwort').fill('anypassword')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Darstellung' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Benachrichtigungen' })).toHaveCount(0)
})

test('Appearance: default "collapsed" applies, own toggling takes precedence', async ({ page }) => {
  await login(page)
  await page.goto('/settings')
  await page.getByLabel('Seitenleiste standardmäßig eingeklappt').click()
  await page.context().clearCookies({ name: 'sidebar_state' })
  await page.goto('/')
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute('data-state', 'collapsed')
  await page.getByTestId('collapse').click()
  await page.reload()
  await expect(page.locator('[data-slot="sidebar"]').first()).toHaveAttribute('data-state', 'expanded')
})

test('375 px: sidebar as off-canvas, page usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await login(page)
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollW).toBeLessThanOrEqual(376)
  await page.getByRole('button', { name: 'Navigation öffnen' }).click()
  await page.getByRole('link', { name: 'Upstreams' }).click()
  await expect(page.getByRole('heading', { name: 'Upstreams', level: 1 })).toBeVisible()
})

test('Auto-refresh selection and formatting', async ({ page }) => {
  await login(page)
  await page.goto('/stats')
  await expect(page.getByText('9 874').first()).toBeVisible()
  await page.getByRole('button', { name: '1 h' }).click()
  await expect(page.getByText('987').first()).toBeVisible()
})

test.describe('axe per page', () => {
  const pages = ['/', '/upstreams', '/upstreams/new', '/upstreams/up_1', '/upstreams/up_1/edit', '/upstreams/up_1?tab=tools', '/upstreams/up_1?tab=auth', '/stats', '/audit', '/settings', '/settings/tokens', '/settings/connections', '/admin/users', '/admin/oauth', '/admin/settings', '/upstreams/up_1/approve', '/__styleguide']
  for (const p of pages) {
    test(p, async ({ page }) => {
      await login(page)
      await page.goto(p)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('h1')).toHaveCount(1)
      await axe(page)
    })
  }
  for (const p of ['/login', '/register', '/invite/valid-token', '/invite/expired-token', '/consent?client_id=agent-x&sig=ok', '/link/abc', '/link/done?status=connected']) {
    test(p, async ({ page }) => {
      await prep(page)
      if (p.startsWith('/consent') || p.startsWith('/link')) { await login(page) }
      await page.goto(p)
      await page.waitForLoadState('networkidle')
      await axe(page)
    })
  }
})
