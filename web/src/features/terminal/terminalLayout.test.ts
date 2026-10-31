import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalLayout } from './terminalLayout'

describe('terminal layout scheduling', () => {
  let frames: Map<number, FrameRequestCallback>
  const paint = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(0)
  }
  const fixture = () => {
    const element = { clientWidth: 800, clientHeight: 600 }
    const terminal = { cols: 80, rows: 24, refresh: vi.fn() }
    const fit = vi.fn(() => {
      terminal.cols = 100
      terminal.rows = 30
    })
    const resize = vi.fn()
    const layout = createTerminalLayout(element, terminal, fit, resize)
    return { element, terminal, fit, resize, layout }
  }

  beforeEach(() => {
    frames = new Map()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fits once per frame and sends the measured size', () => {
    const { layout, fit, resize, terminal } = fixture()
    layout.schedule()
    layout.schedule()
    layout.schedule()
    expect(frames.size).toBe(1)
    expect(fit).not.toHaveBeenCalled()
    paint()
    expect(fit).toHaveBeenCalledOnce()
    expect(resize).toHaveBeenCalledExactlyOnceWith(100, 30)
    expect(terminal.refresh).not.toHaveBeenCalled()
    layout.schedule()
    paint()
    expect(fit).toHaveBeenCalledTimes(2)
  })

  it('retains activation repaint when other events share the frame', () => {
    const { layout, terminal, fit } = fixture()
    layout.schedule()
    layout.schedule(true)
    layout.schedule()
    paint()
    expect(fit).toHaveBeenCalledOnce()
    expect(terminal.refresh).toHaveBeenCalledExactlyOnceWith(0, 29)
    layout.schedule()
    paint()
    expect(terminal.refresh).toHaveBeenCalledOnce()
  })

  it.each(['clientWidth', 'clientHeight'] as const)(
    'skips hidden terminals with zero %s and fits on activation',
    (dimension) => {
      const { layout, element, fit, resize, terminal } = fixture()
      element[dimension] = 0
      layout.schedule(true)
      paint()
      expect(fit).not.toHaveBeenCalled()
      expect(resize).not.toHaveBeenCalled()
      expect(terminal.refresh).not.toHaveBeenCalled()
      element[dimension] = 600
      layout.schedule(true)
      paint()
      expect(fit).toHaveBeenCalledOnce()
      expect(terminal.refresh).toHaveBeenCalledOnce()
    },
  )

  it('cancels pending layout and ignores calls after disposal', () => {
    const { layout, fit, resize, terminal } = fixture()
    layout.schedule(true)
    layout.dispose()
    layout.dispose()
    layout.schedule()
    expect(frames.size).toBe(0)
    paint()
    expect(fit).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()
    expect(terminal.refresh).not.toHaveBeenCalled()
  })
})
