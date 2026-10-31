import { expect, test } from '@playwright/test'
import {
  clearSessions,
  emulateMobileUserAgent,
  login,
  openTerminal,
  recordFrames,
} from './helpers'

test.afterEach(async ({ page }) => {
  await clearSessions(page)
})

test('输出中断提示紧凑、位于底部且图文垂直居中并使用黄色提醒色', async ({
  page,
}) => {
  let notify: (() => void) | undefined
  await page.routeWebSocket('**/terminal', (route) => {
    route.connectToServer()
    notify = () =>
      route.send(
        JSON.stringify({
          type: 'status',
          message: '输出中断，自动重连',
          retryable: true,
        }),
      )
  })
  await openTerminal(page)
  notify!()
  const toast = page.locator('.global-toast-anchor .status-toast-warning')
  await expect(toast).toHaveText('输出中断，自动重连')
  await expect(toast).toHaveCSS('align-items', 'center')
  const geometry = await toast.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const parent = element.parentElement!.getBoundingClientRect()
    return {
      height: rect.height,
      dx: Math.abs(rect.left + rect.width / 2 - parent.left - parent.width / 2),
      bottomGap: parent.bottom - rect.bottom,
    }
  })
  expect(geometry.height).toBeLessThan(56)
  expect(geometry.dx).toBeLessThan(1)
  expect(geometry.bottomGap).toBeCloseTo(0, 0)
  const dock = await page
    .getByRole('navigation', { name: '终端标签栏' })
    .boundingBox()
  const toastBox = await toast.boundingBox()
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(dock!.y)
  expect(
    await toast.locator('.status-toast-icon').evaluate((icon) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--warning)'
      icon.append(probe)
      const matches =
        getComputedStyle(icon).color === getComputedStyle(probe).color
      probe.remove()
      return matches
    }),
  ).toBe(true)
})

test('连接与重连显示统一状态卡片，连接成功后移除等待提示', async ({ page }) => {
  let releaseHello: (() => void) | undefined
  let disconnect = () => {}
  await page.routeWebSocket('**/terminal', (route) => {
    const server = route.connectToServer()
    let released = false
    const held: (string | Buffer)[] = []
    server.onMessage((message) => {
      if (typeof message === 'string' && message.includes('"type":"hello"')) {
        releaseHello = () => {
          released = true
          route.send(message)
          for (const frame of held) route.send(frame)
          held.length = 0
        }
      } else if (released) route.send(message)
      else held.push(message)
    })
    disconnect = () => {
      route.close()
      server.close()
    }
  })
  await login(page)
  await clearSessions(page)
  await page.getByRole('button', { name: '新建终端' }).click()
  const overlay = page.locator('.global-toast-anchor .status-toast')
  await expect(overlay).toHaveText('正在连接终端…')
  await expect(overlay).toHaveClass(/status-toast-info/)
  await expect(
    page.getByRole('region', { name: '终端', exact: true }),
  ).toHaveAttribute('aria-busy', 'true')
  await expect.poll(() => !!releaseHello).toBe(true)
  releaseHello!()
  releaseHello = undefined
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect(overlay).toHaveCount(0)

  await page.clock.install()
  disconnect()
  await expect(overlay).toHaveText('正在重新连接终端…')
  await expect(overlay).toHaveClass(/status-toast-warning/)
  await page.clock.runFor(1000)
  await expect.poll(() => !!releaseHello).toBe(true)
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveCount(1)
  releaseHello!()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect(overlay).toHaveCount(0)

  await page.locator('.xterm-helper-textarea:visible').focus()
  await page.keyboard.insertText('exit')
  await page.keyboard.press('Enter')
  await expect(page.locator('[role="status"].sr-only')).toContainText(
    '进程已结束',
  )
  await expect(overlay).toHaveText('进程已结束')
  await expect(overlay).toHaveClass(/status-toast-warning/)
})

test('终端尚未加载时也显示唯一连接状态卡片', async ({ page }) => {
  await login(page)
  await clearSessions(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/assets/Terminal-*.js', async (route) => {
    await gate
    await route.continue()
  })
  try {
    for (let count = 1; count <= 3; count++) {
      await page.getByRole('button', { name: '新建终端' }).click()
      await expect(page.getByRole('tab')).toHaveCount(count)
      await expect(page.locator('[role="status"].sr-only')).toContainText(
        '连接中',
      )
      const overlay = page.locator('.global-toast-anchor .status-toast')
      await expect(overlay).toHaveCount(1)
      await expect(overlay).toHaveText('正在连接终端…')
      await expect(overlay).toBeVisible()
      await expect(overlay).toHaveClass(/status-toast-info/)
    }
    await expect(page.getByText('正在加载终端…')).toHaveCount(0)
    await expect(page.locator('.terminal-host')).toHaveCount(0)
  } finally {
    release()
  }
  await expect(page.locator('.terminal-host')).toHaveCount(3)
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect(page.locator('.global-toast-anchor .status-toast')).toHaveCount(
    0,
  )
})

test('主动退出时终端先断开也不显示登录失效提示', async ({ page }) => {
  const closed = new Promise<void>((resolve) => {
    page.on('websocket', (socket) => socket.on('close', () => resolve()))
  })
  await openTerminal(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/logout', async (route) => {
    const response = await route.fetch()
    await gate
    await route.fulfill({ response })
  })
  try {
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '退出登录' }).click()
    await closed
    // Force the revocation notification to arrive before the logout response.
    await expect(page.getByRole('alert')).toHaveCount(0)
    release()
    await expect(page.getByLabel('访问凭据')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    release()
  }
})

test('后登录设备踢出旧登录并继续使用原终端进程', async ({ page, browser }) => {
  const oldFrames = recordFrames(page)
  await openTerminal(page)
  await page.locator('.xterm-helper-textarea:visible').focus()
  await page.keyboard.insertText('YANDOCK_TAKEOVER=kept')
  await page.keyboard.press('Enter')
  await expect.poll(() => oldFrames.received).toContain('YANDOCK_TAKEOVER=kept')

  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  })
  const other = await otherContext.newPage()
  const frames = recordFrames(other)
  try {
    await login(other)
    await expect(page.getByLabel('访问凭据')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('其他设备登录')
    await expect(other.getByRole('tab')).toHaveCount(1)
    await expect(other.locator('[role="status"].sr-only')).toContainText(
      '已连接',
    )
    expect((await page.request.get('/api/sessions')).status()).toBe(401)
    // The recovered screen and input now belong to the new controller.
    await other.locator('.terminal-host:visible .xterm-helper-textarea').focus()
    await other.keyboard.insertText(
      'printf "TAKEOVER-%s\\n" "$YANDOCK_TAKEOVER"',
    )
    await other.keyboard.press('Enter')
    await expect.poll(() => frames.received).toContain('TAKEOVER-kept')
  } finally {
    await clearSessions(other)
    await otherContext.close()
  }
})

test('认证、中文终端、断线重连、控制冲突和关闭', async ({ page, context }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const frames = recordFrames(page)
  await openTerminal(page)
  await page.getByRole('button', { name: '显示键盘' }).click()
  await expect(
    page.locator('.xterm-screen:visible canvas').first(),
  ).toBeVisible()
  await expect(
    page.locator(
      '.terminal-host:visible .xterm-scrollable-element > .scrollbar.vertical',
    ),
  ).toHaveCSS('display', 'none')
  const input = page.locator('.xterm-helper-textarea')
  await input.focus()
  // insertText exercises Unicode input; it does not claim to simulate a real IME.
  await page.keyboard.insertText("printf '中文链路\\n'")
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('中文链路')
  await input.focus()
  await page.keyboard.insertText("printf '\\101\\116\\123\\127\\105\\122\\n'")
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('ANSWER')

  // The session already has a control connection, so a second page cannot
  // attach; it must keep retrying instead of sending input.
  const second = await context.newPage()
  const secondFrames = recordFrames(second)
  await second.goto('/')
  await expect(second.locator('[role="status"].sr-only')).toContainText(
    '自动重连中',
  )
  await second.locator('.xterm-helper-textarea').focus()
  await second.keyboard.insertText("printf 'LEAK\\n'")
  await second.keyboard.press('Enter')
  await input.focus()
  await page.keyboard.insertText("printf 'STILL-HERE\\n'")
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('STILL-HERE')
  expect(secondFrames.sent).toBe('')
  expect(frames.received).not.toContain('LEAK')
  await second.close()

  // Reloading reattaches automatically; the PTY keeps running.
  await page.reload()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '发送 Ctrl+C' })).toBeVisible()
  await page.getByRole('button', { name: '显示键盘' }).click()
  await input.focus()
  await page.keyboard.insertText(
    "printf '\\122\\105\\123\\125\\115\\105\\104\\n'",
  )
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('RESUMED')
  await expect
    .poll(async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true)

  // Simulate a CLI enabling alternate screen + SGR mouse reporting. Verify
  // the real xterm event path encodes wheel reports, not coarse page keys.
  await input.focus()
  await page.keyboard.insertText(
    "printf '\\033[?1049h\\033[?1000h\\033[?1006h'",
  )
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm:visible')).toHaveClass(
    /enable-mouse-events/,
  )
  const beforeWheel = frames.sent.length
  const gesture = await page
    .locator('.xterm-screen:visible')
    .evaluate((screen) => {
      const rect = screen.getBoundingClientRect()
      const dispatch = (type: string, y?: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'touches', {
          value:
            y === undefined
              ? []
              : [{ clientX: rect.left + 20, clientY: rect.top + y }],
        })
        screen.dispatchEvent(event)
        return event.defaultPrevented
      }
      dispatch('touchstart', rect.height * 0.1)
      const handled = dispatch('touchmove', rect.height * 0.9)
      dispatch('touchend')
      return handled
    })
  expect(gesture).toBe(true)
  await expect
    .poll(
      () =>
        frames.sent.slice(beforeWheel).split(`${String.fromCharCode(27)}[<64;`)
          .length - 1,
    )
    .toBeGreaterThanOrEqual(3)
  expect(frames.sent).not.toContain('\x1b[5~')

  // Closing and logging out now live in the bottom bar's ⋯ menu. Closing is immediate.
  let closeDialogs = 0
  page.on('dialog', async (dialog) => {
    closeDialogs++
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '关闭当前终端' }).click()
  expect(closeDialogs).toBe(0)
  await expect(page.getByRole('heading', { name: '还没有终端' })).toBeVisible()
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.getByLabel('访问凭据')).toBeVisible()
  expect(errors).toEqual([])
})

test('重新登录后恢复备用屏幕和鼠标滚轮模式', async ({ page }) => {
  const frames = recordFrames(page)
  await openTerminal(page)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText(
    "stty -echo -icanon min 1 time 0; printf '\\033[?1049h\\033[?1000h\\033[?1006h'; while IFS= read -r line; do :; done",
  )
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm')).toHaveClass(/enable-mouse-events/)
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page.getByLabel('访问凭据')).toBeVisible()
  await login(page)
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect(page.locator('.xterm')).toHaveClass(/enable-mouse-events/)
  const before = frames.sent.length
  await page.locator('.xterm-screen').evaluate(async (screen) => {
    const rect = screen.getBoundingClientRect()
    for (const [type, offset] of [
      ['touchstart', 0.2],
      ['touchmove', 0.8],
      ['touchend', null],
    ] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', {
        value:
          offset === null
            ? []
            : [
                {
                  clientX: rect.left + 20,
                  clientY: rect.top + rect.height * offset,
                },
              ],
      })
      screen.dispatchEvent(event)
    }
  })
  await expect.poll(() => frames.sent.slice(before)).toContain('\x1b[<64;')
  expect(frames.sent.slice(before)).not.toContain('\x1b[5~')
})

test('前端分块失效时给出提示而不是空白页', async ({ page }) => {
  await page.route('**/assets/Terminal-*.js', (route) => route.abort())
  await login(page)
  await clearSessions(page)
  await page.getByRole('button', { name: '新建终端' }).click()
  await expect(
    page.getByRole('heading', { name: '界面加载失败' }),
  ).toBeVisible()
  const reload = page.getByRole('button', { name: '重新加载页面' })
  await expect(reload).toBeVisible()
  await reload.focus()
  await expect(reload).toHaveCSS('outline-style', 'none')
})

test('WebGL2 不可用时回退 DOM，终端仍可输入和关闭', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (type === 'webgl2') return null
        return Reflect.apply(original, this, [type, ...args])
      },
    })
  })
  const frames = recordFrames(page)
  await openTerminal(page)
  await expect(page.locator('.xterm-rows:visible')).toBeVisible()
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText(
    "printf '\\106\\101\\114\\114\\102\\101\\103\\113\\n'",
  )
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('FALLBACK')
})
