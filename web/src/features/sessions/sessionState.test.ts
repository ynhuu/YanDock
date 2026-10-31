import { describe, expect, it } from 'vitest'
import { pendingStateText, type SessionState } from './sessionState'

describe('terminal pending states', () => {
  it.each<[SessionState, string | null]>([
    ['connecting', '正在连接终端…'],
    ['retry', '正在重新连接终端…'],
    ['closing', '正在关闭终端…'],
    ['live', null],
    ['stopped', null],
  ])('%s uses the shared pending message or no overlay', (state, message) => {
    expect(pendingStateText[state]).toBe(message)
  })
})
