import { expect, test } from '@playwright/test'
import {
  clearSessions,
  emulateMobileUserAgent,
  login,
  openTerminal,
  recordFrames,
  recordSockets,
} from './helpers'

test.afterEach(async ({ page }) => {
  await clearSessions(page)
})

test('辅助键栏、Ctrl/Shift 组合键、隐藏键盘', async ({ page }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const frames = recordFrames(page)
  await openTerminal(page)
  const bar = page.getByLabel('终端辅助键')
  const input = page.locator('.xterm-helper-textarea:visible')
  for (const label of [
    '显示键盘',
    '发送 Esc',
    '发送 Tab',
    'Ctrl 组合键',
    'Shift 组合键',
    '发送 ↑',
    '发送 ↓',
    '发送 ←',
    '发送 →',
    '发送 Enter',
    '发送 Ctrl+C',
    '发送 Ctrl+D',
    '发送 Ctrl+L',
    '发送 Home',
    '发送 PgUp',
    '发送 PgDn',
    '发送 End',
  ]) {
    await expect(bar.getByRole('button', { name: label })).toBeVisible()
  }
  const enterKey = bar.getByRole('button', { name: '发送 Enter' })
  const enterIcon = enterKey.locator('svg')
  await expect(enterIcon).toHaveAttribute('width', '14')
  await expect(enterIcon.locator('path')).toHaveAttribute(
    'd',
    'M9 10 4 15l5 5M20 4v7a4 4 0 0 1-4 4H4',
  )
  await expect(
    bar.getByRole('button', { name: '显示键盘' }).locator('svg path'),
  ).toHaveAttribute('d', /M8 20h8$/)
  await expect(input).toHaveAttribute('readonly', '')
  await input.evaluate((node) => {
    node.dataset.focusEvents = ''
    node.addEventListener('blur', () => {
      node.dataset.focusEvents += 'b'
    })
    node.addEventListener('focus', () => {
      node.dataset.focusEvents += 'f'
    })
  })
  await page.locator('.xterm-screen:visible').click()
  await expect(input).not.toBeFocused()
  await expect(page.locator('.xterm:visible')).not.toHaveClass(/focus/)
  await expect(input).toHaveAttribute('readonly', '')
  await expect(input).toHaveAttribute('data-focus-events', '')
  const touchCancelled = await page
    .locator('.terminal-host:visible')
    .evaluate((node) => {
      const event = new Event('touchend', {
        bubbles: true,
        cancelable: true,
      })
      Object.defineProperty(event, 'touches', { value: [] })
      node.dispatchEvent(event)
      return event.defaultPrevented
    })
  expect(touchCancelled).toBe(true)
  await input.focus()
  await expect(input).not.toBeFocused()
  await expect(bar.getByRole('button', { name: '显示键盘' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await input.evaluate((node) => {
    node.dataset.focusEvents = ''
  })
  const keyboard = bar.getByRole('button', { name: '显示键盘' })
  await keyboard.click()
  await expect(input).not.toHaveAttribute('readonly', '')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('data-focus-events', 'f')
  await expect(bar.getByRole('button', { name: '隐藏键盘' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await input.evaluate((node) => node.blur())
  await expect(input).toHaveAttribute('readonly', '')
  await expect(bar.getByRole('button', { name: '显示键盘' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await bar.getByRole('button', { name: '显示键盘' }).click()
  await expect(input).toBeFocused()
  await expect(bar.getByRole('button', { name: '隐藏键盘' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(bar.getByRole('button', { name: '选择文本' })).toHaveCount(0)

  // Navigation and control keys keep their standard sequences.
  await bar.getByRole('button', { name: '发送 Home' }).click()
  await bar.getByRole('button', { name: '发送 End' }).click()
  await bar.getByRole('button', { name: '发送 Ctrl+L' }).click()
  await bar.getByRole('button', { name: '发送 →' }).click()
  await expect
    .poll(() => frames.sent.includes('\x1b[H\x1b[F\x0c\x1b[C'))
    .toBe(true)
  const beforeEnter = frames.sent.length
  await bar.getByRole('button', { name: '发送 Enter' }).click()
  await expect.poll(() => frames.sent.slice(beforeEnter)).toBe('\r')

  const shift = bar.getByRole('button', { name: 'Shift 组合键' })
  const beforeShiftTab = frames.sent.length
  await shift.click()
  await expect(shift).toHaveAttribute('aria-pressed', 'true')
  await bar.getByRole('button', { name: '发送 Tab' }).click()
  await expect.poll(() => frames.sent.slice(beforeShiftTab)).toBe('\x1b[Z')
  await expect(shift).toHaveAttribute('aria-pressed', 'false')

  const beforeShiftText = frames.sent.length
  await shift.click()
  await page.keyboard.insertText('a')
  await expect.poll(() => frames.sent.slice(beforeShiftText)).toBe('A')
  await expect(shift).toHaveAttribute('aria-pressed', 'false')

  // Sticky Ctrl: the next latin letter becomes one control character.
  const ctrl = bar.getByRole('button', { name: 'Ctrl 组合键' })
  await expect(ctrl).toHaveText('Ctrl')
  await expect(bar.getByRole('button', { name: '发送 Ctrl+C' })).toHaveText(
    '^C',
  )
  await expect(bar.getByRole('button', { name: '发送 Ctrl+D' })).toHaveText(
    '^D',
  )
  await expect(bar.getByRole('button', { name: '发送 Ctrl+L' })).toHaveText(
    '^L',
  )
  await ctrl.click()
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true')
  const before = frames.sent.length
  await input.focus()
  await page.keyboard.press('d')
  await expect.poll(() => frames.sent.slice(before).includes('\x04')).toBe(true)
  expect(frames.sent.slice(before)).not.toContain('d')
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false')

  const focused = () =>
    page.evaluate(() => document.activeElement?.className ?? '')
  await input.focus()
  await expect.poll(focused).toContain('xterm-helper-textarea')
  const hide = bar.getByRole('button', { name: '隐藏键盘' })
  await hide.click()
  await expect.poll(focused).not.toContain('xterm-helper-textarea')
  await expect(input).toHaveAttribute('readonly', '')
  await expect(bar.getByRole('button', { name: '显示键盘' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(errors).toEqual([])
})

for (const platform of ['Android', 'iPhone'] as const) {
  test(`${platform} 收起系统键盘后辅助键恢复显示键盘状态`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await emulateMobileUserAgent(page, platform)
    await openTerminal(page)
    const keyboard = page.getByLabel('终端辅助键').locator('button').first()
    const input = page.locator('.xterm-helper-textarea:visible')

    await keyboard.click()
    await expect(keyboard).toHaveAttribute('aria-pressed', 'true')
    await expect(input).toBeFocused()

    // Mobile browsers can dismiss the IME while leaving xterm's textarea
    // focused. Viewport shrink/restore models that signal without a blur.
    await page.setViewportSize({ width: 390, height: 500 })
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--viewport-height'),
        ),
      )
      .toBe('500px')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(keyboard).toHaveAttribute('aria-label', '显示键盘')
    await expect(keyboard).toHaveAttribute('aria-pressed', 'false')
    await expect(input).toHaveAttribute('readonly', '')
    await expect(input).not.toBeFocused()
  })
}

test('Android 覆盖式键盘收起时不依赖视口 resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await emulateMobileUserAgent(page, 'Android')
  await page.addInitScript(() => {
    let height = 0
    const keyboard = new EventTarget()
    Object.defineProperty(keyboard, 'boundingRect', {
      get: () => new DOMRect(0, 0, 0, height),
    })
    Object.defineProperty(navigator, 'virtualKeyboard', {
      configurable: true,
      value: keyboard,
    })
    Object.defineProperty(window, '__setKeyboardHeight', {
      value: (nextHeight: number) => {
        height = nextHeight
        keyboard.dispatchEvent(new Event('geometrychange'))
      },
    })
  })
  await openTerminal(page)
  const keyboard = page.getByLabel('终端辅助键').locator('button').first()
  const input = page.locator('.xterm-helper-textarea:visible')
  await keyboard.click()
  await expect(input).toBeFocused()
  await page.evaluate(() => {
    ;(
      window as Window & { __setKeyboardHeight: (height: number) => void }
    ).__setKeyboardHeight(280)
  })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  )
  await expect(keyboard).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => {
    ;(
      window as Window & { __setKeyboardHeight: (height: number) => void }
    ).__setKeyboardHeight(0)
  })
  await expect(keyboard).toHaveAttribute('aria-label', '显示键盘')
  await expect(input).toHaveAttribute('readonly', '')
  await expect(input).not.toBeFocused()
})

for (const applicationMode of [true, false]) {
  test(`辅助键在${applicationMode ? '应用' : '普通'}光标键模式下发送正确序列`, async ({
    page,
  }) => {
    await emulateMobileUserAgent(page, 'iPhone')
    const frames = recordFrames(page)
    await openTerminal(page)
    await page.getByRole('button', { name: '显示键盘' }).click()
    const bar = page.getByLabel('终端辅助键')
    const expectModeAndKeys = async (beforeQuery: number) => {
      await expect
        .poll(() => frames.sent.slice(beforeQuery))
        // DSR replies intentionally begin with Escape.
        // eslint-disable-next-line no-control-regex
        .toMatch(/\x1b\[\d+;\d+R/)
      const beforeKeys = frames.sent.length
      for (const label of ['↑', '↓', '←', '→', 'Home', 'End']) {
        await bar
          .getByRole('button', { name: `发送 ${label}`, exact: true })
          .click()
      }
      const prefix = applicationMode ? '\x1bO' : '\x1b['
      const expected = ['A', 'B', 'D', 'C', 'H', 'F']
        .map((suffix) => prefix + suffix)
        .join('')
      await expect.poll(() => frames.sent.slice(beforeKeys)).toBe(expected)
    }
    await page.locator('.xterm-helper-textarea:visible').focus()
    const beforeMode = frames.sent.length
    // Enable DECCKM first, then optionally disable it to test both transitions.
    // DSR follows the mode sequence: its reply proves xterm has parsed the mode.
    // Consume replies and keys without echo or canonical buffering so they never
    // become shell commands. Each Enter requests a fresh parser barrier, also
    // after reload/login. afterEach removes this terminal and its reader process.
    const mode = applicationMode ? '' : '\\033[?1l\\033>'
    await page.keyboard.insertText(
      `stty -echo -icanon min 1 time 0; printf '\\033[?1h\\033=${mode}\\033[6n'; while IFS= read -r line; do printf '\\033[6n'; done`,
    )
    await page.keyboard.press('Enter')
    await expectModeAndKeys(beforeMode)

    for (const reconnect of ['reload', 'login']) {
      if (reconnect === 'reload') {
        await page.reload()
      } else {
        await page.getByRole('button', { name: '更多操作' }).click()
        await page.getByRole('menuitem', { name: '退出登录' }).click()
        await expect(page.getByLabel('访问凭据')).toBeVisible()
        await login(page)
      }
      await expect(page.locator('[role="status"].sr-only')).toContainText(
        '已连接',
      )
      await page.getByRole('button', { name: '显示键盘' }).click()
      const beforeQuery = frames.sent.length
      await page.locator('.xterm-helper-textarea').focus()
      await page.keyboard.press('Enter')
      await expectModeAndKeys(beforeQuery)
    }
  })
}

test('辅助键栏保持单行并可横向滑动', async ({ page }) => {
  await emulateMobileUserAgent(page, 'Android')
  await openTerminal(page)
  await page.setViewportSize({ width: 360, height: 780 })
  const bar = page.locator('.aux-bar')
  await expect(bar).toBeVisible()
  const scroll = bar.locator('.aux-scroll')
  const keyboard = bar.getByRole('button', { name: '显示键盘' })
  const keyboardBefore = await keyboard.boundingBox()
  expect(keyboardBefore?.width).toBe(66)
  const metrics = await scroll.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      overflowX: style.overflowX,
      scrollbarWidth: style.scrollbarWidth,
    }
  })
  expect(metrics.overflowX).toBe('auto')
  // No visible scrollbar on WebKit/Blink or Gecko.
  expect(metrics.scrollbarWidth).toBe('none')
  // A phone width must overflow, otherwise the assertions below guard nothing.
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
  const first = await bar.locator('.aux-key').first().boundingBox()
  const narrow = await bar.boundingBox()
  expect(first!.x).toBeGreaterThanOrEqual(narrow!.x)
  // Keys never wrap onto a second row.
  const tops = await bar
    .locator('.aux-key')
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    )
  expect(tops.length).toBeGreaterThan(8)
  expect(new Set(tops).size).toBe(1)
  // Sliding right reveals the keys past the right edge.
  const slid = await scroll.evaluate((node) => {
    node.scrollLeft = node.scrollWidth
    return node.scrollLeft
  })
  expect(slid).toBeGreaterThan(0)
  expect(await keyboard.boundingBox()).toEqual(keyboardBefore)
  await keyboard.click()
  await expect(page.locator('.xterm-helper-textarea:visible')).toBeFocused()
  // On a tablet, spare space is shared evenly on both sides of the row.
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect
    .poll(async () => {
      const outer = (await scroll.boundingBox())!
      const track = (await bar.locator('.aux-track').boundingBox())!
      expect(track.width).toBeLessThan(outer.width)
      return Math.abs(track.x + track.width / 2 - outer.x - outer.width / 2)
    })
    .toBeLessThan(1)
})

test('桌面端不显示辅助键栏', async ({ page }) => {
  await openTerminal(page)
  await expect(page.getByLabel('终端辅助键')).toHaveCount(0)
})

for (const agent of [
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
]) {
  test(`iPad 辅助键栏：${agent.includes('iPad') ? 'iPad UA' : '桌面 UA'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.addInitScript((userAgent) => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: userAgent,
      })
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        value: 5,
      })
    }, agent)
    await openTerminal(page)
    await expect(page.getByLabel('终端辅助键')).toBeVisible()
    await expect(page.locator('.workspace')).toHaveAttribute(
      'data-aux-keys',
      'true',
    )
    await expect(page.getByRole('button', { name: '显示键盘' })).toBeVisible()
  })
}

test('长按拖动与键盘排序不重连、不改编号或当前终端', async ({ page }) => {
  const sockets = recordSockets(page)
  await openTerminal(page)
  for (let count = 2; count <= 3; count++) {
    await page.getByRole('button', { name: '新建终端' }).click()
    await expect(page.getByRole('tab')).toHaveCount(count)
    await expect(page.locator('[role="status"].sr-only')).toContainText(
      '已连接',
    )
  }
  const tabs = page.getByRole('tab')
  const ids = await tabs.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-session-id')),
  )
  const first = tabs.nth(0)
  const last = tabs.nth(2)
  const start = (await first.boundingBox())!
  const end = (await last.boundingBox())!
  const connections = sockets.length
  await page.clock.install()
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.clock.fastForward(500)
  await expect(first).toHaveAttribute('data-dragging', 'true')
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2)
  // Releasing before the next animation frame still uses the final pointer position.
  await page.mouse.up()
  await expect(tabs.nth(2)).toHaveAttribute('data-session-id', ids[0]!)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
    'data-session-id',
    ids[2]!,
  )
  await tabs.nth(2).focus()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(tabs.nth(1)).toHaveAttribute('data-session-id', ids[0]!)
  await expect(tabs.nth(1)).toBeFocused()
  expect(
    await tabs.evaluateAll((items) =>
      items.map((item) => item.textContent?.match(/终端 (\d+)/)?.[1]),
    ),
  ).toEqual(['2', '1', '3'])
  expect(sockets).toHaveLength(connections)
  const beforeCancel = await tabs.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-session-id')),
  )
  const held = (await tabs.nth(1).boundingBox())!
  await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2)
  await page.mouse.down()
  await page.clock.fastForward(500)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(
    await tabs.evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-session-id')),
    ),
  ).toEqual(beforeCancel)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
    'data-session-id',
    ids[2]!,
  )
})

test('多会话：新建、切换不重连、⋯ 菜单关闭', async ({ page }) => {
  const frames = recordFrames(page)
  const sockets = recordSockets(page)
  let dialogs = 0
  page.on('dialog', async (dialog) => {
    dialogs++
    await dialog.dismiss()
  })
  await openTerminal(page)
  // Two terminals are mounted at once, so target the visible one.
  const input = page.locator('.xterm-helper-textarea:visible')
  await input.focus()
  await page.keyboard.insertText("printf 'SESSION-ONE\\n'")
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('SESSION-ONE')
  const first = page.getByRole('tab').nth(0)
  await expect(first).toHaveAttribute('aria-selected', 'true')
  const firstSocket = sockets[0]
  expect(firstSocket).toContain('/terminal')

  // The ＋ button appends another session and focuses it.
  await page.getByRole('button', { name: '新建终端' }).click()
  const second = page.getByRole('tab').nth(1)
  await expect(second).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await input.focus()
  await page.keyboard.insertText("printf 'SESSION-TWO\\n'")
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('SESSION-TWO')
  // Only the active session is rendered; inactive ones stay connected.
  await expect(page.locator('.xterm-screen:visible')).toHaveCount(1)
  expect(sockets.filter((url) => url === firstSocket)).toHaveLength(1)

  // Switching back keeps the same connection instead of reattaching.
  await first.click()
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  expect(sockets.filter((url) => url === firstSocket)).toHaveLength(1)
  await expect(page.locator('.xterm-screen:visible')).toHaveCount(1)
  await input.focus()
  await page.keyboard.insertText("printf 'SESSION-ONE-AGAIN\\n'")
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('SESSION-ONE-AGAIN')

  // Closing the active session leaves the other one running, and the
  // remaining tab keeps its own label instead of renumbering.
  const label = (await second.textContent())!.match(/终端 (\d+)/)![1]
  const closedLabel = (await first.textContent())!.match(/终端 (\d+)/)![1]
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '关闭当前终端' }).click()
  expect(dialogs).toBe(0)
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(
    page.getByRole('tab', { name: new RegExp(`终端 ${label}`) }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  expect(sockets.filter((url) => url === firstSocket)).toHaveLength(1)
  await page.getByRole('button', { name: '新建终端' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab').last()).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('tab').last()).toContainText(
    `终端 ${closedLabel}`,
  )
})

test('关闭请求完成后保留用户新选择的终端', async ({ page }) => {
  await openTerminal(page)
  for (let count = 2; count <= 3; count++) {
    await page.getByRole('button', { name: '新建终端' }).click()
    await expect(page.getByRole('tab')).toHaveCount(count)
    await expect(page.locator('[role="status"].sr-only')).toContainText(
      '已连接',
    )
  }
  const first = page.getByRole('tab').nth(0)
  await page.getByRole('tab').nth(1).click()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const holdDelete = async (route: import('@playwright/test').Route) => {
    if (route.request().method() === 'DELETE') await gate
    await route.continue()
  }
  await page.route('**/api/session/*', holdDelete)
  try {
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '关闭当前终端' }).click()
    await expect(
      page.locator('.global-toast-anchor .status-toast-info'),
    ).toContainText('正在关闭终端…')
    await first.click()
    await expect(first).toHaveAttribute('aria-selected', 'true')
    release()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(first).toHaveAttribute('aria-selected', 'true')
  } finally {
    release()
    await page.unroute('**/api/session/*', holdDelete)
  }
})

test('超过 8 个终端后仍可通过新建按钮创建终端', async ({ page }) => {
  await openTerminal(page)
  const create = page.getByRole('button', { name: '新建终端' })
  for (let count = 2; count <= 10; count++) {
    await expect(create).toBeEnabled()
    await create.click()
    await expect(page.getByRole('tab')).toHaveCount(count)
    await expect(page.getByRole('tab').last()).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator('[role="status"].sr-only')).toContainText(
      '已连接',
    )
  }
  await expect(create).toBeEnabled()
  await page.getByRole('button', { name: '更多操作' }).click()
  await expect(page.locator('.menu-heading')).toHaveText('终端与设置10 个终端')
})

test.describe('触摸标签排序', () => {
  test.use({ hasTouch: true })

  test('短滑不触发排序，长按可取消或拖到新位置', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await emulateMobileUserAgent(page, 'iPhone')
    await openTerminal(page)
    await page.getByRole('button', { name: '新建终端' }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.locator('[role="status"].sr-only')).toContainText(
      '已连接',
    )
    const tabs = page.getByRole('tab')
    const id = await tabs.nth(0).getAttribute('data-session-id')
    const first = (await tabs.nth(0).boundingBox())!
    const second = (await tabs.nth(1).boundingBox())!
    const start = {
      x: first.x + first.width / 2,
      y: first.y + first.height / 2,
    }
    const end = {
      x: second.x + second.width / 2,
      y: second.y + second.height / 2,
    }
    const client = await page.context().newCDPSession(page)
    await page.clock.install()

    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [start],
    })
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [end],
    })
    await page.clock.fastForward(600)
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(0)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect(tabs.nth(0)).toHaveAttribute('data-session-id', id!)

    for (const type of ['touchCancel', 'touchEnd'] as const) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [start],
      })
      await page.clock.fastForward(500)
      await expect(tabs.nth(0)).toHaveAttribute('data-dragging', 'true')
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [end],
      })
      await page.clock.fastForward(32)
      await expect(tabs.nth(1)).toHaveAttribute('data-drop-target', 'true')
      await client.send('Input.dispatchTouchEvent', { type, touchPoints: [] })
      await expect(page.locator('[data-dragging="true"]')).toHaveCount(0)
      await expect(tabs.nth(type === 'touchCancel' ? 0 : 1)).toHaveAttribute(
        'data-session-id',
        id!,
      )
    }
    await client.detach()
  })
})

for (const mode of ['available', 'missing', 'blocked'] as const) {
  test(`长按振动反馈：${mode}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((mode) => {
      const vibrations: number[] = []
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value:
          mode === 'missing'
            ? undefined
            : (duration: number) => {
                if (mode === 'blocked') throw new Error('Vibration unavailable')
                vibrations.push(duration)
                document.documentElement.dataset.vibrations =
                  JSON.stringify(vibrations)
                return true
              },
      })
    }, mode)
    await openTerminal(page)
    await page.clock.install()
    const tab = page.getByRole('tab').nth(0)
    const box = (await tab.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.clock.fastForward(100)
    await page.mouse.up()
    await expect(page.locator('html')).not.toHaveAttribute('data-vibrations')
    await page.mouse.down()
    await page.clock.fastForward(500)
    await expect(tab).toHaveAttribute('data-dragging', 'true')
    await page.clock.fastForward(1000)
    if (mode === 'available') {
      await expect(page.locator('html')).toHaveAttribute(
        'data-vibrations',
        '[15]',
      )
    }
    await page.mouse.up()
    await expect(tab).not.toHaveAttribute('data-dragging')
    expect(errors).toEqual([])
  })
}

test('长按终端标签不会关闭终端', async ({ page }) => {
  await openTerminal(page)
  let dialogs = 0
  page.on('dialog', async (dialog) => {
    dialogs++
    await dialog.dismiss()
  })
  await page.clock.install()
  const tab = page.getByRole('tab').nth(0)
  const box = (await tab.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.clock.fastForward(600)
  await expect(tab).toBeVisible()
  await page.mouse.up()
  expect(dialogs).toBe(0)
  await expect(page.getByRole('tab')).toHaveCount(1)
})

for (const platform of ['Android', 'iPhone'] as const) {
  test(`${platform} 的 Shift + Enter 发送一次 LF，随后 Enter 恢复 CR`, async ({
    page,
  }) => {
    await emulateMobileUserAgent(page, platform)
    const frames = recordFrames(page)
    await openTerminal(page)
    const bar = page.getByLabel('终端辅助键')
    const shift = bar.getByRole('button', { name: 'Shift 组合键' })
    const enter = bar.getByRole('button', { name: '发送 Enter' })
    await bar.getByRole('button', { name: '显示键盘' }).click()
    const input = page.locator('.xterm-helper-textarea:visible')
    await expect(input).toBeFocused()
    const before = frames.sent.length
    await shift.click()
    await expect(shift).toHaveAttribute('aria-pressed', 'true')
    await enter.click()
    await expect.poll(() => frames.sent.slice(before)).toBe('\n')
    await expect(shift).toHaveAttribute('aria-pressed', 'false')
    await expect(input).toBeFocused()
    await enter.click()
    await expect.poll(() => frames.sent.slice(before)).toBe('\n\r')
    await expect(input).toBeFocused()
  })
}
