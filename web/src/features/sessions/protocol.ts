export type SessionInfo = { id: string; seq: number; running: boolean }
export type ServerControl =
  | { type: 'hello'; version: 1; replay: false }
  | {
      type: 'hello'
      version: 2
      replay: boolean
      cols: number
      rows: number
      truncated: boolean
    }
  | { type: 'replay-size'; cols: number; rows: number }
  | { type: 'replay-end'; running: boolean }
  | { type: 'status'; message: string; retryable: boolean }

export function parseControl(data: string): ServerControl {
  const value: unknown = JSON.parse(data)
  if (typeof value !== 'object' || value === null)
    throw new Error('无效控制消息')
  if (
    'type' in value &&
    value.type === 'hello' &&
    'version' in value &&
    value.version === 1 &&
    'replay' in value &&
    value.replay === false
  ) {
    return { type: 'hello', version: 1, replay: false }
  }
  if (
    'type' in value &&
    'cols' in value &&
    'rows' in value &&
    typeof value.cols === 'number' &&
    Number.isInteger(value.cols) &&
    value.cols >= 2 &&
    value.cols <= 500 &&
    typeof value.rows === 'number' &&
    Number.isInteger(value.rows) &&
    value.rows >= 2 &&
    value.rows <= 300
  ) {
    if (value.type === 'replay-size')
      return { type: 'replay-size', cols: value.cols, rows: value.rows }
    if (
      value.type === 'hello' &&
      'version' in value &&
      value.version === 2 &&
      'replay' in value &&
      typeof value.replay === 'boolean' &&
      'truncated' in value &&
      typeof value.truncated === 'boolean'
    )
      return {
        type: 'hello',
        version: 2,
        replay: value.replay,
        cols: value.cols,
        rows: value.rows,
        truncated: value.truncated,
      }
  }
  if (
    'type' in value &&
    value.type === 'replay-end' &&
    'running' in value &&
    typeof value.running === 'boolean'
  )
    return { type: 'replay-end', running: value.running }
  if (
    'type' in value &&
    value.type === 'status' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'retryable' in value &&
    typeof value.retryable === 'boolean'
  ) {
    return {
      type: 'status',
      message: value.message,
      retryable: value.retryable,
    }
  }
  throw new Error('不支持的控制消息或协议版本')
}

function sessionInfo(value: unknown): SessionInfo {
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    /^[a-f0-9]{32}$/.test(value.id) &&
    'seq' in value &&
    typeof value.seq === 'number' &&
    Number.isInteger(value.seq) &&
    value.seq > 0 &&
    'running' in value &&
    typeof value.running === 'boolean'
  ) {
    return { id: value.id, seq: value.seq, running: value.running }
  }
  throw new Error('无效终端信息')
}

export function parseSession(value: unknown): SessionInfo | null {
  if (value === null) return null
  return sessionInfo(value)
}

export function parseSessions(value: unknown): SessionInfo[] {
  if (!Array.isArray(value)) throw new Error('无效终端列表')
  return value.map(sessionInfo)
}
