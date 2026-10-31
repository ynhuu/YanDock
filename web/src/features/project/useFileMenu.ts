import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ProjectFile } from './projectApi'

type LongPress = {
  pointerId: number
  startX: number
  startY: number
  timer: number
}

// Owns only the file menu gesture and its temporary DOM listeners.
export function useFileMenu(panel: RefObject<HTMLElement | null>) {
  const menuRef = useRef<HTMLDivElement>(null)
  const press = useRef<LongPress | null>(null)
  const suppressClick = useRef(false)
  const pointerType = useRef('')
  const [menu, setMenu] = useState<{
    file: ProjectFile
    left: number
    top: number
  } | null>(null)
  const close = () => setMenu(null)

  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer)
    },
    [],
  )

  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        setMenu(null)
    }
    const scroll = () => setMenu(null)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenu(null)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [menu])

  function open(file: ProjectFile, x: number, y: number) {
    const bounds = panel.current?.getBoundingClientRect()
    if (!bounds) return
    setMenu({
      file,
      left: Math.max(8, Math.min(x - bounds.left, bounds.width - 184 - 8)),
      top: Math.max(8, Math.min(y - bounds.top, bounds.height - 96 - 8)),
    })
  }

  function cancel(pointerId?: number) {
    const active = press.current
    if (!active || (pointerId !== undefined && active.pointerId !== pointerId))
      return
    window.clearTimeout(active.timer)
    press.current = null
  }

  function start(
    event: ReactPointerEvent<HTMLButtonElement>,
    file: ProjectFile,
  ) {
    suppressClick.current = false
    pointerType.current = event.pointerType
    cancel()
    if (event.pointerType === 'mouse') return
    const active = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: 0,
    }
    active.timer = window.setTimeout(() => {
      if (press.current !== active) return
      press.current = null
      suppressClick.current = true
      open(file, active.startX, active.startY)
    }, 550)
    press.current = active
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = press.current
    if (!active || active.pointerId !== event.pointerId) return
    if (
      Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >
      10
    ) {
      cancel(event.pointerId)
      suppressClick.current = false
    }
  }

  return {
    menu,
    menuRef,
    close,
    entryEvents: (file: ProjectFile, onOpen: () => void) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) =>
        start(event, file),
      onPointerMove: move,
      onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) =>
        cancel(event.pointerId),
      onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (press.current?.pointerId === event.pointerId) {
          cancel(event.pointerId)
          suppressClick.current = false
        }
      },
      onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        cancel()
        if (pointerType.current !== 'mouse') suppressClick.current = true
        open(file, event.clientX, event.clientY)
      },
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        if (suppressClick.current) {
          event.preventDefault()
          suppressClick.current = false
          return
        }
        onOpen()
      },
    }),
  }
}
