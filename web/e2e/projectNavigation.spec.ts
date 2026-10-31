import { expect, test, type Page } from '@playwright/test'
import { emulateMobileUserAgent, login } from './helpers'

async function openPreview(page: Page, mobile = true) {
  if (mobile) await emulateMobileUserAgent(page, 'Android')
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({
      json: {
        files: [],
        truncated: false,
        additions: 0,
        deletions: 0,
        statsComplete: true,
      },
    }),
  )
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [
          { name: 'example.md', path: 'example.md', isDir: false, size: 16 },
        ],
        truncated: false,
      },
    }),
  )
  await page.route(/\/api\/project\/file\?/, (route) =>
    route.fulfill({ body: '# 文件预览' }),
  )
  await page.evaluate(() => history.replaceState({ fixture: 'base' }, ''))
  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await drawer.getByRole('tab', { name: '文件', exact: true }).click()
  await drawer
    .locator('.project-entry')
    .filter({ hasText: 'example.md' })
    .click()
  await expect(drawer.locator('.project-markdown-preview h1')).toHaveText(
    '文件预览',
  )
  return drawer
}

test('系统返回先退出文件预览，再关闭抽屉，保留页面和原历史状态', async ({
  page,
}) => {
  const drawer = await openPreview(page)
  const url = page.url()
  const length = await page.evaluate(() => history.length)
  await page.goBack()
  await expect(drawer.locator('.project-preview-heading')).toHaveCount(0)
  await expect(drawer.locator('.project-entry')).toContainText('example.md')
  await expect(drawer).toBeVisible()
  expect(page.url()).toBe(url)
  expect(await page.evaluate(() => history.length)).toBe(length)
  await page.goBack()
  await expect(drawer).toHaveCount(0)
  expect(page.url()).toBe(url)
  expect(await page.evaluate(() => history.state)).toEqual({ fixture: 'base' })
})

test('页面内返回文件列表后，系统返回直接关闭抽屉', async ({ page }) => {
  const drawer = await openPreview(page)
  const url = page.url()
  await drawer.getByRole('button', { name: '文件列表', exact: true }).click()
  await expect(drawer.locator('.project-preview-heading')).toHaveCount(0)
  await page.goBack()
  await expect(drawer).toHaveCount(0)
  expect(page.url()).toBe(url)
})

test('从预览直接关闭再打开抽屉，不残留返回拦截或重复历史', async ({ page }) => {
  const drawer = await openPreview(page)
  const url = page.url()
  const length = await page.evaluate(() => history.length)
  await drawer.getByRole('button', { name: '关闭项目面板' }).click()
  await expect(drawer).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => history.state))
    .toEqual({ fixture: 'base' })
  for (let count = 0; count < 2; count++) {
    await page.getByRole('button', { name: '打开项目面板' }).click()
    await expect(drawer).toBeVisible()
    expect(await page.evaluate(() => history.length)).toBe(length)
    await page.goBack()
    await expect(drawer).toHaveCount(0)
    expect(page.url()).toBe(url)
  }
})

test('预览仍在加载时，系统返回取消读取并保留文件列表', async ({ page }) => {
  const drawer = await openPreview(page)
  await drawer.getByRole('button', { name: '文件列表', exact: true }).click()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route(/\/api\/project\/file\?/, async (route) => {
    started()
    await gate
    await route.fulfill({ body: '# 过期预览' })
  })
  const aborted = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/api/project/file?'),
  )
  try {
    await drawer
      .locator('.project-entry')
      .filter({ hasText: 'example.md' })
      .click()
    await ready
    await page.goBack()
    expect((await aborted).failure()?.errorText).toContain('ERR_ABORTED')
    await expect(drawer.locator('.project-preview-heading')).toHaveCount(0)
    await expect(drawer.locator('.project-entry')).toContainText('example.md')
    await expect(drawer.getByRole('alert')).toHaveCount(0)
    await page.goBack()
    await expect(drawer).toHaveCount(0)
  } finally {
    release()
  }
})

test('移动设备抽屉始终全屏，文件菜单保持在面板内', async ({ page }) => {
  const drawer = await openPreview(page)
  await expect(drawer).toHaveCSS('width', '390px')
  await drawer.getByRole('button', { name: '文件列表', exact: true }).click()
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(drawer).toHaveCSS('width', '1200px')
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0)
  await drawer.locator('.project-entry').click({ button: 'right' })
  const menu = drawer.getByRole('menu')
  await expect(menu).toBeVisible()
  const bounds = (await menu.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1200)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await drawer.getByRole('tab', { name: 'Git', exact: true }).focus()
  await page.keyboard.press('End')
  await expect(
    drawer.getByRole('tab', { name: '文件', exact: true }),
  ).toBeFocused()
})

test('非移动设备抽屉始终半屏，窄视口下外侧遮罩仍可关闭', async ({ page }) => {
  const drawer = await openPreview(page, false)
  await expect(drawer).toHaveCSS('width', '195px')
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(drawer).toHaveCSS('width', '600px')
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(600)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(drawer).toHaveCSS('width', '195px')
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(195)
  await page
    .locator('.project-drawer-layer')
    .click({ position: { x: 10, y: 100 } })
  await expect(drawer).toHaveCount(0)
})
