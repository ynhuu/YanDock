import type { Terminal } from '@xterm/xterm'
import { Unauthorized } from '../../shared/api/client'
import { getSessions } from '../sessions/api'
import { parseControl } from '../sessions/protocol'
import type { TerminalEvent } from '../sessions/sessionState'
import type { StatusToastVariant } from '../../shared/ui/StatusToast'

type Options = {
  id: string
  terminal: Pick<Terminal, 'write' | 'reset' | 'resize'>
  onEvent: (event: TerminalEvent) => void
  onHint: (hint: string, variant: StatusToastVariant) => void
  onReady: () => void
}

// One control connection per mounted terminal. dispose() cancels reconnects
// and closes only the browser connection, never the server-side session.
export function createTerminalConnection({
  id,
  terminal,
  onEvent,
  onHint,
  onReady,
}: Options) {
  let disposed = false
  let socket: WebSocket | null = null
  let finished = false
  let ready = false
  let attempts = 0
  let retryTimer = 0
  let queuedBytes = 0
  let restoring = false
  let writing = false
  const incoming: { socket: WebSocket; bytes: number; run: () => boolean }[] =
    []
  const discard = (ws?: WebSocket) => {
    for (let i = incoming.length - 1; i >= 0; i--) {
      if (!ws || incoming[i].socket === ws) {
        queuedBytes -= incoming[i].bytes
        incoming.splice(i, 1)
      }
    }
  }
  const pump = () => {
    if (writing || disposed) return
    while (incoming.length) {
      const operation = incoming.shift()!
      if (operation.socket !== socket) {
        queuedBytes -= operation.bytes
        continue
      }
      if (operation.run()) return
    }
  }
  const encoder = new TextEncoder()

  const notify = (event: TerminalEvent) => {
    if (!disposed) onEvent(event)
  }
  const isReady = () =>
    !disposed && ready && socket?.readyState === WebSocket.OPEN

  const scheduleRetry = () => {
    if (disposed || finished || retryTimer) return
    attempts += 1
    notify('retry')
    const delay = Math.min(10000, 1000 * 2 ** Math.min(attempts - 1, 4))
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      void verify()
    }, delay)
  }
  // The handshake cannot report why it failed, so ask the server first:
  // it distinguishes a closed session, a finished process and lost login.
  const verify = async () => {
    if (disposed || finished) return
    try {
      const mine = (await getSessions()).find((session) => session.id === id)
      if (disposed) return
      if (!mine) {
        finished = true
        onHint('终端已被关闭', 'warning')
        notify('gone')
        return
      }
    } catch (error) {
      if (disposed) return
      if (error instanceof Unauthorized) {
        finished = true
        notify('unauthorized')
        return
      }
      // Server restarting or network still down: keep retrying.
    }
    connect()
  }
  const connect = () => {
    if (disposed || finished) return
    const url = new URL(`/api/session/${id}/terminal`, location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    socket = ws
    let phase: 'hello' | 'replay' | 'live' = 'hello'
    let finalStatusReceived = false
    let rejected = false
    const enqueue = (bytes: number, run: () => boolean) => {
      queuedBytes += bytes
      if (queuedBytes > 1024 * 1024 || incoming.length >= 1024) {
        rejected = true
        finalStatusReceived = false
        ready = false
        restoring = false
        onHint('输出过快，已断开以保护浏览器；稍后自动重连', 'warning')
        discard(ws)
        queuedBytes -= bytes
        ws.close()
        return
      }
      incoming.push({ socket: ws, bytes, run })
      pump()
    }
    ws.onmessage = (event: MessageEvent<unknown>) => {
      if (disposed || rejected || socket !== ws) return
      try {
        if (event.data instanceof ArrayBuffer) {
          if (phase === 'hello') throw new Error('output before hello')
          const bytes = new Uint8Array(event.data)
          enqueue(bytes.byteLength, () => {
            writing = true
            terminal.write(bytes, () => {
              queuedBytes -= bytes.byteLength
              writing = false
              pump()
            })
            return true
          })
        } else if (typeof event.data === 'string') {
          const message = parseControl(event.data)
          if (message.type === 'hello') {
            if (phase !== 'hello') throw new Error('duplicate hello')
            phase = message.replay ? 'replay' : 'live'
            restoring = message.replay
            enqueue(0, () => {
              if (message.replay) {
                terminal.reset()
                terminal.resize(message.cols, message.rows)
              } else {
                ready = true
                attempts = 0
                notify('live')
                onReady()
              }
              return false
            })
          } else if (message.type === 'replay-size') {
            if (phase !== 'replay') throw new Error('resize outside replay')
            enqueue(0, () => {
              terminal.resize(message.cols, message.rows)
              return false
            })
          } else if (message.type === 'replay-end') {
            if (phase !== 'replay') throw new Error('unexpected replay end')
            phase = 'live'
            finalStatusReceived = !message.running
            enqueue(0, () => {
              restoring = false
              ready = message.running
              finished = !message.running
              attempts = 0
              onReady()
              notify(message.running ? 'live' : 'stopped')
              return false
            })
          } else {
            if (phase !== 'live') throw new Error('status before replay end')
            if (!message.retryable) finalStatusReceived = true
            enqueue(0, () => {
              onHint(message.message, 'warning')
              if (!message.retryable) {
                finished = true
                ready = false
                notify('stopped')
              }
              return false
            })
          }
        } else throw new Error('unsupported frame')
      } catch {
        rejected = true
        finished = true
        ready = false
        restoring = false
        discard(ws)
        onHint('协议不兼容，请刷新页面或更新服务', 'error')
        notify('stopped')
        ws.close()
      }
    }
    ws.onclose = (event) => {
      if (disposed || socket !== ws) return
      ready = false
      if (event.code === 4001) {
        restoring = false
        discard(ws)
        finished = true
        notify('unauthorized')
        return
      }
      // A final status can arrive before xterm finishes its preceding writes.
      // Drain that ordered tail even though the transport has already closed.
      if (finalStatusReceived) return
      restoring = false
      discard(ws)
      if (!finished) scheduleRetry()
    }
  }
  // Timers are throttled while a phone is asleep; reconnect on wake instead
  // of waiting out the remaining backoff.
  const wake = () => {
    if (
      disposed ||
      finished ||
      !retryTimer ||
      document.visibilityState !== 'visible'
    )
      return
    window.clearTimeout(retryTimer)
    retryTimer = 0
    attempts = Math.max(0, attempts - 1)
    void verify()
  }

  return {
    isReady,
    isRestoring: () => restoring,
    start() {
      document.addEventListener('visibilitychange', wake)
      window.addEventListener('online', wake)
      notify('connecting')
      connect()
    },
    sendText(data: string) {
      if (!isReady() || !socket) return
      const bytes = encoder.encode(data)
      if (bytes.byteLength > 8192 || socket.bufferedAmount > 65536) {
        onHint('输入过大或网络拥塞，本次输入未发送', 'warning')
        return
      }
      socket.send(bytes)
    },
    // Preflight the entire paste before sending any frames. No unbounded queue;
    // the caller retains its draft if the connection or buffer is unavailable.
    sendPaste(data: string) {
      if (!isReady() || !socket) {
        onHint('终端未连接，粘贴内容已保留', 'warning')
        return false
      }
      const bytes = encoder.encode(data)
      if (bytes.byteLength + socket.bufferedAmount > 65536) {
        onHint('粘贴过大或网络拥塞，请分批粘贴；内容已保留', 'warning')
        return false
      }
      let start = 0
      while (start < bytes.length) {
        let end = Math.min(start + 8192, bytes.length)
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
        socket.send(bytes.subarray(start, end))
        start = end
      }
      return true
    },
    // xterm emits binary mouse reports separately from UTF-8 text.
    sendBinary(data: string) {
      if (isReady() && socket && socket.bufferedAmount <= 65536)
        socket.send(Uint8Array.from(data, (char) => char.charCodeAt(0)))
    },
    resize(cols: number, rows: number) {
      if (isReady() && socket)
        socket.send(
          JSON.stringify({
            type: 'resize',
            cols: Math.min(500, Math.max(2, cols)),
            rows: Math.min(300, Math.max(2, rows)),
          }),
        )
    },
    dispose() {
      disposed = true
      ready = false
      restoring = false
      discard()
      window.clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      if (socket) socket.onmessage = socket.onclose = null
      socket?.close()
    },
  }
}
