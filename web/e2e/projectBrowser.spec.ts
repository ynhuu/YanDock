import { expect, test, type Page } from '@playwright/test'
import { clearSessions, emulateMobileUserAgent, openTerminal } from './helpers'

const emptyChanges = {
  files: [],
  truncated: false,
  additions: 0,
  deletions: 0,
  statsComplete: true,
}

async function mockChanges(page: Page) {
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({ json: emptyChanges }),
  )
}

async function openFiles(page: Page) {
  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await drawer.getByRole('tab', { name: '文件', exact: true }).click()
  return drawer
}

test.afterEach(async ({ page }) => {
  await clearSessions(page)
})

test('图片预览隔离 SVG 脚本与外部资源，返回后释放 URL', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [
          { name: 'image.svg', path: 'image.svg', isDir: false, size: 200 },
        ],
        truncated: false,
      },
    }),
  )
  await page.route('**/api/project/file?*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('image')).toBe('1')
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><script>window.parent.imageScriptRan=true</script><image href="https://image-preview.invalid/external.png"/><rect width="100" height="80" fill="red"/></svg>',
    })
  })
  let externalRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('image-preview.invalid')) externalRequests++
  })
  const drawer = await openFiles(page)
  await drawer.getByRole('button', { name: /image.svg/ }).click()
  const image = drawer.getByRole('img', { name: 'image.svg' })
  await expect(image).toBeVisible()
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(100)
  const url = await image.getAttribute('src')
  expect(await page.evaluate(() => 'imageScriptRan' in window)).toBe(false)
  expect(externalRequests).toBe(0)
  await drawer.getByRole('button', { name: '文件列表', exact: true }).click()
  await expect(image).toHaveCount(0)
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url!)
        return false
      } catch {
        return true
      }
    }, url),
  ).toBe(true)
})

test('移动端代码预览允许选择和复制文字', async ({ page }) => {
  await emulateMobileUserAgent(page, 'iPhone')
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [{ name: 'file.ts', path: 'file.ts', isDir: false, size: 20 }],
        truncated: false,
      },
    }),
  )
  await page.route('**/api/project/file?*', (route) =>
    route.fulfill({ body: 'const value = 1\nconst other = 2\n' }),
  )

  const drawer = await openFiles(page)
  await drawer.getByRole('button', { name: /file.ts/ }).click()
  await expect
    .poll(() =>
      drawer.locator('diffs-container').evaluate((element) => {
        const pre = element.shadowRoot?.querySelector('pre')
        return (
          getComputedStyle(element).userSelect === 'text' &&
          (pre ? getComputedStyle(pre).userSelect === 'text' : false)
        )
      }),
    )
    .toBe(true)
})

test('超过预览大小限制仍打开预览页且不弹出错误提示', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [
          { name: 'large.txt', path: 'large.txt', isDir: false, size: 2 << 20 },
        ],
        truncated: false,
      },
    }),
  )
  await page.route('**/api/project/file?*', (route) =>
    route.fulfill({ status: 413, body: '文件超过 1 MiB，无法预览\n' }),
  )

  const drawer = await openFiles(page)
  await drawer.getByRole('button', { name: /large.txt/ }).click()
  await expect(drawer.getByText('large.txt', { exact: true })).toBeVisible()
  await expect(drawer.getByText('文件超过 1 MiB，无法预览')).toBeVisible()
  await expect(drawer.locator('.status-toast-anchor')).toHaveCount(0)
})

test('不支持预览的文件仍打开预览页并显示提示', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [
          { name: 'archive.bin', path: 'archive.bin', isDir: false, size: 4 },
        ],
        truncated: false,
      },
    }),
  )
  await page.route('**/api/project/file?*', (route) =>
    route.fulfill({ status: 415, body: '二进制文件不支持文本预览\n' }),
  )

  const drawer = await openFiles(page)
  await drawer.getByRole('button', { name: /archive\.bin/ }).click()
  await expect(drawer.getByText('archive.bin', { exact: true })).toBeVisible()
  await expect(drawer.getByText('二进制文件不支持文本预览')).toBeVisible()
  await expect(drawer.locator('.status-toast-anchor')).toHaveCount(0)
})

test('返回终端后下载提示仍保留并可取消', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [{ name: 'file.txt', path: 'file.txt', isDir: false, size: 7 }],
        truncated: false,
      },
    }),
  )
  await page.route('**/api/project/file?*', (route) =>
    route.fulfill({ body: 'preview' }),
  )
  const releaseDownload = Promise.withResolvers<void>()
  await page.route('**/api/project/download?*', async (route) => {
    await releaseDownload.promise
    await route.fulfill({ headers: { 'Content-Length': '7' }, body: 'payload' })
  })

  const drawer = await openFiles(page)
  await drawer.getByRole('button', { name: /file.txt/ }).click()
  await drawer.locator('.project-download-button').click()
  await expect(
    page.getByText('正在下载：file.txt', { exact: true }),
  ).toBeVisible()
  await drawer.locator('.project-download-button').click()
  await expect(page.getByText('文件已在下载中', { exact: true })).toBeVisible()
  await drawer.getByRole('button', { name: '关闭项目面板' }).click()
  await expect(drawer).toHaveCount(0)
  await expect(
    page.getByText('正在下载：file.txt', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: '取消下载' }).click()
  await expect(
    page.getByText('正在下载：file.txt', { exact: true }),
  ).toHaveCount(0)
  releaseDownload.resolve()
})

test('不同文件可以并行下载并分别取消', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [
          { name: 'first.txt', path: 'first.txt', isDir: false, size: 7 },
          { name: 'second.txt', path: 'second.txt', isDir: false, size: 7 },
        ],
        truncated: false,
      },
    }),
  )
  const releaseFirst = Promise.withResolvers<void>()
  const releaseSecond = Promise.withResolvers<void>()
  await page.route('**/api/project/download?*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path')
    await (path === 'first.txt' ? releaseFirst.promise : releaseSecond.promise)
    await route.fulfill({ headers: { 'Content-Length': '7' }, body: 'payload' })
  })

  const drawer = await openFiles(page)
  const first = drawer.getByRole('button', { name: /first\.txt/ })
  const second = drawer.getByRole('button', { name: /second\.txt/ })
  await first.click({ button: 'right' })
  await drawer.getByRole('menuitem', { name: '下载', exact: true }).click()
  await second.click({ button: 'right' })
  await drawer.getByRole('menuitem', { name: '下载', exact: true }).click()

  await expect(
    page.getByText('正在下载：first.txt', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('正在下载：second.txt', { exact: true }),
  ).toBeVisible()
  const firstToast = page
    .locator('.status-toast')
    .filter({ hasText: '正在下载：first.txt' })
  const secondToast = page
    .locator('.status-toast')
    .filter({ hasText: '正在下载：second.txt' })
  await firstToast.getByRole('button', { name: '取消下载' }).click()
  await expect(firstToast).toHaveCount(0)
  await expect(secondToast).toBeVisible()

  releaseFirst.resolve()
  releaseSecond.resolve()
  await expect(
    page.getByText('下载完成：second.txt', { exact: true }),
  ).toBeVisible()
})

test('Git 状态标记不改变文件大小列位置', async ({ page }) => {
  await openTerminal(page)
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({
      json: {
        files: [
          {
            path: 'changed.txt',
            status: ' M',
            label: '修改',
            additions: 1,
            deletions: 0,
            statsComplete: true,
          },
        ],
        truncated: false,
        additions: 1,
        deletions: 0,
        statsComplete: true,
      },
    }),
  )
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [
          { name: 'changed.txt', path: 'changed.txt', isDir: false, size: 7 },
          { name: 'plain.txt', path: 'plain.txt', isDir: false, size: 7 },
        ],
        truncated: false,
      },
    }),
  )

  const drawer = await openFiles(page)
  const changed = drawer
    .locator('.project-entry')
    .filter({ hasText: 'changed.txt' })
  const plain = drawer
    .locator('.project-entry')
    .filter({ hasText: 'plain.txt' })
  await expect(changed.locator('.project-file-change')).toBeVisible()
  await expect(plain.locator('.project-file-change-placeholder')).toHaveCount(1)
  const changedSize = await changed.locator('.project-file-size').boundingBox()
  const plainSize = await plain.locator('.project-file-size').boundingBox()
  expect(changedSize).not.toBeNull()
  expect(plainSize).not.toBeNull()
  expect(Math.abs(changedSize!.x - plainSize!.x)).toBeLessThanOrEqual(1)
})

test('Git 历史显示提交图并可查看提交详情', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  const history = {
    commits: [
      {
        hash: 'c'.repeat(40),
        shortHash: 'ccccccc',
        parents: ['b'.repeat(40), 'a'.repeat(40)],
        subject: '合并功能分支',
        authorName: 'YanDock',
        authoredAt: '2026-01-01T00:00:00Z',
      },
      {
        hash: 'b'.repeat(40),
        shortHash: 'bbbbbbb',
        parents: ['a'.repeat(40)],
        subject: '功能提交',
        authorName: 'YanDock',
        authoredAt: '2025-12-31T00:00:00Z',
      },
      {
        hash: 'a'.repeat(40),
        shortHash: 'aaaaaaa',
        parents: [],
        subject: '初始提交',
        authorName: 'YanDock',
        authoredAt: '2025-12-30T00:00:00Z',
      },
    ],
    refs: [
      { name: 'main', kind: 'branch', commit: 'c'.repeat(40) },
      { name: 'v1.0', kind: 'tag', commit: 'a'.repeat(40) },
    ],
    truncated: false,
    refsTruncated: false,
  }
  await page.route('**/api/project/history*', (route) =>
    route.fulfill({ json: history }),
  )
  await page.route('**/api/project/commit*', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/commit-diff')) {
      const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`)
      return route.fulfill({
        json: {
          patch: `@@ -1,120 +1,120 @@\n${lines.map((line) => `-${line}\n+${line} changed\n`).join('')}`,
          oldContent: `${lines.join('\n')}\n`,
          newContent: `${lines.map((line) => `${line} changed`).join('\n')}\n`,
          complete: true,
          binary: false,
        },
      })
    }
    return route.fulfill({
      json: {
        ...history.commits[0],
        files: [
          { path: 'src/app.ts', status: 'M', label: '修改' },
          { path: 'README.md', status: 'A', label: '新增' },
        ],
        filesTruncated: false,
      },
    })
  })

  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await drawer.getByRole('button', { name: 'Git视图：当前变更' }).click()
  await expect(drawer.getByRole('menu', { name: 'Git视图' })).toBeVisible()
  await drawer
    .getByRole('menuitemradio', { name: '历史变更', exact: true })
    .click()
  await expect(
    drawer.getByRole('button', { name: '刷新 Git 历史' }),
  ).toHaveCount(0)
  await expect(drawer.locator('.project-history-row')).toHaveCount(3)
  await expect(drawer.getByText(/分支 main/)).toBeVisible()
  await expect(drawer.getByText(/标签 v1\.0/)).toBeVisible()
  const historyRowBoxes = await drawer
    .locator('.project-history-row')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom }
      }),
    )
  const historyGraphBoxes = await drawer
    .locator('.project-history-graph')
    .evaluateAll((graphs) =>
      graphs.map((graph) => {
        const box = graph.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom }
      }),
    )
  for (let index = 0; index < historyRowBoxes.length; index += 1) {
    expect(
      Math.abs(historyGraphBoxes[index].top - historyRowBoxes[index].top),
    ).toBeLessThan(0.5)
    expect(
      Math.abs(historyGraphBoxes[index].bottom - historyRowBoxes[index].bottom),
    ).toBeLessThan(0.5)
    if (index > 0) {
      expect(
        historyRowBoxes[index].top - historyRowBoxes[index - 1].bottom,
      ).toBeLessThan(0.5)
    }
  }

  await drawer
    .getByRole('button', { name: /提交 ccccccc：合并功能分支/ })
    .click()
  await expect(
    drawer.locator('.project-history-detail-graph-line'),
  ).toHaveCount(1)
  await expect(drawer.locator('.project-history-detail-graph-line')).toHaveCSS(
    'width',
    '3px',
  )
  await expect(
    drawer.locator('.project-history-detail-content-line'),
  ).toHaveCSS('width', '1px')
  await expect(
    drawer.locator('.project-history-files .project-change-item'),
  ).toHaveCount(2)
  await expect(drawer.getByText('src/app.ts', { exact: true })).toBeVisible()
  const historyFile = drawer
    .locator('.project-history-files .project-change-item')
    .filter({ hasText: 'src/app.ts' })
  await expect(historyFile.locator('.project-file-change')).toHaveText('M')
  await drawer.getByRole('button', { name: /修改 src\/app\.ts/ }).click()
  await expect(
    historyFile.locator('.project-history-file-diff'),
  ).toHaveAttribute('aria-label', '文件差异 src/app.ts')
  await expect(
    historyFile.locator('.project-history-file-diff .project-diff-view'),
  ).toBeVisible()
  const historyList = drawer.locator('.project-history-list')
  await expect
    .poll(() =>
      historyList.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(600)
  await historyList.evaluate((element) => {
    element.scrollTop = 400
  })
  const historyListBox = await historyList.boundingBox()
  const historyFileButton = historyFile.getByRole('button')
  const historyFileBox = await historyFileButton.boundingBox()
  expect(historyListBox).not.toBeNull()
  expect(historyFileBox).not.toBeNull()
  expect(historyFileBox!.x).toBeGreaterThan(historyListBox!.x + 20)
  expect(Math.abs(historyFileBox!.y - historyListBox!.y)).toBeLessThan(1)
  await historyFileButton.click()
  await expect(historyFileButton).toHaveAttribute('aria-expanded', 'false')
  await expect(historyFile.locator('.project-history-file-diff')).toHaveCount(0)

  const picker = drawer.getByRole('button', { name: 'Git视图：历史变更' })
  await picker.click()
  const historyMenu = drawer.getByRole('menu', { name: 'Git视图' })
  await expect(historyMenu).toBeVisible()
  await expect(historyMenu.locator('.project-review-menu-check')).toHaveCount(0)
  const pickerBox = await picker.boundingBox()
  const historyMenuBox = await historyMenu.boundingBox()
  expect(pickerBox).not.toBeNull()
  expect(historyMenuBox).not.toBeNull()
  expect(historyMenuBox!.width).toBeCloseTo(pickerBox!.width, 2)
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('[role="menu"]') !== null,
      {
        x: historyMenuBox!.x + 14,
        y: historyMenuBox!.y + historyMenuBox!.height / 2,
      },
    ),
  ).toBe(true)
  await expect(
    drawer.getByRole('menuitemradio', { name: '历史变更', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(
    drawer.getByRole('menuitemradio', { name: '当前变更', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    drawer.getByRole('button', { name: 'Git视图：当前变更' }),
  ).toBeFocused()
  const changesPicker = drawer.getByRole('button', {
    name: 'Git视图：当前变更',
  })
  await changesPicker.click()
  await page.keyboard.press('Escape')
  await expect(drawer.getByRole('menu', { name: 'Git视图' })).toBeVisible()
  await expect(drawer).not.toHaveClass(/is-closing/)
  await changesPicker.click()
  await expect(drawer.getByRole('menu', { name: 'Git视图' })).toHaveCount(0)
})

test('Git 历史按 15 条分页加载', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  const makeCommit = (index: number) => {
    const hash = index.toString(16).padStart(40, '0')
    const parent = (index - 1).toString(16).padStart(40, '0')
    return {
      hash,
      shortHash: hash.slice(0, 7),
      parents: index > 0 ? [parent] : [],
      subject: `提交 ${index}`,
      authorName: 'YanDock',
      authoredAt: '2026-01-01T00:00:00Z',
    }
  }
  const firstPage = Array.from({ length: 15 }, (_, index) =>
    makeCommit(25 - index),
  )
  const secondPage = [makeCommit(10), makeCommit(9)]
  const offsets: number[] = []
  await page.route('**/api/project/history*', (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get('offset'),
    )
    offsets.push(offset)
    return route.fulfill({
      json: {
        commits: offset === 0 ? firstPage : secondPage,
        refs: [],
        truncated: offset === 0,
        refsTruncated: false,
      },
    })
  })

  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await drawer.getByRole('button', { name: 'Git视图：当前变更' }).click()
  await drawer
    .getByRole('menuitemradio', { name: '历史变更', exact: true })
    .click()
  await expect(drawer.locator('.project-history-row')).toHaveCount(15)
  const loadMore = drawer.getByRole('button', { name: '加载更多历史' })
  await expect(loadMore).toBeVisible()
  await loadMore.click()
  await expect(drawer.locator('.project-history-row')).toHaveCount(17)
  await expect(loadMore).toHaveCount(0)
  expect(offsets).toEqual([0, 15])
})

test('Git 变更可手动刷新并沿用隐藏文件设置', async ({ page }) => {
  await openTerminal(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({ json: { files: [], truncated: false } }),
  )
  const hiddenSettings: (string | null)[] = []
  let holdRefresh = false
  let releaseRefresh: (() => void) | undefined
  await page.route('**/api/project/changes*', async (route) => {
    hiddenSettings.push(
      new URL(route.request().url()).searchParams.get('hidden'),
    )
    if (holdRefresh) {
      holdRefresh = false
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve
      })
    }
    await route.fulfill({ json: emptyChanges })
  })

  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  const refresh = drawer.getByRole('button', { name: '刷新 Git 变更' })
  await expect.poll(() => hiddenSettings.length).toBe(1)
  await refresh.hover()
  await expect(refresh).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await drawer.getByRole('tab', { name: '文件', exact: true }).click()
  await drawer.getByRole('button', { name: '显示隐藏文件' }).click()
  await drawer.getByRole('tab', { name: 'Git', exact: true }).click()
  await expect.poll(() => hiddenSettings.at(-1)).toBe('1')
  await expect(refresh).toBeEnabled()

  const previousRequests = hiddenSettings.length
  holdRefresh = true
  await refresh.click()
  await expect.poll(() => hiddenSettings.length).toBe(previousRequests + 1)
  await expect(refresh).toBeDisabled()
  releaseRefresh?.()
  await expect(refresh).toBeEnabled()
  expect(hiddenSettings.at(-1)).toBe('1')

  const beforeKeyboardRefresh = hiddenSettings.length
  await refresh.focus()
  await refresh.press('Enter')
  await expect.poll(() => hiddenSettings.length).toBe(beforeKeyboardRefresh + 1)
  await expect(refresh).toBeEnabled()
})

for (const width of [1280, 390]) {
  test(`变更状态与展开文件吸顶折叠（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await openTerminal(page)
    const files = [
      { path: 'untracked.txt', status: '??', label: '新增' },
      { path: 'added.txt', status: 'A ', label: '新增' },
      { path: 'modified.txt', status: ' M', label: '修改' },
      { path: 'deleted.txt', status: ' D', label: '删除' },
    ].map((file) => ({
      ...file,
      additions: 120,
      deletions: 0,
      statsComplete: true,
    }))
    await page.route('**/api/project/changes*', (route) =>
      route.fulfill({ json: { ...emptyChanges, files } }),
    )
    const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`)
    await page.route('**/api/project/diff*', (route) =>
      route.fulfill({
        json: {
          patch: `diff --git a/untracked.txt b/untracked.txt\n--- /dev/null\n+++ b/untracked.txt\n@@ -0,0 +1,120 @@\n${lines.map((line) => `+${line}\n`).join('')}`,
          oldContent: '',
          newContent: `${lines.join('\n')}\n`,
          complete: true,
        },
      }),
    )
    await page.getByRole('button', { name: '打开项目面板' }).click()
    const drawer = page.getByRole('dialog', { name: '项目面板' })
    await expect(
      drawer.locator('.project-change-trigger .project-file-change'),
    ).toHaveText(['U', 'A', 'M', 'D'])
    const trigger = drawer.getByRole('button', { name: '新增 untracked.txt' })
    await trigger.click()
    const list = drawer.locator('.project-review-list')
    await expect
      .poll(() =>
        list.evaluate((element) => element.scrollHeight - element.clientHeight),
      )
      .toBeGreaterThan(600)
    await list.evaluate((element) => {
      element.scrollTop = 400
    })
    await trigger.hover()
    const listBox = await list.boundingBox()
    const triggerBox = await trigger.boundingBox()
    expect(listBox).not.toBeNull()
    expect(triggerBox).not.toBeNull()
    expect(Math.abs(triggerBox!.y - listBox!.y)).toBeLessThan(1)
    expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      300,
    )
    expect(
      await trigger.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toMatch(/^rgb\(/)
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(drawer.locator('.project-review-diff')).toHaveCount(0)
    await expect(
      drawer.getByRole('button', { name: '删除 deleted.txt' }),
    ).toBeVisible()
  })
}

test('显示隐藏文件后切换终端仍按当前开关读取更改', async ({ page }) => {
  await openTerminal(page)
  await page.getByRole('button', { name: '新建终端' }).click()
  await expect(page.getByRole('tab', { name: /终端/ })).toHaveCount(2)
  const queries: URL[] = []
  await page.route('**/api/project/changes*', (route) => {
    queries.push(new URL(route.request().url()))
    return route.fulfill({ json: emptyChanges })
  })
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({ json: { files: [], truncated: false } }),
  )
  const drawer = await openFiles(page)
  await drawer.getByRole('button', { name: '显示隐藏文件' }).click()
  await expect(drawer.getByRole('button', { name: '隐藏点文件' })).toBeVisible()
  await expect.poll(() => queries.at(-1)?.searchParams.get('hidden')).toBe('1')
  const first = page.getByRole('tab', { name: /终端 1/ })
  const id = await first.getAttribute('data-session-id')
  // Dispatch navigation directly: the modal intentionally traps pointer focus,
  // but can also receive a session change when the active terminal disappears.
  await first.dispatchEvent('click')
  await expect.poll(() => queries.at(-1)?.searchParams.get('session')).toBe(id)
  expect(queries.at(-1)?.searchParams.get('hidden')).toBe('1')
  await expect(drawer.getByRole('button', { name: '隐藏点文件' })).toBeVisible()
})

test('关闭面板会取消尚未完成的文件预览请求', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [{ name: 'slow.md', path: 'slow.md', isDir: false, size: 10 }],
        truncated: false,
      },
    }),
  )
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route(/\/api\/project\/file\?/, async (route) => {
    started()
    await gate
    await route.fulfill({ body: '# 旧内容' })
  })
  const drawer = await openFiles(page)
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/api/project/file?'),
  )
  try {
    await drawer
      .locator('.project-entry')
      .filter({ hasText: 'slow.md' })
      .click()
    await ready
    await drawer.getByRole('button', { name: '关闭项目面板' }).click()
    await expect(drawer).toHaveCount(0)
    expect((await failed).failure()?.errorText).toContain('ERR_ABORTED')
  } finally {
    release()
  }
})

test('目录变化取消旧差异读取并清空展开状态', async ({ page }) => {
  await openTerminal(page)
  let directory = 'one'
  await page.route(/\/api\/session\/[^/]+\/cwd$/, (route) =>
    route.fulfill({ json: { id: directory, name: directory } }),
  )
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({
      json: {
        ...emptyChanges,
        files: [
          {
            path: `${directory}.txt`,
            status: ' M',
            label: '修改',
            additions: 1,
            deletions: 0,
            statsComplete: true,
          },
        ],
      },
    }),
  )
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/api/project/diff*', async (route) => {
    started()
    await gate
    await route.fulfill({ json: { patch: '', complete: false } })
  })
  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/api/project/diff?'),
  )
  try {
    await drawer.getByRole('button', { name: '修改 one.txt' }).click()
    await ready
    directory = 'two'
    expect((await failed).failure()?.errorText).toContain('ERR_ABORTED')
    await expect(
      drawer.getByRole('button', { name: '修改 two.txt' }),
    ).toBeVisible()
    await expect(drawer.locator('.project-review-diff')).toHaveCount(0)
    await expect(drawer.getByRole('alert')).toHaveCount(0)
  } finally {
    release()
  }
})

test('页面隐藏期间暂停目录轮询，回到前台立即查询', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  let count = 0
  await page.route(/\/api\/session\/[^/]+\/cwd$/, (route) => {
    count++
    return route.fulfill({ json: { id: 'stable', name: '当前目录' } })
  })
  await page.getByRole('button', { name: '打开项目面板' }).click()
  await expect.poll(() => count).toBeGreaterThan(0)
  await page.clock.install()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const before = count
  await page.clock.runFor(5000)
  expect(count).toBe(before)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => count).toBe(before + 1)
})

test('不完整的行数统计不会显示为准确的零行', async ({ page }) => {
  await openTerminal(page)
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({
      json: {
        ...emptyChanges,
        statsComplete: false,
        files: [
          {
            path: 'large.txt',
            status: '??',
            label: '新增',
            additions: 0,
            deletions: 0,
            statsComplete: false,
          },
        ],
      },
    }),
  )
  await page.route('**/api/project/diff*', (route) =>
    route.fulfill({ json: { patch: '', complete: false } }),
  )
  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await expect(
    drawer.getByText('行数统计不完整，仅显示已统计部分。'),
  ).toBeVisible()
  await drawer.getByRole('button', { name: '新增 large.txt' }).click()
  await expect(
    drawer.getByText('行数未完整统计', { exact: true }),
  ).toBeVisible()
  await expect(
    drawer.locator('.project-review-file-toolbar .project-diff-stats'),
  ).toHaveCount(0)
})

test('刷新文件树最多四个并发请求，切换上下文停止旧的后续读取', async ({
  page,
}) => {
  await openTerminal(page)
  await mockChanges(page)
  const directories = Array.from({ length: 6 }, (_, index) => ({
    name: `dir${index}`,
    path: `dir${index}`,
    isDir: true,
    size: 0,
  }))
  const loaded = new Set<string>()
  let holding = false
  let held = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/project/files*', async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (holding && !params.has('hidden')) {
      held++
      await gate
    }
    await route.fulfill({
      json: { files: params.has('path') ? [] : directories, truncated: false },
    })
    if (params.has('path')) loaded.add(params.get('path')!)
  })
  const drawer = await openFiles(page)
  for (const file of directories) {
    await drawer
      .locator('.project-entry')
      .filter({ hasText: file.name })
      .click()
    await expect.poll(() => loaded.has(file.path)).toBe(true)
  }
  let aborted = 0
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/project/files')) aborted++
  })
  try {
    holding = true
    await drawer.getByRole('button', { name: '刷新文件树' }).click()
    await expect.poll(() => held).toBe(4)
    await drawer.getByRole('button', { name: '显示隐藏文件' }).click()
    await expect(
      drawer.getByRole('button', { name: '隐藏点文件' }),
    ).toBeVisible()
    await expect.poll(() => aborted).toBe(4)
    release()
    await expect(drawer.locator('.project-entry')).toHaveCount(6)
    expect(held).toBe(4)
  } finally {
    release()
  }
})

test('真实终端执行 cd 后文件面板跟随新目录', async ({ page }) => {
  await openTerminal(page)
  const drawer = await openFiles(page)
  await expect(drawer.getByText('README.md', { exact: true })).toBeVisible()
  const input = page.locator('.xterm-helper-textarea:visible')
  await input.focus()
  await page.keyboard.insertText('cd web')
  await page.keyboard.press('Enter')
  await expect(
    drawer.locator('.project-breadcrumbs button').first(),
  ).toHaveText('web')
  await expect(drawer.getByText('package.json', { exact: true })).toBeVisible()
  await expect(drawer.locator('.project-breadcrumbs button')).toHaveCount(1)
  await expect(drawer.getByRole('alert')).toHaveCount(0)
})

test('Git 差异展开后可打开对应文件预览', async ({ page }) => {
  await openTerminal(page)
  await page.route('**/api/project/changes*', (route) =>
    route.fulfill({
      json: {
        ...emptyChanges,
        additions: 1,
        deletions: 1,
        files: [
          {
            path: 'example.ts',
            status: ' M',
            label: '修改',
            additions: 1,
            deletions: 1,
            statsComplete: true,
          },
        ],
      },
    }),
  )
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({ json: { files: [], truncated: false } }),
  )
  await page.route('**/api/project/diff*', (route) =>
    route.fulfill({
      json: {
        patch:
          'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-const value = 1\n+const value = 2\n',
        oldContent: 'const value = 1\n',
        newContent: 'const value = 2\n',
        complete: true,
      },
    }),
  )
  await page.route(/\/api\/project\/file\?/, (route) =>
    route.fulfill({ body: 'const value = 2\n' }),
  )
  await page.getByRole('button', { name: '打开项目面板' }).click()
  const drawer = page.getByRole('dialog', { name: '项目面板' })
  await drawer.getByRole('button', { name: '修改 example.ts' }).click()
  const diff = drawer.locator('.project-review-diff')
  await expect(diff.locator('.project-diff-stats')).toContainText('+1')
  await expect
    .poll(() =>
      diff.locator('diffs-container').evaluate((element) => {
        const text = element.shadowRoot?.textContent ?? ''
        return (
          text.includes('const value = 1') && text.includes('const value = 2')
        )
      }),
    )
    .toBe(true)
  await diff.getByRole('button', { name: '打开文件' }).click()
  await expect(drawer.locator('.project-preview-heading code')).toHaveText(
    'example.ts',
  )
  await expect
    .poll(() =>
      drawer
        .locator('diffs-container')
        .evaluate((element) =>
          element.shadowRoot?.textContent?.includes('const value = 2'),
        ),
    )
    .toBe(true)
})

test('文件菜单 Escape 只关闭菜单，切换面板后可重新操作', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({
      json: {
        files: [{ name: 'file.txt', path: 'file.txt', isDir: false, size: 1 }],
        truncated: false,
      },
    }),
  )
  const drawer = await openFiles(page)
  const file = drawer.locator('.project-entry').filter({ hasText: 'file.txt' })
  await file.click({ button: 'right' })
  await expect(drawer.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer.getByRole('menu')).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await file.click({ button: 'right' })
  await drawer.getByRole('tab', { name: 'Git', exact: true }).click()
  await drawer.getByRole('tab', { name: '文件', exact: true }).click()
  await expect(drawer.getByRole('menu')).toHaveCount(0)
  await file.click({ button: 'right' })
  await expect(drawer.getByRole('menu')).toBeVisible()
})

for (const gesture of ['右键', '移动端长按']) {
  test(`文件操作菜单直接触发带文件名的下载（${gesture}）`, async ({ page }) => {
    if (gesture === '移动端长按') await emulateMobileUserAgent(page, 'iPhone')
    await openTerminal(page)
    await mockChanges(page)
    await page.route('**/api/project/files*', (route) =>
      route.fulfill({
        json: {
          files: [
            { name: 'archive.tar', path: 'archive.tar', isDir: false, size: 4 },
          ],
          truncated: false,
        },
      }),
    )
    await page.route('**/api/project/download?*', (route) => {
      expect(route.request().resourceType()).toBe('fetch')
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: {
          'Content-Length': '4',
          'Content-Disposition': 'attachment; filename="archive.tar"',
        },
        body: 'data',
      })
    })
    const drawer = await openFiles(page)
    const entry = drawer.locator('.project-entry')
    if (gesture === '移动端长按') {
      const bounds = await entry.boundingBox()
      expect(bounds).not.toBeNull()
      await entry.dispatchEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: bounds!.x + 10,
        clientY: bounds!.y + 10,
      })
      await expect(drawer.getByRole('menu')).toBeVisible()
      await entry.dispatchEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
      })
    } else await entry.click({ button: 'right' })
    const download = page.waitForEvent('download')
    await drawer.getByRole('menuitem', { name: '下载', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('archive.tar')
    await expect(drawer.getByRole('menu')).toHaveCount(0)
  })
}

test('切换更改和文件不重置进行中的上传', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  await page.route('**/api/project/files*', (route) =>
    route.fulfill({ json: { files: [], truncated: false } }),
  )
  const uploadRoute = Promise.withResolvers<void>()
  await page.route('**/api/project/upload*', async (route) => {
    await uploadRoute.promise
    await route.fulfill({ status: 201 })
  })
  const drawer = await openFiles(page)
  const requested = page.waitForRequest('**/api/project/upload*')
  const picker = page.waitForEvent('filechooser')
  await drawer.getByRole('button', { name: '上传文件', exact: true }).click()
  await (
    await picker
  ).setFiles({
    name: 'upload.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('test'),
  })
  await requested
  await drawer.getByRole('tab', { name: 'Git', exact: true }).click()
  await drawer.getByRole('tab', { name: '文件', exact: true }).click()
  await expect(
    drawer.getByRole('button', { name: '正在上传文件' }),
  ).toBeDisabled()
  uploadRoute.resolve()
  await expect(
    drawer.getByRole('button', { name: '上传文件', exact: true }),
  ).toBeEnabled()
})

test('文件夹菜单上传到目标文件夹，不使用当前选中目录', async ({ page }) => {
  await openTerminal(page)
  await mockChanges(page)
  let uploaded = false
  await page.route('**/api/project/files*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || ''
    return route.fulfill({
      json: {
        files:
          path === ''
            ? ['first', 'second'].map((name) => ({
                name,
                path: name,
                isDir: true,
                size: 0,
              }))
            : uploaded && path === 'first'
              ? [
                  {
                    name: 'upload.txt',
                    path: 'first/upload.txt',
                    isDir: false,
                    size: 5,
                  },
                ]
              : [],
        truncated: false,
      },
    })
  })
  await page.route('**/api/project/upload*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('path')).toBe(
      'first',
    )
    uploaded = true
    return route.fulfill({ status: 204 })
  })
  const drawer = await openFiles(page)
  const entry = (name: string) =>
    drawer
      .locator('.project-entry')
      .filter({ has: page.getByText(name, { exact: true }) })
  await entry('first').click()
  await expect(drawer.getByText('空文件夹', { exact: true })).toBeVisible()
  await entry('second').click()
  await entry('first').click({ button: 'right' })
  const picker = page.waitForEvent('filechooser')
  await drawer.getByRole('menuitem', { name: '上传', exact: true }).click()
  await (
    await picker
  ).setFiles({
    name: 'upload.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  await expect(entry('upload.txt')).toBeVisible()
  await expect(drawer.locator('.project-breadcrumbs')).toContainText('second')
})

for (const target of ['root.txt', 'first/nested.txt', 'first']) {
  test(`删除 ${target} 后刷新所属目录，与路径栏选中目录无关`, async ({
    page,
  }) => {
    await openTerminal(page)
    await mockChanges(page)
    let deleted = false
    const file = (path: string, isDir = false) => ({
      name: path.split('/').at(-1),
      path,
      isDir,
      size: 12,
    })
    await page.route('**/api/project/files*', (route) => {
      const path = new URL(route.request().url()).searchParams.get('path') || ''
      const files =
        path === ''
          ? [file('first', true), file('second', true), file('root.txt')]
          : path === 'first'
            ? [file('first/nested.txt')]
            : [file('second/keep.txt')]
      return route.fulfill({
        json: {
          files: files.filter((entry) => !deleted || entry.path !== target),
          truncated: false,
        },
      })
    })
    await page.route(/\/api\/project\/file\?/, (route) => {
      expect(route.request().method()).toBe('DELETE')
      expect(new URL(route.request().url()).searchParams.get('path')).toBe(
        target,
      )
      deleted = true
      return route.fulfill({ status: 204 })
    })
    const drawer = await openFiles(page)
    const entry = (name: string) =>
      drawer.locator('.project-entry').filter({
        has: page.getByText(name, { exact: true }),
      })
    await entry('first').click()
    await expect(entry('nested.txt')).toBeVisible()
    await entry('second').click()
    await expect(entry('keep.txt')).toBeVisible()
    const removed = entry(target.split('/').at(-1)!)
    if (target === 'first') {
      await removed.dispatchEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 100,
        clientY: 200,
      })
      await expect(drawer.getByRole('menu')).toBeVisible()
      await removed.dispatchEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
      })
      await expect(
        drawer.getByRole('menuitem', { name: '下载', exact: true }),
      ).toHaveCount(0)
    } else {
      await removed.click({ button: 'right' })
    }
    page.once('dialog', (dialog) => {
      if (target === 'first') expect(dialog.message()).toContain('及其全部内容')
      return dialog.accept()
    })
    await drawer.getByRole('menuitem', { name: '删除', exact: true }).click()
    await expect(removed).toHaveCount(0)
    await expect(entry('keep.txt')).toBeVisible()
    await expect(drawer.locator('.project-breadcrumbs')).toContainText('second')
  })
}
