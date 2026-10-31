import { expect, type Page } from '@playwright/test'

// Public, test-only fixture. Never use this credential in a deployment.
export const TOKEN = 'test-only-yandock-credential-00000000'

export async function emulateMobileUserAgent(
  page: Page,
  platform: 'Android' | 'iPhone' | 'iPad',
) {
  const userAgent =
    platform === 'Android'
      ? 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
      : platform === 'iPad'
        ? 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  await page.addInitScript((agent) => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: agent,
    })
  }, userAgent)
}

export async function login(page: Page) {
  await page.goto('/')
  const field = page.getByLabel('访问凭据')
  const create = page.getByRole('button', { name: '新建终端' })
  // Auth is asynchronous: wait until the loading page chooses a screen.
  await expect(field.or(create)).toBeVisible()
  // A second page of the same context reuses the login cookie.
  if (await field.isVisible()) {
    await field.fill(TOKEN)
    await page.getByRole('button', { name: '登录工作台' }).click()
  }
  await expect(create).toBeVisible()
}

// Sessions deliberately outlive browser connections, so each test starts from
// an empty tab bar instead of inheriting the previous test's terminals.
export async function clearSessions(page: Page) {
  try {
    await page.evaluate(async () => {
      const response = await fetch('/api/sessions')
      const sessions = (await response.json()) as { id: string }[]
      for (const session of sessions)
        await fetch(`/api/session/${session.id}`, { method: 'DELETE' })
    })
  } catch {
    // The page is already gone; the afterEach cleanup is best effort.
  }
}

export async function openTerminal(page: Page) {
  await login(page)
  await clearSessions(page)
  await page.getByRole('button', { name: '新建终端' }).click()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  await expect(page.locator('.xterm-screen:visible')).toBeVisible()
}

// Terminal WebSocket URLs in open order, one per connection attempt.
export function recordSockets(page: Page) {
  const opened: string[] = []
  page.on('websocket', (socket) => opened.push(socket.url()))
  return opened
}

export function recordFrames(page: Page) {
  const decoder = new TextDecoder()
  const state = { sent: '', received: '' }
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') state.sent += decoder.decode(payload)
    })
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') state.received += decoder.decode(payload)
    })
  })
  return state
}
