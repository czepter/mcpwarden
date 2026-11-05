import { expect, test } from '@playwright/test'
import { axe, prep } from './helpers'

test('Login zeigt „Passwort vergessen?“ nur, wenn Mail aktiv ist', async ({ page }) => {
  await prep(page, { mail: 'on' })
  await page.goto('/login')
  await expect(page.getByRole('link', { name: 'Passwort vergessen?' })).toBeVisible()
  await axe(page)
})

test('ohne Mail: /forgot-password erklaert es ohne Formular, und Login zeigt keinen Link', async ({ page }) => {
  await prep(page, { mail: 'off' })
  await page.goto('/forgot-password')
  await expect(page.getByText('nicht eingerichtet')).toBeVisible() // Konfiguration ist geladen
  await expect(page.getByRole('button', { name: 'Link senden' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Zurück zur Anmeldung' }).click() // Client-Navigation: gleiche geladene Konfiguration
  await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Passwort vergessen?' })).toHaveCount(0)
})

test('Link anfordern: ungueltige Adresse wird markiert, gueltige zeigt immer dieselbe neutrale Antwort', async ({ page }) => {
  await prep(page)
  await page.goto('/login')
  await page.getByRole('link', { name: 'Passwort vergessen?' }).click()
  await expect(page.getByRole('heading', { name: 'Passwort vergessen', level: 1 })).toBeVisible()
  await axe(page)
  await page.getByLabel('E-Mail').fill('kaputt')
  await page.getByRole('button', { name: 'Link senden' }).click()
  await expect(page.getByText('keine gültige E-Mail-Adresse')).toBeVisible()
  await page.getByLabel('E-Mail').fill('irgendwer@example.test')
  await page.getByRole('button', { name: 'Link senden' }).click()
  await expect(page.getByRole('status')).toContainText('Wenn zu dieser Adresse ein Konto existiert')
  await expect(page.getByRole('status')).not.toContainText('irgendwer')
})

test('Neues Passwort: Mindestlaenge 12, Bestaetigung, Token verschwindet aus der Adresszeile, danach Anmeldung', async ({ page }) => {
  await prep(page)
  await page.goto('/reset-password#token=gueltig123')
  await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen', level: 1 })).toBeVisible()
  await expect.poll(() => page.url()).not.toContain('gueltig123')
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer')
  await axe(page)
  await page.getByLabel('Neues Passwort').fill('zukurz')
  await page.getByLabel('Passwort bestätigen').fill('zukurz')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(page.getByText('Mindestens 12 Zeichen.').last()).toBeVisible()
  await page.getByLabel('Neues Passwort').fill('langgenugpasswort')
  await page.getByLabel('Passwort bestätigen').fill('anderespasswort1')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(page.getByText('stimmen nicht überein')).toBeVisible()
  await page.getByLabel('Passwort bestätigen').fill('langgenugpasswort')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(page).toHaveURL(/\/login\?reset=1/)
  await expect(page.getByRole('status')).toContainText('Passwort wurde geändert')
})

test('abgelaufener oder fehlender Token: Link nicht nutzbar, neuer Link anforderbar', async ({ page }) => {
  await prep(page)
  await page.goto('/reset-password')
  await expect(page.getByRole('heading', { name: 'Link nicht nutzbar' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Neuen Link anfordern' })).toBeVisible()
  await page.goto('/reset-password#token=abgelaufen')
  await page.getByLabel('Neues Passwort').fill('langgenugpasswort')
  await page.getByLabel('Passwort bestätigen').fill('langgenugpasswort')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Link nicht nutzbar' })).toBeVisible()
  await axe(page)
})
