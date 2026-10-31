import { useEffect } from 'react'

// Soft keyboards shrink the visual viewport without changing dvh on iPadOS.
// Publish the real visible area so the workspace can move above the keyboard.
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const root = document.documentElement
    let lastHeight: number | undefined
    let lastTop: number | undefined
    const update = () => {
      const height = Math.round(viewport?.height ?? window.innerHeight)
      const top = Math.round(viewport?.offsetTop ?? 0)
      if (height !== lastHeight) {
        root.style.setProperty('--viewport-height', `${height}px`)
        lastHeight = height
      }
      if (top !== lastTop) {
        root.style.setProperty('--viewport-top', `${top}px`)
        lastTop = top
      }
    }
    // Coalesce event bursts into one measurement per frame. WebKit may report
    // keyboard geometry late, so retain the delayed measurements as well.
    let frame: number | undefined
    let timers: number[] = []
    const recheck = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        update()
        for (const timer of timers) window.clearTimeout(timer)
        timers = [100, 400, 1000].map((delay) =>
          window.setTimeout(update, delay),
        )
      })
    }
    // Safari scrolls the page to reveal the focused input; keep the fixed
    // workspace glued to the visual viewport instead of letting it drift.
    const resetScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }
    update()
    viewport?.addEventListener('resize', recheck)
    viewport?.addEventListener('scroll', recheck)
    window.addEventListener('resize', recheck)
    window.addEventListener('orientationchange', recheck)
    window.addEventListener('scroll', resetScroll, { passive: true })
    // Focusing the terminal opens the keyboard; its final size arrives later.
    document.addEventListener('focusin', recheck)
    document.addEventListener('focusout', recheck)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      for (const timer of timers) window.clearTimeout(timer)
      viewport?.removeEventListener('resize', recheck)
      viewport?.removeEventListener('scroll', recheck)
      window.removeEventListener('resize', recheck)
      window.removeEventListener('orientationchange', recheck)
      window.removeEventListener('scroll', resetScroll)
      document.removeEventListener('focusin', recheck)
      document.removeEventListener('focusout', recheck)
      root.style.removeProperty('--viewport-height')
      root.style.removeProperty('--viewport-top')
    }
  }, [])
}
