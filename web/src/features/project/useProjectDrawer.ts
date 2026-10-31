import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import fileIconSpriteUrl from './opencode-file-icons.svg?url'

// Owns the one history entry shared by drawer and preview navigation.
export function useProjectDrawer() {
  const [state, setState] = useState<'closed' | 'open' | 'closing'>('closed')
  const historyEntry = useRef(false)
  const previewBack = useRef<(() => boolean) | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const open = state === 'open'
  const close = useCallback(
    () => setState((current) => (current === 'open' ? 'closing' : current)),
    [],
  )
  const finishClose = useCallback(
    () => setState((current) => (current === 'closing' ? 'closed' : current)),
    [],
  )
  const toggle = useCallback(
    () =>
      setState((current) =>
        current === 'open'
          ? 'closing'
          : current === 'closing'
            ? current
            : 'open',
      ),
    [],
  )
  const retainHistory = useCallback(() => {
    if (historyEntry.current) return
    try {
      window.history.pushState(window.history.state, '')
      historyEntry.current = true
    } catch {
      // Keep the panel usable if the browser refuses a history entry.
    }
  }, [])
  const handleBack = useEffectEvent(() => {
    if (!historyEntry.current) return
    historyEntry.current = false
    if (!open) return
    if (previewBack.current?.()) retainHistory()
    else close()
  })
  useEffect(() => {
    const popState = () => handleBack()
    window.addEventListener('popstate', popState)
    return () => window.removeEventListener('popstate', popState)
  }, [])
  useEffect(() => {
    if (open) {
      retainHistory()
      return
    }
    if (historyEntry.current) {
      historyEntry.current = false
      window.history.back()
    }
  }, [open, retainHistory])
  useEffect(() => {
    const preload = document.createElement('link')
    preload.rel = 'preload'
    preload.as = 'image'
    preload.type = 'image/svg+xml'
    preload.href = fileIconSpriteUrl
    document.head.append(preload)
    return () => preload.remove()
  }, [])
  return { state, open, trigger, previewBack, close, finishClose, toggle }
}
