import { expect, test } from '@playwright/test'
import { clearSessions, openTerminal, recordSockets, TOKEN } from './helpers'

test.afterEach(async ({ page }) => {
  await clearSessions(page)
})

test('字号在浏览器保存，调整所有终端而不重连', async ({ page }) => {
  const sockets = recordSockets(page)
  const resizes: { cols: number; rows: number }[] = []
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return
      const message = JSON.parse(payload) as {
        type: string
        cols: number
        rows: number
      }
      if (message.type === 'resize')
        resizes.push({ cols: message.cols, rows: message.rows })
    }),
  )
  await openTerminal(page)
  await page.getByRole('button', { name: '新建终端' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect.poll(() => resizes.length).toBeGreaterThan(0)
  const originalSize = resizes.at(-1)!
  const terminals = await page.locator('.xterm').elementHandles()

  await page.getByRole('button', { name: '更多操作' }).click()
  const fontSetting = page.getByRole('group', { name: '终端字体大小' })
  const decrease = page.getByRole('menuitem', { name: '减小字体' })
  const increase = page.getByRole('menuitem', { name: '增大字体' })
  await expect(fontSetting).toContainText('字体大小：14px')
  for (let size = 12; size >= 8; size -= 2) {
    await decrease.click()
    await expect(fontSetting).toContainText(`字体大小：${size}px`)
  }
  await expect(decrease).toBeDisabled()
  await expect
    .poll(() => resizes.at(-1)!.rows)
    .toBeGreaterThan(originalSize.rows)
  for (let size = 10; size <= 16; size += 2) {
    await increase.click()
    await expect(fontSetting).toContainText(`字体大小：${size}px`)
  }
  await expect(increase).toBeDisabled()
  await expect.poll(() => resizes.at(-1)!.rows).toBeLessThan(originalSize.rows)
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('yandock-terminal-font-size')),
    )
    .toBe('16')
  await page.keyboard.press('Escape')
  await page.getByRole('tab').first().click()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect.poll(() => resizes.at(-1)!.rows).toBeLessThan(originalSize.rows)
  expect(sockets).toHaveLength(2)
  for (const terminal of terminals)
    expect(await terminal.evaluate((node) => node.isConnected)).toBe(true)

  await page.reload()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await page.getByRole('button', { name: '更多操作' }).click()
  await expect(page.getByRole('group', { name: '终端字体大小' })).toContainText(
    '字体大小：16px',
  )
})

test('主题忽略旧偏好，跟随系统并更新终端而不重连', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => localStorage.setItem('yandock-theme', 'dark'))
  await page.goto('/')
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(root).toHaveAttribute('data-theme', 'dark')

  await page.getByLabel('访问凭据').fill(TOKEN)
  await page.getByRole('button', { name: '登录工作台' }).click()
  await expect(page.getByRole('button', { name: '新建终端' })).toBeVisible()

  const sockets = recordSockets(page)
  await page.getByRole('button', { name: '新建终端' }).click()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect.poll(() => sockets.length).toBe(1)

  const terminal = await page.locator('.xterm:visible').elementHandle()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(root).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('.terminal-host:visible')).toHaveCSS(
    'background-color',
    'rgb(251, 253, 255)',
  )
  await expect(page.locator('.xterm-screen:visible')).toBeVisible()
  expect(sockets).toHaveLength(1)
  expect(await terminal?.evaluate((node) => node.isConnected)).toBe(true)

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.terminal-host:visible')).toHaveCSS(
    'background-color',
    'rgb(11, 15, 20)',
  )
  expect(sockets).toHaveLength(1)

  await page.getByRole('button', { name: '更多操作' }).click()
  const themeButton = () => page.getByRole('menuitem', { name: /^主题：/ })
  await expect(themeButton()).toHaveAttribute(
    'aria-label',
    '主题：跟随系统，点击轮换',
  )
  await page.emulateMedia({ colorScheme: 'light' })
  await themeButton().click()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await expect(themeButton()).toHaveAttribute(
    'aria-label',
    '主题：深色，点击轮换',
  )
  await themeButton().click()
  await expect(root).toHaveAttribute('data-theme', 'light')
  await expect(themeButton()).toHaveAttribute(
    'aria-label',
    '主题：浅色，点击轮换',
  )
  await themeButton().click()
  await expect(themeButton()).toHaveAttribute(
    'aria-label',
    '主题：跟随系统，点击轮换',
  )
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('yandock-theme-preference')),
    )
    .toBe('system')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(root).toHaveAttribute('data-theme', 'dark')
  expect(sockets).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '更多操作' })).toBeFocused()
})
