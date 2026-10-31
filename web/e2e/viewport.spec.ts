import { expect, test } from '@playwright/test'
import {
  clearSessions,
  emulateMobileUserAgent,
  login,
  openTerminal,
  recordSockets,
} from './helpers'

test.afterEach(async ({ page }) => {
  await clearSessions(page)
})

test('禁止 Safari 双指和手势缩放', async ({ page }) => {
  await login(page)
  const result = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]',
    )
    const gesture = new Event('gesturestart', { cancelable: true })
    document.dispatchEvent(gesture)
    const pinch = new Event('touchmove', { cancelable: true })
    Object.defineProperty(pinch, 'touches', { value: [{}, {}] })
    document.dispatchEvent(pinch)
    return {
      viewport: viewport?.content ?? '',
      gesturePrevented: gesture.defaultPrevented,
      pinchPrevented: pinch.defaultPrevented,
    }
  })
  expect(result.viewport).toContain('maximum-scale=1')
  expect(result.viewport).toContain('user-scalable=no')
  expect(result.gesturePrevented).toBe(true)
  expect(result.pinchPrevented).toBe(true)
})

test('手机页面阻止页面滑动，同时允许滚动面板和输入框操作', async ({ page }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  await page.goto('/')
  await expect(page.getByLabel('访问凭据')).toBeVisible()
  const outcomes = await page.evaluate(() => {
    const dispatch = (target: Element, type: string, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', {
        value: [{ clientY: y }],
      })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    const page = document.querySelector('.login-screen')!
    const input = document.querySelector('input')!
    const scrollable = document.createElement('div')
    const content = document.createElement('div')
    scrollable.style.cssText =
      'position:fixed;top:0;left:0;width:40px;height:40px;overflow-y:auto'
    content.style.cssText = 'width:20px;height:200px'
    scrollable.append(content)
    page.append(scrollable)
    dispatch(page, 'touchstart', 20)
    const pull = dispatch(page, 'touchmove', 50)
    dispatch(page, 'touchend', 50)
    dispatch(page, 'touchstart', 50)
    const push = dispatch(page, 'touchmove', 20)
    dispatch(page, 'touchend', 20)
    dispatch(input, 'touchstart', 20)
    const inputMove = dispatch(input, 'touchmove', 50)
    dispatch(input, 'touchend', 50)
    scrollable.scrollTop = 12
    const panelScrollHeight = scrollable.scrollHeight
    const panelClientHeight = scrollable.clientHeight
    dispatch(content, 'touchstart', 80)
    const panelMove = dispatch(content, 'touchmove', 30)
    dispatch(content, 'touchend', 30)
    scrollable.scrollTop = 0
    dispatch(content, 'touchstart', 20)
    const panelPullAtTop = dispatch(content, 'touchmove', 50)
    dispatch(content, 'touchend', 50)
    return {
      pull,
      push,
      inputMove,
      panelMove,
      panelPullAtTop,
      panelScrollHeight,
      panelClientHeight,
    }
  })
  expect(outcomes.pull).toBe(true)
  expect(outcomes.push).toBe(true)
  expect(outcomes.inputMove).toBe(false)
  expect(outcomes.panelScrollHeight).toBeGreaterThan(outcomes.panelClientHeight)
  expect(outcomes.panelMove).toBe(false)
  expect(outcomes.panelPullAtTop).toBe(true)
})

test('页面根容器禁止滚动，即使内容溢出也不移动', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('访问凭据')).toBeVisible()
  const result = await page.evaluate(() => {
    const overflow = document.createElement('div')
    overflow.style.height = '300vh'
    document.getElementById('root')!.append(overflow)
    window.scrollTo(0, 200)
    const containers = [
      document.documentElement,
      document.body,
      document.getElementById('root')!,
    ]
    const styles = containers.map((node) => ({
      overflow: getComputedStyle(node).overflowY,
      overscroll: getComputedStyle(node).overscrollBehaviorY,
    }))
    const scrollY = window.scrollY
    overflow.remove()
    return { styles, scrollY }
  })
  expect(result.scrollY).toBe(0)
  for (const style of result.styles) {
    expect(style.overflow).toBe('hidden')
    expect(style.overscroll).toBe('none')
  }
})

// Soft keyboards shrink the visual viewport without changing dvh on iPadOS.
for (const platform of ['iPhone', 'iPad'] as const) {
  test(`${platform} 键盘变化后终端底行不被辅助键栏遮挡`, async ({ page }) => {
    await page.setViewportSize({
      width: platform === 'iPad' ? 1024 : 390,
      height: 844,
    })
    await emulateMobileUserAgent(page, platform)
    const sockets = recordSockets(page)
    await page.addInitScript(() => {
      const listeners = new Set<() => void>()
      // Shorter than the browser window: the visual viewport never exceeds it.
      const state = { height: 640, offsetTop: 0 }
      const fake = {
        get height() {
          return state.height
        },
        get offsetTop() {
          return state.offsetTop
        },
        addEventListener: (type: string, listener: () => void) => {
          if (type === 'resize' || type === 'scroll') listeners.add(listener)
        },
        removeEventListener: (_type: string, listener: () => void) => {
          listeners.delete(listener)
        },
      }
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: fake,
      })
      // Reports a new size and notifies, like WebKit does.
      Object.defineProperty(window, '__setViewport', {
        configurable: true,
        value: (height: number, offsetTop = 0) => {
          state.height = height
          state.offsetTop = offsetTop
          for (const listener of listeners) listener()
        },
      })
      // Changes the size silently, like WebKit reporting the keyboard height only
      // after the animation, without another event.
      Object.defineProperty(window, '__settleViewport', {
        configurable: true,
        value: (height: number, offsetTop = 0) => {
          state.height = height
          state.offsetTop = offsetTop
        },
      })
    })

    await openTerminal(page)

    const workspace = page.locator('.workspace')
    const height = () =>
      workspace.evaluate((node) => getComputedStyle(node).height)
    const contentFits = () =>
      page.evaluate(() => {
        const host = document
          .querySelector('.terminal-host')!
          .getBoundingClientRect()
        const screen = document
          .querySelector('.xterm-screen')!
          .getBoundingClientRect()
        const aux = document.querySelector('.aux-bar')!.getBoundingClientRect()
        return (
          screen.top >= host.top &&
          screen.bottom <= host.bottom &&
          screen.bottom <= aux.top
        )
      })
    await expect.poll(height).toBe('640px')
    await expect.poll(contentFits).toBe(true)
    const tall = (await page.locator('.xterm-screen:visible').boundingBox())!
      .height

    // WebKit first reports the height from before the keyboard and only later
    // exposes the real one, without another event. The workspace must still
    // settle above the keyboard instead of hiding rows behind it.
    await page.evaluate(() => {
      window.__setViewport(640, 0)
      window.__settleViewport(400, 60)
    })
    await expect.poll(height, { timeout: 3000 }).toBe('400px')
    await expect
      .poll(() => workspace.evaluate((node) => getComputedStyle(node).top))
      .toBe('60px')
    await expect
      .poll(
        async () =>
          (await page.locator('.xterm-screen:visible').boundingBox())!.height,
      )
      .toBeLessThan(tall)
    await expect.poll(contentFits).toBe(true)
    // The aux bar and the tab bar stay visible above the keyboard area.
    await expect(
      page.getByRole('button', { name: '发送 Ctrl+D' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '新建终端' })).toBeVisible()
    await expect(page.getByRole('tab').nth(0)).toBeVisible()

    // A normal resize event still applies immediately.
    await page.evaluate(() => window.__setViewport(360, 60))
    await expect.poll(height).toBe('360px')
    await expect
      .poll(
        async () =>
          (await page.locator('.xterm-screen:visible').boundingBox())!.height,
      )
      .toBeLessThan(tall)
    await expect.poll(contentFits).toBe(true)

    // Closing the keyboard also settles without a fresh event.
    await page.evaluate(() => window.__settleViewport(640, 0))
    await expect.poll(height, { timeout: 3000 }).toBe('640px')
    await expect
      .poll(
        async () =>
          (await page.locator('.xterm-screen:visible').boundingBox())!.height,
      )
      .toBe(tall)
    await expect.poll(contentFits).toBe(true)
    expect(sockets).toHaveLength(1)
  })
}
