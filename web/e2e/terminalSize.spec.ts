import { expect, test } from '@playwright/test'
import {
  clearSessions,
  emulateMobileUserAgent,
  login,
  openTerminal,
} from './helpers'

test.afterEach(async ({ page }) => clearSessions(page))

test('测量失败时清理临时节点且不创建 PTY，区域恢复后可以重试', async ({
  page,
}) => {
  await login(page)
  await clearSessions(page)
  let creates = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/session'
    )
      creates++
  })
  const area = page.locator('.workspace > div.relative')
  await area.evaluate((element: HTMLElement) => {
    element.style.width = '0px'
  })
  const create = page.getByRole('button', { name: '新建终端' })
  await create.click()
  await expect(page.getByRole('alert')).toHaveText(
    '终端区域尚未就绪，请稍后重试',
  )
  await expect(page.locator('.terminal-host')).toHaveCount(0)
  expect(creates).toBe(0)
  await area.evaluate((element: HTMLElement) => {
    element.style.width = ''
  })
  await create.click()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect(page.locator('.terminal-host')).toHaveCount(1)
  expect(creates).toBe(1)
})

for (const { fontSize, width, device } of [
  { fontSize: 10, width: 390, device: 'iPhone' },
  { fontSize: 14, width: 390, device: 'iPhone' },
  { fontSize: 16, width: 390, device: 'iPhone' },
  { fontSize: 14, width: 1024, device: 'iPad' },
  { fontSize: 14, width: 1280, device: null },
] as const) {
  test(`${device ?? 'desktop'} 首次创建使用实际 ${fontSize}px 网格`, async ({
    page,
  }) => {
    if (device) await emulateMobileUserAgent(page, device)
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(
      (size) =>
        localStorage.setItem('yandock-terminal-font-size', String(size)),
      fontSize,
    )
    let created: { cols: number; rows: number } | undefined
    let resized: { cols: number; rows: number } | undefined
    await page.route('**/api/session', async (route) => {
      created = route.request().postDataJSON()
      await route.continue()
    })
    await page.routeWebSocket('**/terminal', (route) => {
      route.onMessage((message) => {
        if (typeof message === 'string') {
          const control = JSON.parse(message)
          if (control.type === 'resize' && !resized)
            resized = { cols: control.cols, rows: control.rows }
        }
      })
      route.send(JSON.stringify({ type: 'hello', version: 1, replay: false }))
      // Actual zsh PROMPT_SP output: the marker is erased only if the grid
      // matches the PTY width used to construct its padding.
      route.send(
        Buffer.from(
          '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m' +
            ' '.repeat(created!.cols - 1) +
            '\r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[JPROMPT> \x1b[K',
        ),
      )
    })
    await openTerminal(page)
    expect(created!.cols).not.toBe(80)
    await expect.poll(() => resized).toEqual(created)
    await expect(page.locator('.terminal-host')).toHaveCount(1)
    if (!device) return
    await page.clock.install()
    await page.locator('.terminal-host').evaluate((host) => {
      const event = new Event('touchstart', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', {
        value: [{ clientX: 40, clientY: 100 }],
      })
      host.dispatchEvent(event)
    })
    await page.clock.runFor(500)
    await page.locator('.terminal-host').evaluate((host) => {
      const event = new Event('touchend', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', { value: [] })
      host.dispatchEvent(event)
    })
    await page.getByRole('button', { name: '复制', exact: true }).click()
    await expect(
      page.getByRole('textbox', { name: '可见终端文本' }),
    ).toHaveValue('PROMPT> ')
  })
}
