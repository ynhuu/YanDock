import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearSessions, login, openTerminal } from './helpers'

async function domRenderer(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        return type === 'webgl2'
          ? null
          : Reflect.apply(original, this, [type, ...args])
      },
    })
  })
}
async function command(page: Page, text: string) {
  await page.locator('.xterm-helper-textarea:visible').focus()
  await page.keyboard.insertText(text)
  await page.keyboard.press('Enter')
}
function print(text: string) {
  return (
    "printf '" +
    Array.from(
      Buffer.from(text),
      (b) => '\\' + b.toString(8).padStart(3, '0'),
    ).join('') +
    "'"
  )
}
function screen(page: Page) {
  return page.locator('.terminal-host:visible .xterm-rows')
}
async function connected(page: Page) {
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
}

test.beforeEach(async ({ page }) => domRenderer(page))
test.afterEach(async ({ page }) => clearSessions(page))

test('刷新恢复彩色中文画面，原有输出不重复', async ({ page }) => {
  await openTerminal(page)
  await command(page, print('\x1b[31mREFRESH_中文😀\x1b[0m\r\n'))
  await expect(screen(page)).toContainText('REFRESH_中文😀')
  await page.reload()
  await connected(page)
  await expect(screen(page)).toContainText('REFRESH_中文😀')
  expect(
    (await screen(page).innerText()).match(/REFRESH_中文😀/g),
  ).toHaveLength(1)
  await command(page, print('LIVE_AFTER_REFRESH\r\n'))
  await expect(screen(page)).toContainText('LIVE_AFTER_REFRESH')
})

test('断线期间的输出在重连后恢复，并与实时输出按序衔接', async ({ page }) => {
  let disconnect!: () => void
  await page.routeWebSocket('**/api/session/*/terminal', (route) => {
    const server = route.connectToServer()
    disconnect = () => {
      route.close()
      server.close()
    }
  })
  const directory = await mkdtemp(join(tmpdir(), 'yandock-replay-'))
  const fifo = join(directory, 'go')
  const ack = join(directory, 'ack')
  execFileSync('mkfifo', [fifo])
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  try {
    await openTerminal(page)
    await command(page, print('BEFORE_DISCONNECT\r\n'))
    await expect(screen(page)).toContainText('BEFORE_DISCONNECT')
    await command(
      page,
      `(${print('WAITING_OFFLINE\r\n')}; read -r token < ${quote(fifo)}; ${print('DURING_DISCONNECT\r\n')}; printf done > ${quote(ack)}) &`,
    )
    await expect(screen(page)).toContainText('WAITING_OFFLINE')
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    disconnect()
    await expect(page.locator('[role="status"].sr-only')).toContainText(
      '自动重连中',
    )
    await writeFile(fifo, 'go\n')
    await expect.poll(() => readFile(ack, 'utf8').catch(() => '')).toBe('done')
    await page.clock.resume()
    await connected(page)
    await expect(screen(page)).toContainText('DURING_DISCONNECT')
    const text = await screen(page).innerText()
    expect(text.match(/BEFORE_DISCONNECT/g)).toHaveLength(1)
    expect(text.match(/DURING_DISCONNECT/g)).toHaveLength(1)
    await command(page, print('AFTER_RECONNECT\r\n'))
    await expect(screen(page)).toContainText('AFTER_RECONNECT')
  } finally {
    await clearSessions(page)
    await rm(directory, { recursive: true, force: true })
  }
})

test('全屏 ANSI 程序刷新后恢复备用屏幕与光标定位', async ({ page }) => {
  await openTerminal(page)
  await command(
    page,
    print('\x1b[?1049h\x1b[2J\x1b[3;5HFULLSCREEN_中文\x1b[6;1H'),
  )
  await expect(screen(page)).toContainText('FULLSCREEN_中文')
  await page.reload()
  await connected(page)
  await expect(screen(page)).toContainText('FULLSCREEN_中文')
  const lines = screen(page).locator(':scope > div')
  await expect(lines.nth(2)).toContainText('FULLSCREEN_中文')
  await command(page, print('\x1b[?1049l'))
  await expect(screen(page)).not.toContainText('FULLSCREEN_中文')
})

test('保留尺寸变化，换到窄屏刷新后仍能恢复并继续输入', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 })
  await openTerminal(page)
  await command(page, print('WIDE_HISTORY\r\n'))
  await expect(screen(page)).toContainText('WIDE_HISTORY')
  await page.setViewportSize({ width: 600, height: 700 })
  await command(page, print('NARROW_HISTORY\r\n'))
  await expect(screen(page)).toContainText('NARROW_HISTORY')
  await page.setViewportSize({ width: 390, height: 700 })
  await page.reload()
  await connected(page)
  await expect(screen(page)).toContainText('WIDE_HISTORY')
  await expect(screen(page)).toContainText('NARROW_HISTORY')
  await command(page, print('CURRENT_SIZE\r\n'))
  await expect(screen(page)).toContainText('CURRENT_SIZE')
})

test('后登录设备恢复旧画面并继续使用同一进程', async ({ page, browser }) => {
  await openTerminal(page)
  await command(page, `${print('DEVICE_HISTORY\r\n')}; REPLAY_VALUE=kept`)
  await expect(screen(page)).toContainText('DEVICE_HISTORY')
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  })
  const other = await context.newPage()
  await domRenderer(other)
  try {
    await login(other)
    await connected(other)
    await expect(page.getByLabel('访问凭据')).toBeVisible()
    await expect(screen(other)).toContainText('DEVICE_HISTORY')
    await command(other, 'printf "RESTORED-%s\\n" "$REPLAY_VALUE"')
    await expect(screen(other)).toContainText('RESTORED-kept')
  } finally {
    await clearSessions(other)
    await context.close()
  }
})

test('进程结束后刷新仍可查看最后画面', async ({ page }) => {
  await openTerminal(page)
  await command(page, `${print('FINAL_SCREEN\r\n')}; exit`)
  await expect(page.locator('[role="status"].sr-only')).toContainText(
    '进程已结束',
  )
  await page.reload()
  await expect(page.locator('[role="status"].sr-only')).toContainText(
    '进程已结束',
  )
  await expect(screen(page)).toContainText('FINAL_SCREEN')
})

test('输出超出保留范围时恢复最近内容且不弹截断提示', async ({ page }) => {
  await openTerminal(page)
  await command(
    page,
    `i=0; while [ "$i" -lt 6000 ]; do printf 'padding-%06d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n' "$i"; i=$((i+1)); done; ${print('LATEST_SCREEN\r\n')}`,
  )
  await expect(screen(page)).toContainText('LATEST_SCREEN', { timeout: 15000 })
  await page.reload()
  await connected(page)
  await expect(screen(page)).toContainText('LATEST_SCREEN')
  await expect(page.locator('.status-toast-warning')).toHaveCount(0)
})

test('移动端默认渲染器刷新后恢复可见文本，复制快照不重复', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:18080',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
  })
  const page = await context.newPage()
  let received = ''
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string')
        received += new TextDecoder().decode(payload)
    }),
  )
  try {
    await openTerminal(page)
    await page.getByRole('button', { name: '显示键盘' }).click()
    await command(page, print('MOBILE_RECOVERY_中文\r\n'))
    await expect.poll(() => received).toContain('MOBILE_RECOVERY_中文')
    await page.reload()
    await connected(page)
    await page.screenshot({ path: '/private/tmp/yandock-replay-mobile.png' })
    await page.clock.install()
    const host = page.locator('.terminal-host:visible')
    const touch = async (type: string) =>
      host.evaluate((element, type) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'touches', {
          value: type === 'touchend' ? [] : [{ clientX: 40, clientY: 100 }],
        })
        element.dispatchEvent(event)
      }, type)
    await touch('touchstart')
    await page.clock.runFor(500)
    await touch('touchend')
    const dialog = page.getByRole('dialog', { name: '复制与粘贴' })
    await dialog.getByRole('button', { name: '复制', exact: true }).click()
    const snapshot = dialog.getByRole('textbox', { name: '可见终端文本' })
    await expect(snapshot).toHaveValue(/MOBILE_RECOVERY_中文/)
    expect(
      (await snapshot.inputValue()).match(/MOBILE_RECOVERY_中文/g),
    ).toHaveLength(1)
  } finally {
    await clearSessions(page)
    await context.close()
  }
})
