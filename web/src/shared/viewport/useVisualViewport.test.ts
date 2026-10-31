import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisualViewport } from './useVisualViewport'

const effect = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
}))
vi.mock('react', () => ({
  useEffect: (setup: () => () => void) => {
    effect.cleanup = setup()
  },
}))

describe('visual viewport updates', () => {
  let viewport: EventTarget & { height: number; offsetTop: number }
  let page: EventTarget
  let frames: Map<number, FrameRequestCallback>
  let setProperty: ReturnType<typeof vi.fn>

  const paint = () => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(0)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    frames = new Map()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 })
    page = new EventTarget()
    setProperty = vi.fn()
    vi.stubGlobal(
      'document',
      Object.assign(page, {
        documentElement: { style: { setProperty, removeProperty: vi.fn() } },
      }),
    )
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        visualViewport: viewport,
        setTimeout,
        clearTimeout,
      }),
    )
    useVisualViewport()
  })

  afterEach(() => {
    effect.cleanup?.()
    effect.cleanup = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('coalesces viewport events and skips unchanged CSS values', () => {
    expect(setProperty).toHaveBeenCalledTimes(2)
    viewport.height = 500
    for (let i = 0; i < 10; i++) {
      viewport.dispatchEvent(new Event('resize'))
      viewport.dispatchEvent(new Event('scroll'))
    }
    expect(frames.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    paint()
    expect(setProperty).toHaveBeenCalledTimes(3)
    expect(setProperty).toHaveBeenLastCalledWith('--viewport-height', '500px')
    expect(vi.getTimerCount()).toBe(3)
    vi.runAllTimers()
    expect(setProperty).toHaveBeenCalledTimes(3)
  })

  it('retains delayed keyboard measurements after focus changes', () => {
    page.dispatchEvent(new Event('focusin'))
    paint()
    viewport.height = 450
    viewport.offsetTop = 20
    vi.advanceTimersByTime(100)
    expect(setProperty).toHaveBeenCalledWith('--viewport-height', '450px')
    expect(setProperty).toHaveBeenLastCalledWith('--viewport-top', '20px')
  })

  it('cleans up pending frames, timers and event subscriptions', () => {
    viewport.dispatchEvent(new Event('resize'))
    paint()
    viewport.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1)
    effect.cleanup?.()
    effect.cleanup = undefined
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    viewport.dispatchEvent(new Event('resize'))
    page.dispatchEvent(new Event('focusout'))
    expect(frames.size).toBe(0)
  })
})
