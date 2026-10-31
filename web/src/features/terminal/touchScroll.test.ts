import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachTouchScroll, PAGE_DOWN, PAGE_UP } from './touchScroll'

function touch(host: EventTarget, type: string, points: number[][]) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  })
  host.dispatchEvent(event)
  return event
}

function setup(inertia = false, onHold?: () => void) {
  let now = 0
  let id = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame))
  // The listener only requires EventTarget methods, not a rendered DOM.
  const host = new EventTarget() as HTMLElement
  const scroll = vi.fn()
  const render = (elapsed = 16) => {
    now += elapsed
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(now)
  }
  return {
    host,
    scroll,
    frames,
    render,
    dispose: attachTouchScroll(host, {
      scroll,
      canInertia: () => inertia,
      onHold,
    }),
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('terminal touch scrolling', () => {
  it('opens a still hold once and consumes moves and release', () => {
    vi.useFakeTimers()
    const onHold = vi.fn()
    const { host, scroll, dispose } = setup(false, onHold)
    touch(host, 'touchstart', [[20, 100]])
    vi.advanceTimersByTime(499)
    expect(onHold).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onHold).toHaveBeenCalledOnce()
    expect(onHold).toHaveBeenCalledWith({ x: 20, y: 100 })
    expect(touch(host, 'touchmove', [[20, 50]]).defaultPrevented).toBe(true)
    expect(touch(host, 'touchend', []).defaultPrevented).toBe(true)
    expect(scroll).not.toHaveBeenCalled()
    dispose()
  })

  it.each(['move', 'end', 'cancel', 'multi', 'dispose'])(
    'cancels pending hold on %s',
    (action) => {
      vi.useFakeTimers()
      const onHold = vi.fn()
      const { host, dispose } = setup(false, onHold)
      touch(host, 'touchstart', [[20, 100]])
      if (action === 'move') touch(host, 'touchmove', [[28, 100]])
      if (action === 'end') touch(host, 'touchend', [])
      if (action === 'cancel') touch(host, 'touchcancel', [])
      if (action === 'multi')
        touch(host, 'touchstart', [
          [20, 100],
          [30, 100],
        ])
      if (action === 'dispose') dispose()
      vi.advanceTimersByTime(600)
      expect(onHold).not.toHaveBeenCalled()
      dispose()
    },
  )
  it('converts vertical swipes in both directions and consumes the gesture', () => {
    const { host, scroll, render } = setup()
    touch(host, 'touchstart', [[20, 100]])
    expect(touch(host, 'touchmove', [[20, 180]]).defaultPrevented).toBe(true)
    expect(scroll).not.toHaveBeenCalled()
    render()
    expect(scroll).toHaveBeenLastCalledWith({
      pixels: -80,
      x: 20,
      y: 180,
    })
    touch(host, 'touchmove', [[20, 120]])
    render()
    expect(scroll).toHaveBeenLastCalledWith({
      pixels: 60,
      x: 20,
      y: 120,
    })
  })

  it('leaves taps, horizontal gestures and pinch gestures alone', () => {
    const { host, scroll } = setup()
    touch(host, 'touchstart', [[20, 100]])
    expect(touch(host, 'touchmove', [[22, 103]]).defaultPrevented).toBe(false)
    touch(host, 'touchmove', [[80, 105]])
    touch(host, 'touchmove', [[80, 200]])
    touch(host, 'touchstart', [
      [20, 100],
      [40, 100],
    ])
    touch(host, 'touchmove', [
      [20, 180],
      [40, 180],
    ])
    expect(scroll).not.toHaveBeenCalled()
  })

  it('resets on cancellation/end and removes listeners on cleanup', () => {
    const { host, scroll, dispose } = setup()
    for (const type of ['touchend', 'touchcancel']) {
      touch(host, 'touchstart', [[20, 100]])
      touch(host, type, [])
      touch(host, 'touchmove', [[20, 180]])
    }
    dispose()
    touch(host, 'touchstart', [[20, 100]])
    touch(host, 'touchmove', [[20, 180]])
    expect(scroll).not.toHaveBeenCalled()
  })

  it('uses standard page-key sequences', () => {
    expect(PAGE_UP).toBe('\x1b[5~')
    expect(PAGE_DOWN).toBe('\x1b[6~')
  })

  it('coalesces moves per frame without building an event backlog', () => {
    const { host, scroll, frames, render } = setup()
    touch(host, 'touchstart', [[20, 100]])
    touch(host, 'touchmove', [[20, 80]])
    touch(host, 'touchmove', [[20, 60]])
    expect(frames.size).toBe(1)
    render()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      pixels: 40,
      x: 20,
      y: 60,
    })
    touch(host, 'touchmove', [[20, 40]])
    touch(host, 'touchmove', [[20, 70]])
    render()
    expect(scroll).toHaveBeenLastCalledWith({
      pixels: -30,
      x: 20,
      y: 70,
    })
  })

  it('bounds inertia and stops it immediately for a new gesture', () => {
    const { host, scroll, frames, render } = setup(true)
    touch(host, 'touchstart', [[20, 100]])
    touch(host, 'touchmove', [[20, 60]])
    render()
    touch(host, 'touchend', [])
    render()
    expect(scroll.mock.calls.length).toBe(2)
    expect(scroll.mock.calls[1][0].pixels).toBeGreaterThan(0)
    for (let i = 0; i < 40; i++) render()
    expect(frames.size).toBe(0)
    touch(host, 'touchstart', [[20, 100]])
    touch(host, 'touchmove', [[20, 60]])
    render()
    touch(host, 'touchend', [])
    touch(host, 'touchstart', [[20, 100]])
    const count = scroll.mock.calls.length
    render()
    expect(scroll.mock.calls.length).toBe(count)
    expect(frames.size).toBe(0)
  })

  it('cancels pending frames on cleanup and never coasts without opt-in', () => {
    const { host, scroll, frames, render, dispose } = setup()
    touch(host, 'touchstart', [[20, 100]])
    touch(host, 'touchmove', [[20, 60]])
    render()
    touch(host, 'touchend', [])
    expect(frames.size).toBe(0)
    touch(host, 'touchstart', [[20, 100]])
    touch(host, 'touchmove', [[20, 60]])
    dispose()
    render()
    expect(scroll).toHaveBeenCalledTimes(1)
  })
})
