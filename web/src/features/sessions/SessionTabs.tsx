import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { stateText, type SessionState } from './sessionState'
import { Icon } from '../../shared/ui/Icon'
import type { ThemePreference } from '../../shared/theme/useThemePreference'
import { SessionActions } from './SessionActions'

type Tab = { id: string; seq: number; state: SessionState }
type Gesture = {
  id: string
  pointerId: number
  startX: number
  startY: number
  x: number
  timer: number
  dragging: boolean
  targetId: string
}

type Props = {
  sessions: Tab[]
  activeId: string | null
  busy: boolean
  themePreference: ThemePreference
  fontSize: number
  onAdjustFontSize: (delta: number) => void
  onSelect: (id: string) => void
  onMove: (id: string, targetId: string) => void
  onClose: (id: string) => void
  onCreate: () => void
  projectOpen: boolean
  projectTrigger: RefObject<HTMLButtonElement | null>
  onToggleProject: () => void
  onLogout: () => void
  onCycleTheme: () => void
}

export function SessionTabs({
  sessions,
  activeId,
  busy,
  themePreference,
  fontSize,
  onAdjustFontSize,
  onSelect,
  onMove,
  onClose,
  onCreate,
  projectOpen,
  projectTrigger,
  onToggleProject,
  onLogout,
  onCycleTheme,
}: Props) {
  const [menu, setMenu] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const dismissMenu = useCallback(() => setMenu(false), [])
  const gesture = useRef<Gesture | null>(null)
  const dragFrame = useRef(0)
  const ignoreClick = useRef(false)
  const keyboardFocus = useRef<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; targetId: string } | null>(
    null,
  )

  function targetAt(x: number) {
    let distance = Infinity
    let targetId: string | undefined
    for (const tab of tabsRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-session-id]',
    ) ?? []) {
      const rect = tab.getBoundingClientRect()
      const nextDistance = Math.abs(x - (rect.left + rect.width / 2))
      if (nextDistance < distance) {
        distance = nextDistance
        targetId = tab.dataset.sessionId
      }
    }
    return targetId
  }

  function finishDrag(commit: boolean) {
    const current = gesture.current
    if (!current) return
    window.clearTimeout(current.timer)
    cancelAnimationFrame(dragFrame.current)
    gesture.current = null
    setDrag(null)
    if (commit && current.dragging)
      onMove(current.id, targetAt(current.x) ?? current.targetId)
  }

  useEffect(
    () => () => {
      if (gesture.current) window.clearTimeout(gesture.current.timer)
      cancelAnimationFrame(dragFrame.current)
    },
    [],
  )

  useEffect(() => {
    if (keyboardFocus.current) {
      tabsRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-session-id="${keyboardFocus.current}"]`,
        )
        ?.focus({ preventScroll: true })
      keyboardFocus.current = null
    }
  }, [sessions])

  useEffect(() => {
    tabsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <nav className="tab-bar relative" aria-label="终端标签栏">
      <div
        ref={tabsRef}
        className="tab-scroll"
        role="tablist"
        aria-label="终端"
        aria-describedby="tab-reorder-help"
        onPointerMove={(event) => {
          const current = gesture.current
          if (!current || current.pointerId !== event.pointerId) return
          const previousX = current.x
          current.x = event.clientX
          if (!current.dragging) {
            if (
              Math.hypot(
                event.clientX - current.startX,
                event.clientY - current.startY,
              ) > 8
            ) {
              window.clearTimeout(current.timer)
              ignoreClick.current = true
            }
            if (ignoreClick.current)
              event.currentTarget.scrollLeft += previousX - event.clientX
          } else {
            event.preventDefault()
          }
        }}
        onPointerUp={(event) => {
          if (gesture.current?.pointerId === event.pointerId) {
            gesture.current.x = event.clientX
            finishDrag(true)
          }
        }}
        onPointerCancel={() => finishDrag(false)}
        onLostPointerCapture={() => finishDrag(false)}
        onContextMenu={(event) => {
          if (gesture.current) event.preventDefault()
        }}
      >
        {sessions.length === 0 && <span className="dock-empty">终端</span>}
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="tab"
            className="tab"
            data-session-id={session.id}
            data-dragging={drag?.id === session.id || undefined}
            data-drop-target={
              (drag?.targetId === session.id && drag.id !== session.id) ||
              undefined
            }
            aria-selected={session.id === activeId}
            tabIndex={session.id === activeId ? 0 : -1}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) {
                finishDrag(false)
                return
              }
              finishDrag(false)
              ignoreClick.current = false
              const current: Gesture = {
                id: session.id,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                x: event.clientX,
                timer: 0,
                dragging: false,
                targetId: session.id,
              }
              gesture.current = current
              event.currentTarget.setPointerCapture(event.pointerId)
              current.timer = window.setTimeout(() => {
                if (gesture.current !== current) return
                current.dragging = true
                ignoreClick.current = true
                setDrag({ id: current.id, targetId: current.id })
                try {
                  navigator.vibrate?.(15)
                } catch {
                  // Haptics may be unavailable or blocked; dragging must still work.
                }
                const update = () => {
                  const list = tabsRef.current
                  if (gesture.current !== current || !list) return
                  const bounds = list.getBoundingClientRect()
                  // Continue scrolling while a held tab stays near either edge.
                  if (current.x < bounds.left + 24) list.scrollLeft -= 8
                  else if (current.x > bounds.right - 24) list.scrollLeft += 8
                  const targetId = targetAt(current.x) ?? current.id
                  if (targetId !== current.targetId) {
                    current.targetId = targetId
                    setDrag({ id: current.id, targetId })
                  }
                  dragFrame.current = requestAnimationFrame(update)
                }
                dragFrame.current = requestAnimationFrame(update)
              }, 500)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                ignoreClick.current = !!gesture.current?.dragging
                finishDrag(false)
                return
              }
              ignoreClick.current = false
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return
              event.preventDefault()
              const index = sessions.findIndex((item) => item.id === session.id)
              if (
                event.altKey &&
                ['ArrowLeft', 'ArrowRight'].includes(event.key)
              ) {
                const target = Math.max(
                  0,
                  Math.min(
                    sessions.length - 1,
                    index + (event.key === 'ArrowLeft' ? -1 : 1),
                  ),
                )
                keyboardFocus.current = session.id
                onMove(session.id, sessions[target].id)
                return
              }
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? sessions.length - 1
                    : (index +
                        (event.key === 'ArrowLeft' ? -1 : 1) +
                        sessions.length) %
                      sessions.length
              onSelect(sessions[next].id)
              tabsRef.current
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                .item(next)
                ?.focus({ preventScroll: true })
            }}
            onClick={() => {
              if (!ignoreClick.current) onSelect(session.id)
              ignoreClick.current = false
            }}
            title={`终端 ${session.seq} · ${stateText[session.state]}`}
          >
            <span
              className={`tab-dot tab-dot-${session.state}`}
              aria-hidden="true"
            />
            <span>终端 {session.seq}</span>
            <span className="sr-only">{stateText[session.state]}</span>
          </button>
        ))}
      </div>
      <span id="tab-reorder-help" className="sr-only">
        长按后拖动排序；Alt 加左右方向键移动标签，Escape 取消拖动。
      </span>
      <div className="tab-actions">
        <button
          type="button"
          className="tab-action tab-action-create"
          aria-label="新建终端"
          title="新建终端"
          disabled={busy}
          onClick={onCreate}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          ref={projectTrigger}
          className="tab-action"
          aria-label="打开项目面板"
          title="项目文件与更改"
          aria-expanded={projectOpen}
          aria-haspopup="dialog"
          onClick={onToggleProject}
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          type="button"
          ref={menuTrigger}
          className="tab-action"
          aria-label="更多操作"
          title="更多操作"
          aria-expanded={menu}
          aria-haspopup="menu"
          aria-controls={menu ? 'session-actions' : undefined}
          onClick={() => setMenu((open) => !open)}
        >
          <Icon name="more" />
        </button>
      </div>
      {menu && (
        <SessionActions
          count={sessions.length}
          activeId={activeId}
          busy={busy}
          themePreference={themePreference}
          fontSize={fontSize}
          onAdjustFontSize={onAdjustFontSize}
          trigger={menuTrigger}
          onDismiss={dismissMenu}
          onClose={onClose}
          onLogout={onLogout}
          onCycleTheme={onCycleTheme}
        />
      )}
    </nav>
  )
}
