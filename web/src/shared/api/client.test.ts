import { afterEach, expect, it, vi } from 'vitest'
import { request, Unauthorized } from './client'

afterEach(() => vi.unstubAllGlobals())

it('JSON 请求保留序列化与同源凭据', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response())
  vi.stubGlobal('fetch', fetch)
  await request('/login', 'POST', { token: 'fixture' })
  expect(fetch).toHaveBeenCalledWith('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{"token":"fixture"}',
  })
})

it('上传保留 FormData，由浏览器生成 multipart 边界', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response())
  vi.stubGlobal('fetch', fetch)
  const form = new FormData()
  form.append('file', new Blob(['content']), 'fixture.txt')
  await request('/project/upload', 'POST', form)
  expect(fetch).toHaveBeenCalledWith('/api/project/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: undefined,
    body: form,
  })
})

it('上传与普通请求使用相同的认证失效错误', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('', { status: 401 })),
  )
  await expect(
    request('/project/upload', 'POST', new FormData()),
  ).rejects.toBeInstanceOf(Unauthorized)
})

it('保留服务端的错误说明', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(' 文件已存在\n', { status: 409 })),
  )
  await expect(
    request('/project/upload', 'POST', new FormData()),
  ).rejects.toThrow('文件已存在')
})

it('读取请求传递取消信号，不把取消改写为普通请求错误', async () => {
  const controller = new AbortController()
  const fetch = vi.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(options.signal.reason),
          { once: true },
        )
      }),
  )
  vi.stubGlobal('fetch', fetch)
  const result = request('/project/files', 'GET', undefined, controller.signal)
  const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await cancelled
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
})
