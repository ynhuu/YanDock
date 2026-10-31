import { describe, expect, it } from 'vitest'
import { visibleTerminalText } from './terminalText'

describe('visible terminal text', () => {
  it('joins automatic wraps, preserves hard line breaks and excludes history', () => {
    const lines = [
      { text: 'history', wrapped: false },
      { text: 'hello ', wrapped: false },
      { text: 'world  ', wrapped: true },
      { text: '中文😀  ', wrapped: false },
      { text: '   ', wrapped: false },
    ]
    const active = {
      viewportY: 1,
      getLine: (index: number) => {
        const line = lines[index]
        return (
          line && {
            isWrapped: line.wrapped,
            length: line.text.length,
            getCell: () => undefined,
            translateToString: (trim?: boolean) =>
              trim ? line.text.trimEnd() : line.text,
          }
        )
      },
    }
    expect(visibleTerminalText({ rows: 4, buffer: { active } })).toBe(
      'hello world\n中文😀',
    )
  })
})
