import { expect, test } from '@playwright/test'
import { axe, prep } from './helpers'

test('Login shows „Passwort vergessen?“ only when mail is active', async ({ page }) => {
  await prep(page, { mail: 'on' })
  await page.goto('/login')
  await expect(page.getByRole('link', { name: 'Passwort vergessen?' })).toBeVisible()
  await axe(page)
})

test('without mail: /forgot-password explains it without a form, and login shows no link', async ({ page }) => {
  await prep(page, { mail: 'off' })
  await page.goto('/forgot-password')
  await expect(page.getByText('nicht eingerichtet')).toBeVisible() // configuration is loaded
  await expect(page.getByRole('button', { name: 'Link senden' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Zurück zur Anmeldung' }).click() // client navigation: same loaded configuration
  await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Passwort vergessen?' })).toHaveCount(0)
})

test('Request link: invalid address is flagged, a valid one always shows the same neutral response', async ({ page }) => {
  await prep(page)
  await page.goto('/login')
  await page.getByRole('link', { name: 'Passwort vergessen?' }).click()
  await expect(page.getByRole('heading', { name: 'Passwort vergessen', level: 1 })).toBeVisible()
  await axe(page)
  await page.getByLabel('E-Mail').fill('kaputt')
  await page.getByRole('button', { name: 'Link senden' }).click()
  await expect(page.getByText('keine gültige E-Mail-Adresse')).toBeVisible()
  // The error appears already when leaving the field; only the focus shows that the submit itself is done (otherwise it hits the new input).
  await expect(page.getByLabel('E-Mail')).toBeFocused()
  await page.getByLabel('E-Mail').fill('irgendwer@example.test')
  await page.getByRole('button', { name: 'Link senden' }).click()
  await expect(page.getByRole('status')).toContainText('Wenn zu dieser Adresse ein Konto existiert')
  await expect(page.getByRole('status')).not.toContainText('irgendwer')
})

test('New password: minimum length 12, confirmation, token disappears from the address bar, then login', async ({ page }) => {
  await prep(page)
  await page.goto('/reset-password#token=valid123')
  await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen', level: 1 })).toBeVisible()
  await expect.poll(() => page.url()).not.toContain('valid123')
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer')
  await axe(page)
  await page.getByLabel('Neues Passwort').fill('tooshort')
  await page.getByLabel('Passwort bestätigen').fill('tooshort')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  // The description on the field carries the same text: wait for the error (role=alert) and the submit focus, otherwise the test runs ahead of the submit.
  await expect(page.getByRole('alert').filter({ hasText: 'Mindestens 12 Zeichen.' })).toBeVisible()
  await expect(page.getByLabel('Neues Passwort')).toBeFocused()
  await page.getByLabel('Neues Passwort').fill('longenoughpassword')
  await page.getByLabel('Passwort bestätigen').fill('otherpassword1')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(page.getByText('stimmen nicht überein')).toBeVisible()
  await expect(page.getByLabel('Passwort bestätigen')).toBeFocused()
  await page.getByLabel('Passwort bestätigen').fill('longenoughpassword')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(page).toHaveURL(/\/login\?reset=1/)
  await expect(page.getByRole('status')).toContainText('Passwort wurde geändert')
})

test('expired or missing token: link unusable, new link can be requested', async ({ page }) => {
  await prep(page)
  await page.goto('/reset-password')
  await expect(page.getByRole('heading', { name: 'Link nicht nutzbar' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Neuen Link anfordern' })).toBeVisible()
  await page.goto('/reset-password#token=expired')
  await page.getByLabel('Neues Passwort').fill('longenoughpassword')
  await page.getByLabel('Passwort bestätigen').fill('longenoughpassword')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Link nicht nutzbar' })).toBeVisible()
  await axe(page)
})
