import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('登录辅助流程等待初始认证检查完成', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/sessions', async (route) => {
    await gate
    await route.continue()
  })
  const completed = login(page)
  try {
    await expect(page.getByText('正在连接 YanDock…')).toBeVisible()
  } finally {
    release()
  }
  await completed
  await expect(page.getByRole('button', { name: '新建终端' })).toBeVisible()
})

test('手机登录页顶部留出安全区并将表单上移', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const card = await page.locator('.login-card').boundingBox()
  expect(card).not.toBeNull()
  expect(card!.y).toBeGreaterThanOrEqual(12)
  expect(card!.y).toBeLessThanOrEqual(16)
  expect(Math.abs(card!.x + card!.width / 2 - 195)).toBeLessThanOrEqual(1)
  const credential = page.getByLabel('访问凭据')
  await expect(credential).toBeVisible()
  await expect(credential).toHaveCSS('font-size', '14px')
})
