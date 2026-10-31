import { describe, expect, it } from 'vitest'
import {
  ARROW_KEYS,
  CONTROL_KEYS,
  ENTER_KEY,
  ESC_KEY,
  NAVIGATION_KEYS,
  TAB_KEY,
  applyStickyShift,
  resolveAuxKey,
  toControlCharacter,
} from './keys'

const arrow = (label: string) => ARROW_KEYS.find((key) => key.label === label)!
const nav = (label: string) =>
  NAVIGATION_KEYS.find((key) => key.label === label)!

describe('辅助键序列', () => {
  it('使用标准的 Escape、Tab 和方向键序列', () => {
    expect(ESC_KEY.value).toBe('\x1b')
    expect(TAB_KEY.value).toBe('\t')
    expect(ENTER_KEY).toMatchObject({ label: '↵', value: '\r' })
    expect(ARROW_KEYS.map((key) => key.value)).toEqual([
      '\x1b[A',
      '\x1b[B',
      '\x1b[D',
      '\x1b[C',
    ])
  })

  it('使用标准控制字符和导航键序列', () => {
    expect(CONTROL_KEYS.map((key) => key.value)).toEqual([
      '\x03',
      '\x04',
      '\x0c',
    ])
    expect(NAVIGATION_KEYS.map((key) => key.value)).toEqual([
      '\x1b[H',
      '\x1b[5~',
      '\x1b[6~',
      '\x1b[F',
    ])
  })

  it('辅助键标签唯一，避免重复 key 和歧义选择器', () => {
    const labels = [
      ESC_KEY.label,
      TAB_KEY.label,
      ENTER_KEY.label,
      ...ARROW_KEYS.map((key) => key.label),
      ...CONTROL_KEYS.map((key) => key.label),
      ...NAVIGATION_KEYS.map((key) => key.label),
    ]
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('应用光标键模式', () => {
  it('普通模式使用 CSI 方向键', () => {
    expect(ARROW_KEYS.map((key) => resolveAuxKey(key, false))).toEqual([
      '\x1b[A',
      '\x1b[B',
      '\x1b[D',
      '\x1b[C',
    ])
  })

  it('应用模式使用 SS3 方向键，与 htop 等全屏程序的期望一致', () => {
    expect(resolveAuxKey(arrow('↑'), true)).toBe('\x1bOA')
    expect(resolveAuxKey(arrow('↓'), true)).toBe('\x1bOB')
    expect(resolveAuxKey(arrow('←'), true)).toBe('\x1bOD')
    expect(resolveAuxKey(arrow('→'), true)).toBe('\x1bOC')
  })

  it('Home 和 End 同样随模式切换', () => {
    expect([
      resolveAuxKey(nav('Home'), true),
      resolveAuxKey(nav('End'), true),
    ]).toEqual(['\x1bOH', '\x1bOF'])
  })

  it('翻页键、控制字符与 Esc、Tab 不随模式变化', () => {
    for (const key of [
      nav('PgUp'),
      nav('PgDn'),
      ESC_KEY,
      TAB_KEY,
      ...CONTROL_KEYS,
    ])
      expect(resolveAuxKey(key, true)).toBe(key.value)
  })
})

describe('Shift 粘滞组合键', () => {
  it('Shift + Enter 发送 LF，普通 Enter 保留 CR', () => {
    expect(applyStickyShift(ENTER_KEY.value)).toBe('\n')
    expect(resolveAuxKey(ENTER_KEY, false)).toBe('\r')
    expect(resolveAuxKey(ENTER_KEY, true)).toBe('\r')
  })
  it('为方向、导航键和反向 Tab 生成标准序列', () => {
    expect(ARROW_KEYS.map((key) => applyStickyShift(key.value))).toEqual([
      '\x1b[1;2A',
      '\x1b[1;2B',
      '\x1b[1;2D',
      '\x1b[1;2C',
    ])
    expect(applyStickyShift(arrow('↑').appValue!)).toBe('\x1b[1;2A')
    expect(applyStickyShift(nav('Home').value)).toBe('\x1b[1;2H')
    expect(applyStickyShift(nav('End').appValue!)).toBe('\x1b[1;2F')
    expect(applyStickyShift(nav('PgUp').value)).toBe('\x1b[5;2~')
    expect(applyStickyShift(nav('PgDn').value)).toBe('\x1b[6;2~')
    expect(applyStickyShift(TAB_KEY.value)).toBe('\x1b[Z')
  })

  it('大写单个 ASCII 小写字母，不改写其他输入', () => {
    expect(applyStickyShift('a')).toBe('A')
    expect(applyStickyShift('Z')).toBe('Z')
    expect(applyStickyShift('中')).toBe('中')
    expect(applyStickyShift('ab')).toBe('ab')
    expect(applyStickyShift('1')).toBe('1')
  })
})

describe('Ctrl 粘滞组合键', () => {
  it('把英文字母转换为对应控制字符', () => {
    expect(toControlCharacter('a')).toBe('\x01')
    expect(toControlCharacter('z')).toBe('\x1a')
    expect(toControlCharacter('C')).toBe('\x03')
    expect(toControlCharacter('D')).toBe('\x04')
  })

  it('忽略非字母、多字符和空输入', () => {
    for (const value of ['1', '中', 'ab', '', '\x1b', ' ']) {
      expect(toControlCharacter(value)).toBeNull()
    }
  })
})
