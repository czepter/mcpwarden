import { expect, test } from '@playwright/test'
import { login } from './helpers'

test.use({ viewport: { width: 1440, height: 900 } })

test('Tool mode: Meta-Tools can be selected, persists across reload and shows in the dashboard', async ({ page }) => {
  await login(page)
  await page.goto('/settings/connections')
  const direct = page.getByTestId('mode-direct')
  const meta = page.getByTestId('mode-meta')
  await expect(direct).toBeEnabled()
  await expect(meta).toBeEnabled()
  await expect(direct).toBeChecked()
  await meta.check()
  await expect(page.getByText('Tool-Modus: Meta-Tools.')).toBeVisible()
  await expect(meta).toBeChecked()
  await page.reload()
  await expect(page.getByTestId('mode-meta')).toBeChecked()
  await page.goto('/')
  await expect(page.getByText('310 Tokens, Meta-Modus').first()).toBeVisible()
  await page.goto('/settings/connections')
  await page.getByTestId('mode-direct').check()
  await expect(page.getByText('Tool-Modus: Direkt.')).toBeVisible()
})
