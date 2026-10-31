import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Unauthorized } from '../../shared/api/client'
import { getSessions } from '../sessions/api'
import type { SessionInfo } from '../sessions/protocol'
import { createTerminalConnection } from './terminalConnection'

vi.mock('../sessions/api', () => ({ getSessions: vi.fn() }))

class MockSocket {
  static OPEN = 1
  static instances: MockSocket[] = []
  readyState = 0
  bufferedAmount = 0
  binaryType = ''
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  send = vi.fn()
  close = vi.fn((code = 1000) => {
    this.readyState = 3
    this.onclose?.({ code })
  })

  constructor(readonly url: URL) {
    MockSocket.instances.push(this)
  }

  hello() {
    this.readyState = MockSocket.OPEN
    this.message(JSON.stringify({ type: 'hello', version: 1, replay: false }))
  }

  message(data: unknown) {
    this.onmessage?.({ data })
  }
}

function fixture() {
  const terminal = { write: vi.fn(), reset: vi.fn(), resize: vi.fn() }
  const onEvent = vi.fn()
  const onHint = vi.fn()
  const onReady = vi.fn()
  const connection = createTerminalConnection({
    id: 'session-1',
    terminal,
    onEvent,
    onHint,
    onReady,
  })
  connection.start()
  return {
    connection,
    terminal,
    onEvent,
    onHint,
    onReady,
    socket: MockSocket.instances[0],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  MockSocket.instances = []
  vi.stubGlobal('WebSocket', MockSocket)
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }),
  )
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  )
  vi.stubGlobal('location', { href: 'http://localhost/', protocol: 'http:' })
  vi.mocked(getSessions).mockReset()
  vi.mocked(getSessions).mockResolvedValue([
    { id: 'session-1', seq: 1, running: true },
  ])
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('terminal connection', () => {
  it('preflights paste and splits UTF-8 without duplicating bracketed-paste markers', () => {
    const { connection, socket } = fixture()
    const text = '\x1b[200~' + '中文😀'.repeat(2000) + '\x1b[201~'
    expect(connection.sendPaste(text)).toBe(false)
    expect(socket.send).not.toHaveBeenCalled()
    socket.hello()
    socket.bufferedAmount = 60000
    expect(connection.sendPaste(text)).toBe(false)
    expect(socket.send).not.toHaveBeenCalled()
    socket.bufferedAmount = 0
    expect(connection.sendPaste('x'.repeat(65537))).toBe(false)
    expect(socket.send).not.toHaveBeenCalled()
    expect(connection.sendPaste(text)).toBe(true)
    const chunks = socket.send.mock.calls.map(([bytes]) => {
      expect(bytes.byteLength).toBeLessThanOrEqual(8192)
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    })
    expect(chunks.join('')).toBe(text)
    connection.dispose()
    expect(connection.sendPaste('x')).toBe(false)
  })
  it('returns to login immediately when the server revokes the login', () => {
    const { connection, socket, onEvent } = fixture()
    socket.hello()
    socket.close(4001)
    expect(onEvent).toHaveBeenLastCalledWith('unauthorized')
    expect(vi.getTimerCount()).toBe(0)
    expect(getSessions).not.toHaveBeenCalled()
    connection.dispose()
  })

  it('waits for hello, preserves UTF-8/binary input and clamps resize', () => {
    const { connection, socket, onReady, onEvent } = fixture()
    connection.sendText('ignored')
    expect(socket.send).not.toHaveBeenCalled()
    socket.hello()
    expect(onReady).toHaveBeenCalledOnce()
    expect(onEvent.mock.calls).toEqual([['connecting'], ['live']])
    connection.sendText('中文')
    connection.sendBinary('\xff')
    connection.resize(999, 0)
    expect(socket.send.mock.calls).toEqual([
      [new TextEncoder().encode('中文')],
      [new Uint8Array([255])],
      [JSON.stringify({ type: 'resize', cols: 500, rows: 2 })],
    ])
    connection.dispose()
  })

  it('bounds input and output queues', () => {
    const { connection, socket, terminal, onHint } = fixture()
    socket.hello()
    connection.sendText('x'.repeat(8193))
    socket.bufferedAmount = 65537
    connection.sendText('x')
    connection.sendBinary('\xff')
    expect(socket.send).not.toHaveBeenCalled()
    expect(onHint).toHaveBeenCalledTimes(2)
    socket.message(new ArrayBuffer(1024 * 1024))
    socket.message(new ArrayBuffer(1))
    expect(terminal.write).toHaveBeenCalledOnce()
    expect(socket.close).toHaveBeenCalledOnce()
    expect(onHint).toHaveBeenLastCalledWith(
      '输出过快，已断开以保护浏览器；稍后自动重连',
      'warning',
    )
    connection.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('verifies the session before reconnecting and wakes without waiting for backoff', async () => {
    const { connection, socket, onEvent, onHint } = fixture()
    socket.hello()
    socket.close()
    expect(onEvent).toHaveBeenLastCalledWith('retry')
    expect(onHint).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(getSessions).toHaveBeenCalledOnce()
    expect(MockSocket.instances).toHaveLength(2)
    MockSocket.instances[1].hello()
    expect(onEvent).toHaveBeenLastCalledWith('live')
    expect(onHint).not.toHaveBeenCalled()
    connection.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['gone', 'unauthorized'] as const)(
    'stops reconnecting on %s',
    async (event) => {
      const { connection, socket, onEvent, onHint } = fixture()
      if (event === 'unauthorized')
        vi.mocked(getSessions).mockRejectedValue(new Unauthorized())
      else vi.mocked(getSessions).mockResolvedValue([])
      socket.close()
      await vi.advanceTimersByTimeAsync(1000)
      expect(onEvent).toHaveBeenLastCalledWith(event)
      if (event !== 'unauthorized')
        expect(onHint).toHaveBeenLastCalledWith('终端已被关闭', 'warning')
      expect(MockSocket.instances).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
      connection.dispose()
    },
  )

  it.each([true, false])(
    'uses retryable=%s to decide whether to reconnect after status',
    (retryable) => {
      const { connection, socket, onEvent, onHint } = fixture()
      socket.hello()
      socket.message(
        JSON.stringify({ type: 'status', message: 'status', retryable }),
      )
      expect(onHint).toHaveBeenLastCalledWith('status', 'warning')
      socket.close()
      expect(onEvent).toHaveBeenLastCalledWith(retryable ? 'retry' : 'stopped')
      expect(vi.getTimerCount()).toBe(retryable ? 1 : 0)
      connection.dispose()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('ignores verification completed after disposal', async () => {
    const { connection, socket, onEvent, onHint } = fixture()
    let resolve!: (sessions: SessionInfo[]) => void
    vi.mocked(getSessions).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    socket.close()
    await vi.advanceTimersByTimeAsync(1000)
    connection.dispose()
    onEvent.mockClear()
    onHint.mockClear()
    resolve([])
    await vi.advanceTimersByTimeAsync(0)
    expect(onEvent).not.toHaveBeenCalled()
    expect(onHint).not.toHaveBeenCalled()
    expect(MockSocket.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

const replayHello = JSON.stringify({
  type: 'hello',
  version: 2,
  replay: true,
  cols: 80,
  rows: 24,
  truncated: false,
})
const replayEnd = JSON.stringify({ type: 'replay-end', running: true })

it('restores at recorded sizes, blocks input until parsed, then accepts live output', () => {
  const { connection, socket, terminal, onReady, onEvent } = fixture()
  const callbacks: (() => void)[] = []
  terminal.write.mockImplementation((_data, callback) =>
    callbacks.push(callback),
  )
  socket.readyState = MockSocket.OPEN
  socket.message(replayHello)
  expect(terminal.reset).toHaveBeenCalledOnce()
  expect(terminal.resize).toHaveBeenLastCalledWith(80, 24)
  socket.message(new TextEncoder().encode('old').buffer)
  socket.message(JSON.stringify({ type: 'replay-size', cols: 100, rows: 30 }))
  socket.message(new TextEncoder().encode('new').buffer)
  socket.message(replayEnd)
  expect(connection.isRestoring()).toBe(true)
  connection.sendText('not yet')
  expect(socket.send).not.toHaveBeenCalled()
  expect(onReady).not.toHaveBeenCalled()
  callbacks.shift()!()
  expect(terminal.resize).toHaveBeenLastCalledWith(100, 30)
  callbacks.shift()!()
  expect(connection.isRestoring()).toBe(false)
  expect(onReady).toHaveBeenCalledOnce()
  expect(onEvent).toHaveBeenLastCalledWith('live')
  connection.sendText('input')
  expect(socket.send).toHaveBeenCalledOnce()
  connection.dispose()
})

it('waits for an old in-flight xterm write before resetting the reconnected screen', async () => {
  const { connection, socket, terminal } = fixture()
  const callbacks: (() => void)[] = []
  terminal.write.mockImplementation((_data, callback) =>
    callbacks.push(callback),
  )
  socket.hello()
  socket.message(new TextEncoder().encode('old pending').buffer)
  socket.message(new TextEncoder().encode('old queued').buffer)
  socket.close()
  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(0)
  const next = MockSocket.instances[1]
  next.readyState = MockSocket.OPEN
  next.message(replayHello)
  expect(terminal.reset).not.toHaveBeenCalled()
  callbacks.shift()!()
  expect(terminal.reset).toHaveBeenCalledOnce()
  expect(terminal.write).toHaveBeenCalledTimes(1)
  next.message(replayEnd)
  expect(connection.isReady()).toBe(true)
  connection.dispose()
})

it('reconnects to finished sessions to recover their final screen without enabling input', async () => {
  const { connection, socket, onEvent } = fixture()
  vi.mocked(getSessions).mockResolvedValue([
    { id: 'session-1', seq: 1, running: false },
  ])
  socket.close()
  await vi.advanceTimersByTimeAsync(1000)
  const next = MockSocket.instances[1]
  next.readyState = MockSocket.OPEN
  next.message(replayHello)
  next.message(JSON.stringify({ type: 'replay-end', running: false }))
  expect(onEvent).toHaveBeenLastCalledWith('stopped')
  connection.sendText('ignored')
  expect(next.send).not.toHaveBeenCalled()
  next.close()
  expect(vi.getTimerCount()).toBe(0)
  connection.dispose()
})

it('accepts truncated replay without a toast and rejects out-of-order replay controls', () => {
  const { connection, socket, onHint } = fixture()
  socket.readyState = MockSocket.OPEN
  socket.message(
    JSON.stringify({
      type: 'hello',
      version: 2,
      replay: true,
      cols: 80,
      rows: 24,
      truncated: true,
    }),
  )
  expect(onHint).not.toHaveBeenCalled()
  socket.message(replayEnd)
  socket.message(replayEnd)
  expect(onHint).toHaveBeenLastCalledWith(
    '协议不兼容，请刷新页面或更新服务',
    'error',
  )
  expect(socket.close).toHaveBeenCalledOnce()
  connection.dispose()
})

it('drains final replay data and status after the transport closes', () => {
  const { connection, socket, terminal, onEvent } = fixture()
  const callbacks: (() => void)[] = []
  terminal.write.mockImplementation((_data, callback) =>
    callbacks.push(callback),
  )
  socket.readyState = MockSocket.OPEN
  socket.message(replayHello)
  socket.message(new TextEncoder().encode('last screen').buffer)
  socket.message(JSON.stringify({ type: 'replay-end', running: false }))
  socket.message(
    JSON.stringify({ type: 'status', message: '进程已结束', retryable: false }),
  )
  socket.close()
  callbacks.shift()!()
  expect(onEvent).toHaveBeenLastCalledWith('stopped')
  expect(vi.getTimerCount()).toBe(0)
  expect(connection.isReady()).toBe(false)
  connection.dispose()
})

it('treats uncapped first-start output as live so terminal queries get their first response', () => {
  const { connection, socket, onReady } = fixture()
  socket.readyState = MockSocket.OPEN
  socket.message(
    JSON.stringify({
      type: 'hello',
      version: 2,
      replay: false,
      cols: 80,
      rows: 24,
      truncated: false,
    }),
  )
  expect(onReady).toHaveBeenCalledOnce()
  connection.sendText('\x1b[1;1R')
  expect(socket.send).toHaveBeenCalledWith(
    new TextEncoder().encode('\x1b[1;1R'),
  )
  expect(connection.isRestoring()).toBe(false)
  connection.dispose()
})

it('ignores frames after output overflow even if a final status was received', () => {
  const { connection, socket, terminal, onEvent, onHint } = fixture()
  socket.hello()
  socket.message(new ArrayBuffer(1024 * 1024))
  socket.message(
    JSON.stringify({ type: 'status', message: 'finished', retryable: false }),
  )
  socket.message(new ArrayBuffer(1))
  const writes = terminal.write.mock.calls.length
  socket.message(new ArrayBuffer(1))
  expect(terminal.write).toHaveBeenCalledTimes(writes)
  expect(onHint).toHaveBeenCalledTimes(1)
  expect(onEvent).toHaveBeenLastCalledWith('retry')
  connection.dispose()
})
