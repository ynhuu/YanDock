import { expect, test, type Page } from '@playwright/test'
import {
  clearSessions,
  emulateMobileUserAgent,
  openTerminal,
  recordFrames,
} from './helpers'

test.use({ hasTouch: true })
test.afterEach(async ({ page }) => clearSessions(page))

async function touch(page: Page, type: string, point = { x: 40, y: 100 }) {
  return page.locator('.terminal-host:visible').evaluate(
    (host, { type, point }) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'touches', {
        value:
          type === 'touchend' ? [] : [{ clientX: point.x, clientY: point.y }],
      })
      host.dispatchEvent(event)
      return event.defaultPrevented
    },
    { type, point },
  )
}

async function hold(page: Page, point?: { x: number; y: number }) {
  await touch(page, 'touchstart', point)
  await page.clock.runFor(500)
  await touch(page, 'touchend', point)
}

test('desktop 即使支持触摸也不启用长按复制粘贴菜单', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const frames = recordFrames(page)
  await openTerminal(page)
  await expect(page.getByLabel('终端辅助键')).toHaveCount(0)
  await page.clock.install()
  await touch(page, 'touchstart')
  await page.clock.runFor(600)
  expect(await touch(page, 'touchend')).toBe(false)
  await expect(page.getByRole('dialog', { name: '复制与粘贴' })).toHaveCount(0)
  expect(
    await page.locator('.terminal-host:visible').evaluate((element) => {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(false)
  await page.locator('.xterm-helper-textarea:visible').focus()
  await page.keyboard.insertText('desktop-input')
  await expect.poll(() => frames.sent).toBe('desktop-input')
})

test('复制只读快照与空白粘贴分离，不依赖剪贴板 API', async ({ page }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('yandock-terminal-font-size', '10')
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
    })
  })
  const frames = recordFrames(page)
  await openTerminal(page)
  await page.getByRole('button', { name: '显示键盘' }).click()
  await page.locator('.xterm-helper-textarea:visible').focus()
  await page.keyboard.insertText('printf "COPY-%s\\n" "SNAPSHOT"')
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('COPY-SNAPSHOT')
  await page.clock.install()
  await touch(page, 'touchstart')
  await touch(page, 'touchend')
  await page.clock.runFor(600)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await hold(page)
  const dialog = page.getByRole('dialog', { name: '复制与粘贴' })
  await dialog.getByRole('button', { name: '复制', exact: true }).click()
  const copy = dialog.getByRole('textbox', { name: '可见终端文本' })
  await expect(copy).toHaveAttribute('readonly', '')
  await expect(copy).toHaveValue(/COPY-SNAPSHOT/)
  await expect(copy).not.toBeFocused()
  await expect(copy).toHaveCSS('font-size', '10px')
  await copy.dispatchEvent('scroll')
  await expect(copy).toBeVisible()
  expect((await copy.boundingBox())!.height).toBeGreaterThan(128)
  await expect(
    dialog.getByRole('button', { name: '发送', exact: true }),
  ).toHaveCount(0)
  await dialog.getByRole('button', { name: '全选' }).click()
  await expect(copy).toHaveCSS('outline-style', 'none')
  await expect(copy).toHaveCSS('box-shadow', 'none')
  expect(
    await copy.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionEnd - element.selectionStart === element.value.length,
    ),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await hold(page)
  await dialog.getByRole('button', { name: '粘贴', exact: true }).click()
  const draft = dialog.getByRole('textbox', { name: '待粘贴文本' })
  const paste = dialog.getByRole('button', { name: '发送', exact: true })
  await expect(draft).toHaveCSS('font-size', '10px')
  await expect(draft).toHaveValue('')
  await expect(draft).not.toBeFocused()
  await expect(paste).toBeDisabled()
  await draft.fill('x'.repeat(65537))
  await paste.click()
  await expect(draft).toHaveValue('x'.repeat(65537))
  await expect(
    page.getByText('粘贴过大或网络拥塞，请分批粘贴；内容已保留'),
  ).toBeVisible()
  const toast = page.locator('.global-toast-anchor .status-toast-warning')
  await expect(toast).toHaveCSS('font-size', '14px')
  await expect(toast).toHaveCSS('pointer-events', 'none')
  await expect(toast.locator('svg')).toHaveCount(1)
  const toastBox = (await toast.boundingBox())!
  expect(toastBox.height).toBeLessThan(56)
  expect(toastBox.x).toBeGreaterThanOrEqual(16)
  expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(374)
  const command = 'printf "SEND-%s\\n" "OK"'
  await draft.fill(command)
  await draft.dispatchEvent('scroll')
  await expect(draft).toHaveValue(command)
  await expect(draft).toHaveCSS('outline-style', 'none')
  await expect(draft).toHaveCSS('box-shadow', 'none')
  const before = frames.sent
  await paste.click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => frames.sent.slice(before.length)).toBe(command + '\r')
  await expect.poll(() => frames.received).toContain('SEND-OK')
  await hold(page)
  await dialog.getByRole('button', { name: '粘贴', exact: true }).click()
  await draft.fill('do-not-send\n')
  await expect(dialog.getByRole('status')).toContainText('可能执行命令')
  await dialog.getByRole('button', { name: '取消' }).click()
  expect(frames.sent).not.toContain('do-not-send')
})

test('发送的回车在 bracketed paste 结束标记之后', async ({ page }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  const frames = recordFrames(page)
  await openTerminal(page)
  await page.getByRole('button', { name: '显示键盘' }).click()
  await page.locator('.xterm-helper-textarea:visible').focus()
  await page.keyboard.insertText("printf '\\033[?2004h'")
  await page.keyboard.press('Enter')
  await expect.poll(() => frames.received).toContain('\x1b[?2004h')
  await page.clock.install()
  await hold(page)
  const dialog = page.getByRole('dialog', { name: '复制与粘贴' })
  await dialog.getByRole('button', { name: '粘贴', exact: true }).click()
  await dialog.getByRole('textbox').fill('中文-probe')
  const before = frames.sent
  await dialog.getByRole('button', { name: '发送', exact: true }).click()
  await expect
    .poll(() => frames.sent.slice(before.length))
    .toBe('\x1b[200~中文-probe\x1b[201~\r')
})

test('单字符面板发送不受粘滞 Ctrl 影响且只发送一次', async ({ page }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  const frames = recordFrames(page)
  await openTerminal(page)
  const ctrl = page.getByRole('button', { name: 'Ctrl 组合键' })
  await ctrl.click()
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true')
  await page.clock.install()
  await hold(page)
  const dialog = page.getByRole('dialog', { name: '复制与粘贴' })
  await dialog.getByRole('button', { name: '粘贴', exact: true }).click()
  await dialog.getByRole('textbox').fill('x')
  await dialog.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => frames.sent).toBe('x\r')
  await expect(dialog).toHaveCount(0)
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true')
})

test('悬浮菜单只有复制粘贴，边缘避让、外点及滚动关闭，终端屏蔽原生菜单', async ({
  page,
}) => {
  await emulateMobileUserAgent(page, 'iPhone')
  await page.setViewportSize({ width: 390, height: 844 })
  await openTerminal(page)
  const suppressed = await page
    .locator('.xterm-helper-textarea:visible')
    .evaluate((element) => {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      })
      element.dispatchEvent(event)
      return event.defaultPrevented
    })
  expect(suppressed).toBe(true)
  await page.clock.install()
  const host = (await page.locator('.terminal-host:visible').boundingBox())!
  const dialog = page.getByRole('dialog', { name: '复制与粘贴' })
  for (const point of [
    { x: host.x + 2, y: host.y + 2 },
    { x: host.x + host.width - 2, y: host.y + host.height - 2 },
  ]) {
    await hold(page, point)
    await expect(dialog.getByRole('button')).toHaveText(['复制', '粘贴'])
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.y).toBeGreaterThanOrEqual(host.y)
    expect(box.y + box.height).toBeLessThanOrEqual(host.y + host.height)
    expect(box.height).toBeLessThan(60)
    await page.getByRole('button', { name: '更多操作' }).tap()
    await expect(dialog).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  await hold(page)
  await page
    .locator('.terminal-host:visible')
    .dispatchEvent('wheel', { deltaY: 20 })
  await expect(dialog).toHaveCount(0)
  await hold(page)
  await dialog.getByRole('button', { name: '粘贴', exact: true }).click()
  const textarea = dialog.getByRole('textbox')
  await textarea.tap()
  await expect(dialog).toBeVisible()
  expect(
    await textarea.evaluate((element) => {
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(false)
  await textarea.fill('discard-on-outside')
  await page.getByRole('button', { name: '新建终端' }).tap()
  await expect(dialog).toHaveCount(0)
})
