import type { Terminal } from '@xterm/xterm'
import { attachTouchScroll, PAGE_DOWN, PAGE_UP } from './touchScroll'

// Bridge generic touch gestures to xterm's buffer and active mouse protocol.
// The returned cleanup cancels listeners, pending frames and inertia.
export function attachTerminalTouch(
  element: HTMLElement,
  terminal: Terminal,
  send: (data: string) => void,
  onHold?: (point: { x: number; y: number }) => void,
) {
  let touchPixels = 0
  let touchBuffer = terminal.buffer.active.type
  return attachTouchScroll(element, {
    onHold,
    scroll: ({ pixels, x, y }) => {
      const buffer = terminal.buffer.active.type
      const mouse = terminal.modes.mouseTrackingMode
      if (
        buffer !== touchBuffer ||
        Math.sign(pixels) !== Math.sign(touchPixels)
      )
        touchPixels = 0
      touchBuffer = buffer
      touchPixels += pixels
      if (buffer === 'alternate' && mouse !== 'none' && mouse !== 'x10') {
        const screen = terminal.element?.querySelector('.xterm-screen')
        if (!screen) return
        const rect = screen.getBoundingClientRect()
        const lineHeight = Math.max(1, rect.height / terminal.rows)
        const steps = Math.trunc(touchPixels / lineHeight)
        if (!steps) return
        touchPixels -= steps * lineHeight
        // Let xterm encode the active mouse protocol, rather than hardcoding SGR.
        for (let step = 0; step < Math.abs(steps); step++)
          screen.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY: Math.sign(steps),
              deltaMode: WheelEvent.DOM_DELTA_LINE,
              clientX: Math.max(rect.left + 1, Math.min(rect.right - 1, x)),
              clientY: Math.max(rect.top + 1, Math.min(rect.bottom - 1, y)),
              bubbles: true,
              cancelable: true,
            }),
          )
        return
      }
      const threshold =
        buffer === 'alternate'
          ? 80
          : Math.max(1, element.clientHeight / terminal.rows)
      const steps = Math.trunc(touchPixels / threshold)
      if (!steps) return
      touchPixels -= steps * threshold
      if (buffer === 'alternate') {
        // Page keys are a fallback when the CLI has no wheel reports.
        send(
          (steps < 0 ? PAGE_UP : PAGE_DOWN).repeat(
            Math.min(8, Math.abs(steps)),
          ),
        )
      } else {
        terminal.scrollLines(steps)
      }
    },
    canInertia: () => terminal.buffer.active.type === 'normal',
  })
}
