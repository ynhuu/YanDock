import { useEffect } from 'react'

function canScrollVertically(target: EventTarget | null, fingerDelta: number) {
  if (!(target instanceof Element)) return false
  for (
    let element: Element | null = target;
    element;
    element = element.parentElement
  ) {
    if (!(element instanceof HTMLElement)) continue
    const overflowY = getComputedStyle(element).overflowY
    if (!['auto', 'scroll', 'overlay'].includes(overflowY)) continue
    if (element.scrollHeight <= element.clientHeight + 1) continue
    const atTop = element.scrollTop <= 0
    const atBottom =
      element.scrollTop + element.clientHeight >= element.scrollHeight - 1
    if ((fingerDelta > 0 && !atTop) || (fingerDelta < 0 && !atBottom))
      return true
  }
  return false
}

export function usePageGestures() {
  useEffect(() => {
    const mobile =
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    if (!mobile) return

    const root = document.documentElement
    const preventContextMenu = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, [contenteditable="true"], .project-preview-scroll',
        )
      )
        return
      event.preventDefault()
    }
    root.classList.add('mobile-long-press-guard')
    document.addEventListener('contextmenu', preventContextMenu, true)
    return () => {
      root.classList.remove('mobile-long-press-guard')
      document.removeEventListener('contextmenu', preventContextMenu, true)
    }
  }, [])

  useEffect(() => {
    const preventGestureZoom = (event: Event) => event.preventDefault()
    const preventPinchZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault()
    }
    const gestureOptions = { capture: true, passive: false }
    for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
      document.addEventListener(type, preventGestureZoom, gestureOptions)
    document.addEventListener('touchmove', preventPinchZoom, gestureOptions)
    return () => {
      for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
        document.removeEventListener(type, preventGestureZoom, true)
      document.removeEventListener('touchmove', preventPinchZoom, true)
    }
  }, [])

  useEffect(() => {
    let startY: number | null = null
    const startPull = (event: TouchEvent) => {
      startY = event.touches.length === 1 ? event.touches[0].clientY : null
    }
    const preventPullToRefresh = (event: TouchEvent) => {
      if (event.touches.length !== 1 || startY === null) {
        startY = null
        return
      }
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          '.terminal-host, .tab-menu, input, textarea, [contenteditable="true"]',
        )
      ) {
        startY = event.touches[0].clientY
        return
      }
      const deltaY = event.touches[0].clientY - startY
      if (Math.abs(deltaY) <= 6 || !event.cancelable) return
      if (canScrollVertically(target, deltaY)) return
      event.preventDefault()
    }
    const resetPull = () => {
      startY = null
    }
    document.addEventListener('touchstart', startPull, {
      capture: true,
      passive: true,
    })
    document.addEventListener('touchmove', preventPullToRefresh, {
      capture: true,
      passive: false,
    })
    document.addEventListener('touchend', resetPull, { capture: true })
    document.addEventListener('touchcancel', resetPull, { capture: true })
    return () => {
      document.removeEventListener('touchstart', startPull, true)
      document.removeEventListener('touchmove', preventPullToRefresh, true)
      document.removeEventListener('touchend', resetPull, true)
      document.removeEventListener('touchcancel', resetPull, true)
    }
  }, [])
}
