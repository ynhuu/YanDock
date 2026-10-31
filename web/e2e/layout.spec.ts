import { expect, test, type Page } from '@playwright/test'
import packageInfo from '../package.json' with { type: 'json' }
import {
  clearSessions,
  emulateMobileUserAgent,
  login,
  openTerminal,
  recordSockets,
} from './helpers'

// Headless Chromium reports screen.height equal to the viewport. Model browser
// chrome by adding space, then let individual tests change it for fullscreen.
async function emulateBrowserChrome(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(screen, 'height', {
      configurable: true,
      writable: true,
      value: window.innerHeight + 80,
    })
  })
}

test.afterEach(async ({ page }) => {
  await clearSessions(page)
})

for (const width of [320, 1280]) {
  test(`设置底部显示小号版本且不参与键盘导航（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await login(page)
    await page.getByRole('button', { name: '更多操作' }).click()
    const menu = page.getByRole('menu')
    const footer = menu.locator(':scope > :last-child')
    await expect(footer).toHaveText(`版本 v${packageInfo.version}`)
    await expect(footer).toBeVisible()
    await expect(footer).toHaveCSS('font-size', '10px')
    await expect(footer).toHaveCSS('text-align', 'right')
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeFocused()
  })
}

test('按钮聚焦没有外框，键盘导航和菜单焦点恢复仍可用', async ({ page }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  await page.goto('/')
  await expect(page.getByLabel('访问凭据')).toBeVisible()
  await page.keyboard.press('Tab')
  const submit = page.getByRole('button', { name: '登录工作台' })
  await submit.focus()
  await expect(submit).toHaveCSS('outline-style', 'none')
  await expect(submit).toHaveCSS('text-decoration-line', 'underline')
  await openTerminal(page)
  await page.keyboard.press('Tab')
  for (const button of await page.locator('button:visible').all()) {
    await button.focus()
    await expect(button).toHaveCSS('outline-style', 'none')
  }
  const more = page.getByRole('button', { name: '更多操作' })
  await more.click()
  await expect(page.getByRole('menuitem', { name: /^主题：/ })).toBeFocused()
  for (const item of await page.getByRole('menuitem').all()) {
    await item.focus()
    await expect(item).toHaveCSS('outline-style', 'none')
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(more).toBeFocused()
})

test('会话栏不显示浏览器全屏按钮', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('button', { name: /全屏/ })).toHaveCount(0)
})

for (const platform of ['Android', 'iPhone', '桌面'] as const) {
  test(`${platform} 全屏时${platform === 'Android' ? '显示' : '不显示'}系统时间`, async ({
    page,
  }) => {
    if (platform !== '桌面') await emulateMobileUserAgent(page, platform)
    await emulateBrowserChrome(page)
    await login(page)
    const clock = page.locator('.workspace-clock')
    await expect(clock).toHaveCount(0)
    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: document.documentElement,
      })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    if (platform !== 'Android') {
      await expect(clock).toHaveCount(0)
      return
    }
    await expect(clock).toBeVisible()
    const time = await clock.textContent()
    expect(time).toMatch(/^\d{2}:\d{2}$/)
    await expect(clock).toHaveAttribute('datetime', time!)
    const clockBounds = (await clock.boundingBox())!
    const headerBounds = (await page
      .locator('.workspace-header')
      .boundingBox())!
    expect(
      Math.abs(
        headerBounds.x +
          headerBounds.width -
          12 -
          clockBounds.x -
          clockBounds.width,
      ),
    ).toBeLessThanOrEqual(1)

    await page.evaluate(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: null,
      })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    await expect(clock).toHaveCount(0)
  })
}

test('Android 外壳隐藏系统栏时显示系统时间', async ({ page }) => {
  await emulateMobileUserAgent(page, 'Android')
  await emulateBrowserChrome(page)
  await login(page)
  const clock = page.locator('.workspace-clock')
  await expect(clock).toHaveCount(0)
  await page.evaluate(() => {
    screen.height = window.innerHeight
    window.dispatchEvent(new Event('resize'))
  })
  await expect(clock).toBeVisible()
  await page.evaluate(() => {
    screen.height = window.innerHeight + 80
    window.dispatchEvent(new Event('resize'))
  })
  await expect(clock).toHaveCount(0)
})

test('菜单栏项目按钮位于更多操作左侧并打开 Git 与文件抽屉', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 900 })
  await login(page)
  const trigger = page.getByRole('button', { name: '打开项目面板' })
  const triggerBounds = (await trigger.boundingBox())!
  const moreBounds = (await page
    .getByRole('button', { name: '更多操作' })
    .boundingBox())!
  expect(
    Math.abs(triggerBounds.x + triggerBounds.width - moreBounds.x),
  ).toBeLessThanOrEqual(1)
  expect(Math.abs(triggerBounds.y - moreBounds.y)).toBeLessThanOrEqual(1)
  const iconPath = await trigger.locator('svg path').getAttribute('d')
  expect(iconPath).toBe('m15 18-6-6 6-6')
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('.project-drawer-header')).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(trigger.locator('svg path')).toHaveAttribute('d', iconPath!)
  expect(
    (await drawer.locator('.project-drawer-nav').boundingBox())?.height,
  ).toBe(45)
  await expect(
    drawer.getByRole('button', { name: '关闭项目面板' }).locator('svg path'),
  ).toHaveAttribute('d', 'm9 18 6-6-6-6')
  await expect(drawer.getByRole('tab', { name: 'Git' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await drawer.getByRole('tab', { name: '文件' }).click()
  await expect(drawer.getByRole('tab', { name: '文件' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(drawer.getByText('README.md')).toBeVisible()
  const readmeEntry = drawer
    .locator('.project-entry')
    .filter({ hasText: 'README.md' })
  await expect(
    readmeEntry.locator('[data-component="file-icon"]'),
  ).toHaveAttribute('data-icon-name', 'Readme')
  const spriteHref = await readmeEntry.locator('use').getAttribute('href')
  expect(spriteHref).toBeTruthy()
  const iconSprite = await page.request.get(spriteHref!.split('#')[0])
  expect(iconSprite.ok()).toBe(true)
  expect(await iconSprite.text()).toContain('id="Readme"')
  await expect(drawer).toHaveCSS('opacity', '1')
  const fileName = drawer.locator('.project-entry-name').first()
  await expect(fileName).toHaveCSS('font-size', '14px')
  expect(
    await fileName.evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain('Inter')
  await expect(drawer.locator('.project-file-size').first()).toHaveCSS(
    'font-size',
    '13px',
  )
  await page.route('**/api/project/file*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: [
        '# Preview README',
        '',
        'This is **formatted** Markdown.',
        '',
        '<script>window.__unsafePreviewExecuted = true</script>',
      ].join('\n'),
    }),
  )
  await drawer
    .locator('.project-entry')
    .filter({ hasText: 'README.md' })
    .click()
  const markdownPreview = drawer.locator('.project-markdown-preview')
  await expect(markdownPreview.getByRole('heading', { level: 1 })).toHaveText(
    'Preview README',
  )
  const markdownTypography = await markdownPreview.evaluate((element) => ({
    family: getComputedStyle(element).fontFamily,
    size: getComputedStyle(element).fontSize,
    headingSize: getComputedStyle(element.querySelector('h1')!).fontSize,
  }))
  expect(markdownTypography.family).toContain('Inter')
  expect(markdownTypography.size).toBe('14px')
  expect(markdownTypography.headingSize).toBe('17px')
  await expect(markdownPreview.locator('strong')).toHaveText('formatted')
  await expect(markdownPreview.locator('script')).toHaveCount(0)
  expect(
    await page.evaluate(() => Reflect.get(window, '__unsafePreviewExecuted')),
  ).toBeUndefined()
  const downloadButton = drawer.getByRole('button', { name: '下载' })
  await downloadButton.hover()
  await expect(downloadButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const download = page.waitForEvent('download')
  await downloadButton.click()
  expect((await download).suggestedFilename()).toBe('README.md')
  await page.keyboard.press('Escape')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: '关闭项目面板' }).click()
  await expect(drawer).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('快速切换文件预览时忽略较早返回的内容', async ({ page }) => {
  await login(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        files: [
          { name: 'slow.md', path: 'slow.md', isDir: false, size: 16 },
          { name: 'fast.md', path: 'fast.md', isDir: false, size: 16 },
        ],
        truncated: false,
      }),
    }),
  )

  let releaseSlowRequest!: () => void
  const slowRequest = new Promise<void>((resolve) => {
    releaseSlowRequest = resolve
  })
  let announceSlowRequest!: () => void
  const slowRequestStarted = new Promise<void>((resolve) => {
    announceSlowRequest = resolve
  })
  let announceSlowResponse!: () => void
  const slowResponseFinished = new Promise<void>((resolve) => {
    announceSlowResponse = resolve
  })
  await page.route(/\/api\/project\/file\?/, async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path')
    if (path === 'slow.md') {
      announceSlowRequest()
      await slowRequest
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: '# 较早的预览',
      })
      announceSlowResponse()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: '# 当前预览',
    })
  })

  try {
    await page.getByRole('button', { name: '打开项目面板' }).click()
    const drawer = page.getByRole('dialog', { name: '项目面板' })
    await drawer.getByRole('tab', { name: '文件' }).click()
    await drawer
      .locator('.project-entry')
      .filter({ hasText: 'slow.md' })
      .click()
    await slowRequestStarted
    await drawer.getByRole('button', { name: '文件列表' }).click()
    await drawer
      .locator('.project-entry')
      .filter({ hasText: 'fast.md' })
      .click()
    await expect(drawer.locator('.project-preview-heading code')).toHaveText(
      'fast.md',
    )
    await expect(drawer.locator('.project-markdown-preview h1')).toHaveText(
      '当前预览',
    )

    releaseSlowRequest()
    await slowResponseFinished
    await expect(drawer.locator('.project-preview-heading code')).toHaveText(
      'fast.md',
    )
    await expect(drawer.locator('.project-markdown-preview h1')).toHaveText(
      '当前预览',
    )
  } finally {
    releaseSlowRequest()
  }
})

test('Git 更改列表可原位展开差异并显示新增和删除行数', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 })
  await emulateMobileUserAgent(page, 'iPhone')
  await login(page)
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        files: [
          {
            path: 'web/src/example.ts',
            status: ' M',
            label: '修改',
            additions: 1,
            deletions: 1,
          },
          {
            path: 'web/src/second.ts',
            status: ' M',
            label: '修改',
            additions: 2,
            deletions: 0,
          },
        ],
        additions: 3,
        deletions: 1,
        truncated: false,
      }),
    }),
  )
  const contextBefore = Array.from(
    { length: 10 },
    (_, index) => `context ${index + 1}`,
  )
  const contextAfter = Array.from(
    { length: 9 },
    (_, index) => `context ${index + 12}`,
  )
  const oldContent = [
    ...contextBefore,
    'const value = 1',
    ...contextAfter,
  ].join('\n')
  const newContent = [
    ...contextBefore,
    'const value = 2',
    ...contextAfter,
  ].join('\n')
  await page.route('**/api/project/diff*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        patch: [
          'diff --git a/web/src/example.ts b/web/src/example.ts',
          'index 1111111..2222222 100644',
          '--- a/web/src/example.ts',
          '+++ b/web/src/example.ts',
          '@@ -1,20 +1,20 @@',
          ...contextBefore.map((line) => ` ${line}`),
          '-const value = 1',
          '+const value = 2',
          ...contextAfter.map((line) => ` ${line}`),
        ].join('\n'),
        oldContent,
        newContent,
        complete: true,
      }),
    }),
  )
  await page.route('**/api/project/file*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: `const value = 2\nconst longText = "${'x'.repeat(200)}"`,
    }),
  )

  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await drawer.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    )
  })
  const drawerBounds = await drawer.evaluate((element) => {
    const { top, left, width, height } = element.getBoundingClientRect()
    return { top, left, width, height }
  })
  expect(drawerBounds).toEqual({ top: 0, left: 0, width: 412, height: 900 })
  await expect(
    drawer.getByRole('button', { name: '关闭项目面板' }),
  ).toBeVisible()
  await expect(drawer.getByRole('button', { name: '全部收起' })).toHaveCount(0)
  const changes = drawer.locator('.project-change-trigger')
  const change = changes.nth(0)
  const secondChange = changes.nth(1)
  await expect(change).toContainText('example.ts')
  await expect(change.locator('[data-component="file-icon"]')).toHaveAttribute(
    'data-icon-name',
    'Typescript',
  )
  await expect(change).toContainText('web/src/')
  await expect(drawer.locator('.project-review-selector-button')).toHaveCSS(
    'font-size',
    '12.8px',
  )
  await expect(drawer.locator('.project-change-name').first()).toHaveCSS(
    'font-size',
    '13px',
  )
  expect(
    await change
      .locator('.project-change-name')
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain('Inter')
  const pathGap = await change
    .locator('.project-change-path')
    .evaluate((path) => {
      const separator = path.querySelector('.project-change-separator')
      const name = path.querySelector('.project-change-name')
      if (!separator || !name) return Number.NaN
      return Math.abs(
        name.getBoundingClientRect().left -
          separator.getBoundingClientRect().right,
      )
    })
  expect(pathGap).toBeLessThanOrEqual(1)
  await expect(drawer.locator('.project-review-total')).toContainText('+3')
  await expect(drawer.locator('.project-review-total')).toContainText('−1')
  await change.click()
  await expect(change).toHaveAttribute('aria-expanded', 'true')
  const diff = drawer.locator('.project-review-diff')
  const diffPreview = diff.locator('diffs-container')
  await expect(diffPreview).toBeVisible()
  await expect
    .poll(() =>
      diffPreview.evaluate((element) => {
        const content = element.shadowRoot?.textContent ?? ''
        return (
          content.includes('const value = 2') &&
          content.includes('const value = 1')
        )
      }),
    )
    .toBe(true)
  const diffTypography = await diffPreview.evaluate((element) => {
    const code = element.shadowRoot?.querySelector('pre[data-overflow="wrap"]')
    return code
      ? {
          family: getComputedStyle(code).fontFamily,
          size: getComputedStyle(code).fontSize,
        }
      : { family: '', size: '' }
  })
  expect(diffTypography.family).toContain('IBM Plex Mono')
  expect(diffTypography.size).toBe('13px')
  await expect
    .poll(() =>
      diffPreview.evaluate(
        (element) =>
          Array.from(
            element.shadowRoot?.querySelectorAll('[data-expand-button]') ?? [],
          ).filter((button) => button.getBoundingClientRect().width > 0).length,
      ),
    )
    .toBe(2)
  await expect
    .poll(() =>
      diffPreview.evaluate((element) =>
        element.shadowRoot?.textContent?.includes('unmodified lines'),
      ),
    )
    .toBe(true)
  await expect
    .poll(() =>
      diffPreview.evaluate(
        (element) =>
          element.shadowRoot?.querySelectorAll(
            'pre[data-overflow="wrap"] [data-line] span[style]',
          ).length ?? 0,
      ),
    )
    .toBeGreaterThan(0)
  await diffPreview.locator('[data-expand-button]:visible').first().click()
  await expect
    .poll(() =>
      diffPreview.evaluate((element) =>
        element.shadowRoot?.textContent?.includes('context 1'),
      ),
    )
    .toBe(true)
  const fileToolbar = drawer.locator('.project-review-file-toolbar').first()
  await expect(fileToolbar.locator('.project-diff-stats')).toContainText('+1')
  await expect(fileToolbar.locator('.project-diff-stats')).toContainText('−1')
  await expect(
    fileToolbar.getByRole('button', { name: '打开文件' }),
  ).toBeVisible()
  await secondChange.click()
  await expect(secondChange).toHaveAttribute('aria-expanded', 'true')
  await expect(change).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer.locator('.project-review-diff')).toHaveCount(2)
  await fileToolbar.getByRole('button', { name: '打开文件' }).click()
  await expect(drawer.getByRole('tab', { name: '文件' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const sourcePreview = drawer.locator('diffs-container')
  await expect(sourcePreview).toBeVisible()
  await expect
    .poll(() =>
      sourcePreview.evaluate(
        (element) =>
          element.shadowRoot?.textContent?.includes('const value = 2') ?? false,
      ),
    )
    .toBe(true)
  await expect
    .poll(() =>
      sourcePreview.evaluate((element) => {
        const line = element.shadowRoot
          ?.querySelector('pre[data-overflow="wrap"]')
          ?.querySelector('[data-line]')
        return line ? getComputedStyle(line).whiteSpace : ''
      }),
    )
    .toBe('pre-wrap')
  const sourceTypography = await sourcePreview.evaluate((element) => {
    const code = element.shadowRoot?.querySelector('pre[data-overflow="wrap"]')
    return code
      ? {
          family: getComputedStyle(code).fontFamily,
          size: getComputedStyle(code).fontSize,
        }
      : { family: '', size: '' }
  })
  expect(sourceTypography.family).toContain('IBM Plex Mono')
  expect(sourceTypography.size).toBe('13px')
  await expect
    .poll(() =>
      sourcePreview.evaluate((element) => {
        const code = element.shadowRoot?.querySelector(
          'pre[data-overflow="wrap"]',
        )
        return code?.getAttribute('data-overflow') ?? ''
      }),
    )
    .toBe('wrap')
  await expect
    .poll(() =>
      sourcePreview.evaluate(
        (element) =>
          element.shadowRoot?.querySelectorAll('[data-column-number]').length ??
          0,
      ),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      sourcePreview.evaluate(
        (element) =>
          element.shadowRoot?.querySelectorAll(
            'pre[data-overflow="wrap"] [data-line] span[style]',
          ).length ?? 0,
      ),
    )
    .toBeGreaterThan(0)
})

test('窄屏项目面板的 Git 和文件列表支持触摸滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await emulateMobileUserAgent(page, 'iPhone')
  await login(page)
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        files: Array.from({ length: 60 }, (_, index) => ({
          path: `web/src/example-${index}.ts`,
          status: ' M',
          label: '修改',
          additions: 1,
          deletions: 0,
        })),
        additions: 60,
        deletions: 0,
        truncated: false,
      }),
    }),
  )
  await page.route('**/api/project/files*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path')
    const files =
      path === 'src'
        ? Array.from({ length: 60 }, (_, index) => ({
            name: `example-${index}.ts`,
            path: `src/example-${index}.ts`,
            isDir: false,
            size: 128,
          }))
        : [
            { name: 'src', path: 'src', isDir: true, size: 0 },
            ...Array.from({ length: 60 }, (_, index) => ({
              name: `root-${index}.ts`,
              path: `root-${index}.ts`,
              isDir: false,
              size: 128,
            })),
          ]
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ files, truncated: false }),
    })
  })

  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  const changes = drawer.locator('.project-review-list')
  await expect(drawer.locator('.project-change-trigger')).toHaveCount(60)
  const changesCanScroll = await changes.evaluate(
    (element) => element.scrollHeight > element.clientHeight,
  )
  expect(changesCanScroll).toBe(true)
  const changeSwipePrevented = await drawer.evaluate((element) => {
    const row = element.querySelector('.project-change-trigger')!
    const start = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(start, 'touches', {
      value: [{ clientY: 100 }],
    })
    row.dispatchEvent(start)
    const move = new Event('touchmove', { bubbles: true, cancelable: true })
    Object.defineProperty(move, 'touches', {
      value: [{ clientY: 40 }],
    })
    row.dispatchEvent(move)
    row.dispatchEvent(new Event('touchend', { bubbles: true }))
    return move.defaultPrevented
  })
  expect(changeSwipePrevented).toBe(false)

  await drawer.getByRole('tab', { name: '文件' }).click()
  const files = drawer.locator('.project-entry-list').last()
  await expect(drawer.locator('.project-file-row')).toHaveCount(61)
  const filesCanScroll = await files.evaluate(
    (element) => element.scrollHeight > element.clientHeight,
  )
  expect(filesCanScroll).toBe(true)
  const fileSwipePrevented = await drawer.evaluate((element) => {
    const row = element.querySelector('.project-entry')!
    const start = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.defineProperty(start, 'touches', {
      value: [{ clientY: 100 }],
    })
    row.dispatchEvent(start)
    const move = new Event('touchmove', { bubbles: true, cancelable: true })
    Object.defineProperty(move, 'touches', {
      value: [{ clientY: 40 }],
    })
    row.dispatchEvent(move)
    row.dispatchEvent(new Event('touchend', { bubbles: true }))
    return move.defaultPrevented
  })
  expect(fileSwipePrevented).toBe(false)
  const srcEntry = drawer
    .locator('.project-file-row[data-depth="0"]')
    .filter({ hasText: 'src' })
    .getByRole('button')
  await srcEntry.click()
  await expect(srcEntry).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer.locator('.project-file-row[data-depth="1"]')).toHaveCount(
    60,
  )
})

test('非 Git 目录删除文件后刷新不在文件页提示 Git 错误', async ({ page }) => {
  await login(page)
  let deleted = false
  let changesRequests = 0
  await page.route('**/api/project/changes*', async (route) => {
    changesRequests++
    await route.fulfill({ status: 409, body: '无法读取 Git 更改' })
  })
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: deleted
          ? []
          : [{ name: 'remove.txt', path: 'remove.txt', isDir: false, size: 1 }],
        truncated: false,
      },
    }),
  )
  await page.route('**/api/project/file?*', (route) => {
    expect(route.request().method()).toBe('DELETE')
    deleted = true
    return route.fulfill({ status: 204 })
  })
  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await expect(drawer.getByRole('alert')).toHaveText('无法读取 Git 更改')
  await drawer.getByRole('tab', { name: '文件' }).click()
  await expect(drawer.getByRole('alert')).toHaveCount(0)
  const requestsBeforeDelete = changesRequests
  await drawer.locator('.project-entry').click({ button: 'right' })
  page.once('dialog', (dialog) => void dialog.accept())
  await drawer.getByRole('menuitem', { name: '删除' }).click()
  await expect(drawer.getByText('此目录为空')).toBeVisible()
  await expect.poll(() => changesRequests).toBeGreaterThan(requestsBeforeDelete)
  await drawer.getByRole('button', { name: '刷新文件树' }).click()
  await expect(drawer.getByRole('button', { name: '刷新文件树' })).toBeEnabled()
  await expect(drawer.getByRole('alert')).toHaveCount(0)
  await drawer.getByRole('tab', { name: 'Git' }).click()
  await expect(drawer.getByRole('alert')).toHaveText('无法读取 Git 更改')
})

test('项目面板跟随当前终端执行 cd 后的目录', async ({ page }) => {
  await openTerminal(page)
  const trigger = page.getByRole('button', { name: '打开项目面板' })
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await drawer.getByRole('tab', { name: '文件' }).click()
  await expect(drawer.getByText('README.md')).toBeVisible()
  const uploadButton = drawer.getByRole('button', {
    name: '上传文件',
    exact: true,
  })
  await expect(uploadButton).toHaveCSS('height', '40px')
  await drawer.locator('.project-entry').filter({ hasText: 'web' }).click()
  await expect(drawer.getByText('package.json')).toBeVisible()
  await expect(
    drawer
      .locator('.project-file-row[data-depth="1"]')
      .filter({ hasText: 'package.json' }),
  ).toBeVisible()

  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText('cd web')
  await page.keyboard.press('Enter')
  await expect(
    drawer.locator('.project-breadcrumbs button').first(),
  ).toHaveText('web', { timeout: 5000 })
  await expect(drawer.getByText('package.json')).toBeVisible()
  await expect(drawer.locator('.project-breadcrumbs button')).toHaveCount(1)
  await expect(drawer.getByRole('alert')).toHaveCount(0)

  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText('cd ../docs')
  await page.keyboard.press('Enter')
  await expect(
    drawer.locator('.project-breadcrumbs button').first(),
  ).toHaveText('docs', { timeout: 5000 })
  await expect(drawer.getByText('技术方案.md', { exact: true })).toBeVisible()
  await expect(drawer.locator('.project-breadcrumbs button')).toHaveCount(1)
  await expect(drawer.getByRole('alert')).toHaveCount(0)
})

test('终端目录读取恢复后清除旧错误提示', async ({ page }) => {
  await openTerminal(page)
  let firstRequest = true
  await page.route(/\/api\/session\/[^/]+\/cwd$/, async (route) => {
    if (firstRequest) {
      firstRequest = false
      await route.fulfill({
        status: 503,
        contentType: 'text/plain; charset=utf-8',
        body: '无法读取终端当前目录',
      })
    } else {
      await route.continue()
    }
  })

  await page.getByRole('button', { name: '打开项目面板' }).click()
  const alert = page
    .getByRole('dialog', { name: '项目面板' })
    .getByRole('alert')
  await expect(alert).toHaveText('无法读取终端当前目录')
  await expect(alert).toHaveCount(0, { timeout: 5000 })
})

test('手机布局提供状态栏、底部会话切换与触控操作面板', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await emulateMobileUserAgent(page, 'iPhone')
  await login(page)
  await clearSessions(page)
  await page.reload()
  await page.getByRole('button', { name: '创建第一个终端' }).click()
  await expect(page.locator('[role="status"].sr-only')).toContainText('已连接')
  const sockets = recordSockets(page)
  const tabs = page.getByRole('tab')
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '新建终端' }).click()
    // Wait for the new tab, not the previous terminal's still-live status.
    await expect(tabs).toHaveCount(i + 2)
    await expect(page.locator('[role="status"].sr-only')).toContainText(
      '已连接',
    )
  }
  await tabs.first().click()
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.first()).toHaveText(/^终端 \d+已连接$/)
  await expect(page.locator('.header-session')).toHaveText(/^终端 \d+$/)
  expect(sockets).toHaveLength(3)
  const geometry = await page.evaluate(() => {
    const header = document
      .querySelector('.workspace-header')!
      .getBoundingClientRect()
    const terminal = document
      .querySelector('.terminal-host:not([hidden])')!
      .getBoundingClientRect()
    const dock = document.querySelector('.tab-bar')!.getBoundingClientRect()
    return {
      headerBottom: header.bottom,
      headerHeight: header.height,
      terminalTop: terminal.top,
      dockBottom: dock.bottom,
      dockHeight: dock.height,
      width: document.documentElement.scrollWidth,
    }
  })
  expect(geometry.headerBottom).toBeLessThanOrEqual(geometry.terminalTop)
  expect(geometry.dockBottom).toBeLessThanOrEqual(640)
  expect(geometry.width).toBe(320)
  expect(geometry.headerHeight).toBeLessThanOrEqual(40)
  expect(geometry.dockHeight).toBeLessThanOrEqual(45)
  const aux = page.locator('.aux-bar:visible')
  const auxBounds = (await aux.boundingBox())!
  expect(auxBounds.height).toBeLessThanOrEqual(45)
  const projectTriggerBounds = (await page
    .getByRole('button', { name: '打开项目面板' })
    .boundingBox())!
  const moreBounds = (await page
    .getByRole('button', { name: '更多操作' })
    .boundingBox())!
  expect(
    Math.abs(
      projectTriggerBounds.x + projectTriggerBounds.width - moreBounds.x,
    ),
  ).toBeLessThanOrEqual(1)
  const targets = await aux.getByRole('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const { width, height } = button.getBoundingClientRect()
      return width >= 44 && height >= 44
    }),
  )
  expect(targets.every(Boolean)).toBe(true)
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      colorScheme,
    )
    await page.screenshot({
      path: testInfo.outputPath(`mobile-toolbar-${colorScheme}.png`),
    })
  }
  await page.getByRole('button', { name: '更多操作' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const themeButton = page.getByRole('menuitem', { name: /^主题：/ })
  await expect(themeButton).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('menuitem', { name: '减小字体' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('menuitem', { name: '增大字体' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('menuitem', { name: '关闭当前终端' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('menuitem', { name: '退出登录' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(themeButton).toBeFocused()
  for (const button of await menu.getByRole('menuitem').all()) {
    const height = (await button.boundingBox())!.height
    expect(height).toBeGreaterThanOrEqual(44)
    expect(height).toBeLessThanOrEqual(44)
  }
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('关闭终端时显示 loading，失败提示位于底部辅助键栏上方', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await emulateMobileUserAgent(page, 'iPhone')
  await openTerminal(page)
  let finishResponse!: () => void
  const responseGate = new Promise<void>((resolve) => {
    finishResponse = resolve
  })
  const failDelete = async (route: import('@playwright/test').Route) => {
    if (route.request().method() === 'DELETE') {
      await responseGate
      await route.fulfill({ status: 500, body: '测试关闭失败' })
      return
    }
    await route.continue()
  }
  await page.route('**/api/session/*', failDelete)
  try {
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '关闭当前终端' }).click()
    await expect(page.locator('.tab .tab-dot-closing')).toHaveCount(0)
    await expect(page.locator('[role="status"].sr-only')).toContainText(
      '正在关闭',
    )
    const overlay = page.locator('.global-toast-anchor .status-toast-info')
    await expect(overlay).toContainText('正在关闭终端…')
    await expect(overlay).toBeVisible()
    const overlayBox = (await overlay.boundingBox())!
    const auxBox = (await page.locator('.aux-bar:visible').boundingBox())!
    expect(overlayBox.y).toBeGreaterThan(400)
    expect(overlayBox.y + overlayBox.height).toBeLessThanOrEqual(auxBox.y)
    finishResponse()
    const alert = page.getByRole('alert')
    await expect(alert).toHaveText('测试关闭失败')
    const alertBox = (await alert.boundingBox())!
    expect(alertBox.y).toBeGreaterThan(400)
    expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(auxBox.y)
  } finally {
    finishResponse()
    await page.unroute('**/api/session/*', failDelete)
  }
})
