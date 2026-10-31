export const PAGE_UP = '\x1b[5~'
export const PAGE_DOWN = '\x1b[6~'

export type TouchScrollOptions = {
  // Vertical swipe in CSS pixels and its current touch point.
  scroll: (gesture: { pixels: number; x: number; y: number }) => void
  canInertia?: () => boolean
  onHold?: (point: { x: number; y: number }) => void
}

// Alternate-screen applications own their history, not xterm's scrollback.
export function attachTouchScroll(
  host: HTMLElement,
  options: TouchScrollOptions,
) {
  const { scroll, canInertia = () => false, onHold } = options
  let previous: { x: number; y: number } | null = null
  let scrolling = false
  let frame = 0
  let pending = 0
  let x = 0
  let y = 0
  let velocity = 0
  let lastMove = 0
  let momentum = 0
  let momentumStart = 0
  let lastFrame = 0
  let disposed = false
  let held = false
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  const cancelHold = () => {
    clearTimeout(holdTimer)
    holdTimer = undefined
  }

  const schedule = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(render)
  }
  const render = (now: number) => {
    frame = 0
    if (disposed) return
    if (momentum) {
      if (!canInertia() || now - momentumStart >= 500) {
        momentum = 0
      } else {
        const elapsed = Math.min(32, Math.max(0, now - lastFrame))
        momentum *= Math.exp(-elapsed / 100)
        pending += momentum * elapsed
        if (Math.abs(momentum) < 0.05) momentum = 0
      }
      lastFrame = now
    }
    if (pending) {
      const pixels = pending
      pending = 0
      scroll({ pixels, x, y })
    }
    if (momentum) schedule()
  }
  const reset = () => {
    cancelHold()
    held = false
    previous = null
    scrolling = false
    pending = velocity = momentum = 0
    cancelAnimationFrame(frame)
    frame = 0
  }
  const start = (event: TouchEvent) => {
    reset()
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    previous = { x: touch.clientX, y: touch.clientY }
    lastMove = performance.now()
    if (onHold) {
      holdTimer = setTimeout(() => {
        holdTimer = undefined
        held = true
        onHold({ x: touch.clientX, y: touch.clientY })
      }, 500)
    }
  }
  const move = (event: TouchEvent) => {
    if (!previous || event.touches.length !== 1) {
      reset()
      return
    }
    const touch = event.touches[0]
    const dx = touch.clientX - previous.x
    const dy = touch.clientY - previous.y
    if (held) {
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (!scrolling) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
      cancelHold()
      if (Math.abs(dx) > Math.abs(dy)) {
        reset()
        return
      }
      scrolling = true
    }
    if (!event.cancelable) {
      reset()
      return
    }
    event.preventDefault()
    // Avoid interpreting the same gesture twice inside xterm.
    event.stopImmediatePropagation()
    const now = performance.now()
    const pixels = -dy
    if (pending && Math.sign(pixels) !== Math.sign(pending)) pending = 0
    if (velocity && Math.sign(pixels) !== Math.sign(velocity)) velocity = 0
    velocity = Math.max(
      -1.5,
      Math.min(1.5, pixels / Math.max(8, now - lastMove)),
    )
    lastMove = now
    x = touch.clientX
    y = touch.clientY
    previous = { x: touch.clientX, y: touch.clientY }
    pending += pixels
    schedule()
  }
  const end = (event: TouchEvent) => {
    cancelHold()
    if (held) {
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation()
    }
    held = false
    const now = performance.now()
    if (
      scrolling &&
      canInertia() &&
      now - lastMove < 80 &&
      Math.abs(velocity) > 0.1
    ) {
      momentum = velocity
      momentumStart = lastFrame = now
    }
    previous = null
    scrolling = false
    if (pending || momentum) schedule()
  }
  host.addEventListener('touchstart', start, { passive: true, capture: true })
  host.addEventListener('touchmove', move, { passive: false, capture: true })
  host.addEventListener('touchend', end, { passive: false, capture: true })
  host.addEventListener('touchcancel', reset, { passive: true, capture: true })
  return () => {
    disposed = true
    reset()
    host.removeEventListener('touchstart', start, { capture: true })
    host.removeEventListener('touchmove', move, { capture: true })
    host.removeEventListener('touchend', end, { capture: true })
    host.removeEventListener('touchcancel', reset, { capture: true })
  }
}
