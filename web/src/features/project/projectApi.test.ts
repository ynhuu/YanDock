import { afterEach, expect, it, vi } from 'vitest'
import {
  downloadProjectFile,
  getProjectCommitDiff,
  getProjectHistory,
} from './projectApi'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('历史请求按 15 条分页并编码会话', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(
      JSON.stringify({
        commits: [],
        refs: [],
        truncated: false,
        refsTruncated: false,
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  })

  await expect(getProjectHistory('session id')).resolves.toEqual({
    commits: [],
    refs: [],
    truncated: false,
    refsTruncated: false,
  })

  const url = new URL(fetch.mock.calls[0][0] as string, 'https://example.test')
  expect(url.pathname).toBe('/api/project/history')
  expect(url.searchParams.get('session')).toBe('session id')
  expect(url.searchParams.get('limit')).toBe('15')
  expect(url.searchParams.get('offset')).toBe('0')

  await getProjectHistory('session id', 15)
  const nextUrl = new URL(
    fetch.mock.calls[1][0] as string,
    'https://example.test',
  )
  expect(nextUrl.searchParams.get('offset')).toBe('15')
})

it('提交文件差异请求编码提交哈希、文件路径和会话', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        patch: '',
        oldContent: '',
        newContent: '',
        complete: true,
        binary: false,
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  )

  await expect(
    getProjectCommitDiff('session id', 'a'.repeat(40), '目录/a & b.ts'),
  ).resolves.toMatchObject({ complete: true, binary: false })

  const url = new URL(fetch.mock.calls[0][0] as string, 'https://example.test')
  expect(url.pathname).toBe('/api/project/commit-diff')
  expect(url.searchParams.get('session')).toBe('session id')
  expect(url.searchParams.get('hash')).toBe('a'.repeat(40))
  expect(url.searchParams.get('path')).toBe('目录/a & b.ts')
})

it.each([
  ['session-id', '目录/a & b.zip', 'a & b.zip'],
  [null, '.hidden.txt', '.hidden.txt'],
  [null, '目录/a#b?.zip', 'a#b?.zip'],
  [null, '', 'download'],
])('下载读取响应并正确编码路径：%s / %s', async (sessionId, path, filename) => {
  const link = {
    href: '',
    download: '',
    hidden: false,
    click: vi.fn(),
    remove: vi.fn(),
  }
  const append = vi.fn()
  vi.stubGlobal('document', {
    createElement: vi.fn(() => link),
    body: { append },
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('payload', {
      headers: {
        'content-length': '7',
        'content-type': 'application/octet-stream',
      },
    }),
  )
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:test')
  const progress: { loaded: number; total: number | null }[] = []

  await downloadProjectFile(sessionId, path, (value) => progress.push(value))

  const url = new URL(fetch.mock.calls[0][0] as string, 'https://example.test')
  expect(url.pathname).toBe('/api/project/download')
  expect(url.searchParams.get('session')).toBe(sessionId)
  expect(url.searchParams.get('path')).toBe(path || null)
  expect(url.searchParams.get('hidden')).toBe('1')
  expect(link.download).toBe(filename)
  expect(append).toHaveBeenCalledWith(link)
  expect(link.click).toHaveBeenCalledOnce()
  expect(link.remove).toHaveBeenCalledOnce()
  expect(append.mock.invocationCallOrder[0]).toBeLessThan(
    link.click.mock.invocationCallOrder[0],
  )
  expect(link.click.mock.invocationCallOrder[0]).toBeLessThan(
    link.remove.mock.invocationCallOrder[0],
  )
  expect(link.href).toBe('blob:test')
  expect(fetch).toHaveBeenCalledOnce()
  expect(createObjectURL).toHaveBeenCalledOnce()
  expect(progress.at(-1)).toEqual({ loaded: 7, total: 7 })
})

it('缺少文件总长度时直接报告下载错误', async () => {
  const link = {
    href: '',
    download: '',
    hidden: false,
    click: vi.fn(),
    remove: vi.fn(),
  }
  vi.stubGlobal('document', {
    createElement: vi.fn(() => link),
    body: { append: vi.fn() },
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('payload'))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')

  await expect(downloadProjectFile(null, 'file.txt')).rejects.toThrow(
    '服务器未提供有效的文件大小',
  )

  expect(link.click).not.toHaveBeenCalled()
})

it('响应内容长度不一致时不启动下载', async () => {
  const link = {
    href: '',
    download: '',
    hidden: false,
    click: vi.fn(),
    remove: vi.fn(),
  }
  vi.stubGlobal('document', {
    createElement: vi.fn(() => link),
    body: { append: vi.fn() },
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('data', { headers: { 'content-length': '5' } }),
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')

  await expect(downloadProjectFile(null, 'file.txt')).rejects.toThrow(
    '响应内容长度不一致',
  )

  expect(link.click).not.toHaveBeenCalled()
})

it('超过下载大小上限时不分配缓冲区', async () => {
  const link = {
    href: '',
    download: '',
    hidden: false,
    click: vi.fn(),
    remove: vi.fn(),
  }
  vi.stubGlobal('document', {
    createElement: vi.fn(() => link),
    body: { append: vi.fn() },
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, {
      headers: { 'content-length': String(128 * 1024 * 1024 + 1) },
    }),
  )
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:test')

  await expect(downloadProjectFile(null, 'large.bin')).rejects.toThrow(
    '文件超过 128 MiB 下载上限',
  )

  expect(createObjectURL).not.toHaveBeenCalled()
  expect(link.click).not.toHaveBeenCalled()
})

it('浏览器拒绝启动下载时仍清理临时链接，并保留错误供调用方提示', async () => {
  const error = new Error('下载被拒绝')
  const link = {
    click: vi.fn(() => {
      throw error
    }),
    remove: vi.fn(),
  }
  vi.stubGlobal('document', {
    createElement: vi.fn(() => link),
    body: { append: vi.fn() },
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('data', { headers: { 'content-length': '4' } }),
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')

  await expect(downloadProjectFile(null, 'file.txt')).rejects.toThrow(error)
  expect(link.remove).toHaveBeenCalledOnce()
})
