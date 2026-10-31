export type SessionState =
  'connecting' | 'live' | 'retry' | 'stopped' | 'closing'

// Terminal callbacks can also report states the tab bar cannot show.
export type TerminalEvent = SessionState | 'unauthorized' | 'gone'

export const stateText: Record<SessionState, string> = {
  connecting: '连接中',
  live: '已连接',
  retry: '自动重连中',
  stopped: '进程已结束',
  closing: '正在关闭',
}

// null marks settled states; the overlay and input gating share this decision.
export const pendingStateText: Record<SessionState, string | null> = {
  connecting: '正在连接终端…',
  retry: '正在重新连接终端…',
  closing: '正在关闭终端…',
  live: null,
  stopped: null,
}
