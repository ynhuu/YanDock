import type { Terminal } from '@xterm/xterm'

// One pending layout per terminal, shared by size, font, activation and ready
// events. Keep repaint requests when several callers share the same frame.
export function createTerminalLayout(
  element: Pick<HTMLElement, 'clientWidth' | 'clientHeight'>,
  terminal: Pick<Terminal, 'cols' | 'rows' | 'refresh'>,
  fit: () => void,
  resize: (cols: number, rows: number) => void,
) {
  let frame: number | undefined
  let repaint = false
  let disposed = false

  return {
    schedule(paint = false) {
      if (disposed) return
      repaint ||= paint
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        const paint = repaint
        repaint = false
        // Hidden tabs measure as zero; activation will schedule them again.
        if (!element.clientWidth || !element.clientHeight) return
        fit()
        resize(terminal.cols, terminal.rows)
        if (paint) terminal.refresh(0, terminal.rows - 1)
      })
    },
    dispose() {
      disposed = true
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = undefined
      repaint = false
    },
  }
}
