import { describe, expect, it } from 'vitest'
import { parseControl, parseSession, parseSessions } from './protocol'

describe('协议边界', () => {
  it('接受版本一握手和状态', () => {
    expect(
      parseControl('{"type":"hello","version":1,"replay":false}').type,
    ).toBe('hello')
    expect(
      parseControl('{"type":"status","message":"结束","retryable":false}'),
    ).toEqual({ type: 'status', message: '结束', retryable: false })
  })
  it.each([
    'null',
    '{}',
    '{"type":"hello","version":2,"replay":false}',
    '{"type":"status","message":1}',
    '{"type":"status","message":"结束"}',
    '{"type":"status","message":"结束","retryable":"yes"}',
    'not json',
  ])('拒绝无效控制消息 %s', (value) => {
    expect(() => parseControl(value)).toThrow()
  })
  it('校验会话而非直接断言 JSON 类型', () => {
    expect(parseSession(null)).toBeNull()
    expect(
      parseSession({ id: 'a'.repeat(32), seq: 1, running: true })?.running,
    ).toBe(true)
    expect(() =>
      parseSession({ id: '../bad', seq: 1, running: true }),
    ).toThrow()
    expect(() =>
      parseSession({ id: 'a'.repeat(32), seq: 1, running: 'yes' }),
    ).toThrow()
    expect(() => parseSession({ id: 'a'.repeat(32), running: true })).toThrow()
    expect(() =>
      parseSession({ id: 'a'.repeat(32), seq: 0, running: true }),
    ).toThrow()
  })
  it('校验会话列表并保留顺序', () => {
    expect(parseSessions([])).toEqual([])
    expect(
      parseSessions([
        { id: 'a'.repeat(32), seq: 1, running: true },
        { id: 'b'.repeat(32), seq: 2, running: false },
      ]),
    ).toHaveLength(2)
    expect(() => parseSessions(null)).toThrow()
    expect(() =>
      parseSessions([{ id: 'bad', seq: 1, running: true }]),
    ).toThrow()
  })
})

it('validates replay sizes and completion state', () => {
  expect(
    parseControl(
      '{"type":"hello","version":2,"replay":true,"cols":80,"rows":24,"truncated":false}',
    ).type,
  ).toBe('hello')
  expect(parseControl('{"type":"replay-size","cols":100,"rows":30}')).toEqual({
    type: 'replay-size',
    cols: 100,
    rows: 30,
  })
  expect(parseControl('{"type":"replay-end","running":false}')).toEqual({
    type: 'replay-end',
    running: false,
  })
  for (const value of [
    '{"type":"replay-size","cols":0,"rows":24}',
    '{"type":"replay-size","cols":80.5,"rows":24}',
    '{"type":"replay-end","running":"false"}',
    '{"type":"hello","version":2,"replay":true,"cols":80,"rows":24}',
  ])
    expect(() => parseControl(value)).toThrow()
})
