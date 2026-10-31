import { describe, expect, it } from 'vitest'
import { terminalOptions } from './terminalSize'

describe('终端选项', () => {
  it('保留 1,000 行回滚历史', () => {
    expect(terminalOptions.scrollback).toBe(1000)
  })
})
