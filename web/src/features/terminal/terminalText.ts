import type { IBuffer } from '@xterm/xterm'

export type TerminalTextSnapshot = {
  text: string
  x: number
  y: number
}

// Snapshot only the visible rows. Wrapped rows belong to the same logical line.
export function visibleTerminalText(terminal: {
  rows: number
  buffer: { active: Pick<IBuffer, 'viewportY' | 'getLine'> }
}) {
  const buffer = terminal.buffer.active
  let text = ''
  for (let row = 0; row < terminal.rows; row++) {
    const line = buffer.getLine(buffer.viewportY + row)
    if (!line) break
    if (row && !line.isWrapped) text += '\n'
    const next =
      row + 1 < terminal.rows
        ? buffer.getLine(buffer.viewportY + row + 1)
        : undefined
    text += line.translateToString(!next?.isWrapped)
  }
  return text.replace(/\n+$/, '')
}
