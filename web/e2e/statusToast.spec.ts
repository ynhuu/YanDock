import { expect, test } from '@playwright/test'
import { clearSessions, openTerminal } from './helpers'

test.afterEach(async ({ page }) => {
  await clearSessions(page)
})

test('进程结束使用黄色警告提示，明暗主题保持一致', async ({ page }) => {
  await openTerminal(page)
  await page.locator('.xterm-helper-textarea:visible').focus()
  await page.keyboard.insertText('exit')
  await page.keyboard.press('Enter')
  const toast = page.locator('.status-toast').filter({ hasText: '进程已结束' })
  await expect(toast).toHaveClass('status-toast status-toast-warning')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value
    }, theme)
    expect(
      await toast.evaluate((element) => {
        const style = getComputedStyle(element)
        const probe = document.createElement('span')
        probe.style.color = 'var(--warning)'
        element.append(probe)
        const warning = getComputedStyle(probe).color
        probe.remove()
        return style.borderLeftColor === warning
      }),
    ).toBe(true)
  }
})

for (const uploaded of [0, 1, 2]) {
  test(`上传 ${uploaded}/2 个文件时使用对应的提醒色`, async ({ page }) => {
    await openTerminal(page)
    await page.route('**/api/project/files?*', (route) =>
      route.fulfill({ json: { files: [], truncated: false } }),
    )
    await page.route('**/api/project/changes?*', (route) =>
      route.fulfill({
        json: { files: [], truncated: false, additions: 0, deletions: 0 },
      }),
    )
    let requests = 0
    await page.route('**/api/project/upload?*', (route) => {
      requests++
      return requests <= uploaded
        ? route.fulfill({ status: 204 })
        : route.fulfill({ status: 409, body: '测试上传失败' })
    })
    await page.getByRole('button', { name: '打开项目面板' }).click()
    await page.getByRole('tab', { name: '文件', exact: true }).click()
    const picker = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '上传文件', exact: true }).click()
    await (
      await picker
    ).setFiles([
      { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('one') },
      { name: 'two.txt', mimeType: 'text/plain', buffer: Buffer.from('two') },
    ])
    const variant =
      uploaded === 0 ? 'error' : uploaded === 1 ? 'warning' : 'success'
    const toast = page.locator(`.global-toast-anchor .status-toast-${variant}`)
    await expect(toast).toHaveText(
      uploaded === 0
        ? '测试上传失败'
        : uploaded === 1
          ? '已上传 1 个文件；测试上传失败'
          : '已上传 2 个文件',
    )
    await expect(toast).toHaveAttribute(
      'role',
      uploaded === 0 ? 'alert' : 'status',
    )
  })
}

test('首次连接为蓝色，断线自动重连为黄色', async ({ page }) => {
  let releaseHello: (() => void) | undefined
  let disconnect: (() => void) | undefined
  await page.routeWebSocket('**/api/session/*/terminal', (route) => {
    const server = route.connectToServer()
    let released = false
    const held: (string | Buffer)[] = []
    server.onMessage((message) => {
      if (typeof message === 'string' && message.includes('"type":"hello"'))
        releaseHello = () => {
          released = true
          route.send(message)
          for (const frame of held) route.send(frame)
          held.length = 0
        }
      else if (released) route.send(message)
      else held.push(message)
    })
    disconnect = () => {
      route.close()
      server.close()
    }
  })
  const { login } = await import('./helpers')
  await login(page)
  await clearSessions(page)
  await page.getByRole('button', { name: '新建终端' }).click()
  await expect(page.locator('.status-toast-info')).toHaveText('正在连接终端…')
  await expect.poll(() => !!releaseHello).toBe(true)
  releaseHello!()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await page.clock.install()
  disconnect!()
  await expect(page.locator('.status-toast-warning')).toHaveText(
    '正在重新连接终端…',
  )
  await expect(page.locator('.status-toast-info')).toHaveCount(0)
})
