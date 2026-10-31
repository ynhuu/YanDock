import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { TerminalTextSnapshot } from './terminalText'

type Props = {
  snapshot: TerminalTextSnapshot
  fontSize: number
  onClose: () => void
  onPaste: (text: string) => boolean
}

export function TerminalTextPanel({
  snapshot,
  fontSize,
  onClose,
  onPaste,
}: Props) {
  const [mode, setMode] = useState<'menu' | 'copy' | 'paste'>('menu')
  const [draft, setDraft] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const copying = mode === 'copy'

  const dismissOutside = useEffectEvent((event: Event) => {
    if (event.target instanceof Node && !panel.current?.contains(event.target))
      onClose()
  })
  useEffect(() => {
    // Pointer events cover mouse, pen and touch without processing each tap
    // twice. Editors keep native scrolling; only the menu dismisses on scroll.
    const events =
      mode === 'menu' ? ['pointerdown', 'scroll', 'wheel'] : ['pointerdown']
    for (const type of events) {
      document.addEventListener(type, dismissOutside, {
        capture: true,
        passive: true,
      })
    }
    return () => {
      for (const type of events)
        document.removeEventListener(type, dismissOutside, true)
    }
  }, [mode])

  useLayoutEffect(() => {
    const menu = panel.current
    const parent = menu?.parentElement
    if (!menu || !parent || mode !== 'menu') return
    const position = () => {
      const width = menu.offsetWidth
      const height = menu.offsetHeight
      menu.style.left = `${Math.max(8, Math.min(parent.clientWidth - width - 8, snapshot.x - width / 2))}px`
      const above = snapshot.y - height - 12
      const top = above >= 8 ? above : snapshot.y + 12
      menu.style.top = `${Math.max(8, Math.min(parent.clientHeight - height - 8, top))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(parent)
    observer.observe(menu)
    return () => {
      observer.disconnect()
      menu.style.left = ''
      menu.style.top = ''
    }
  }, [snapshot.x, snapshot.y, mode])

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea',
      ),
    )
    const index = controls.findIndex(
      (control) => control === document.activeElement,
    )
    const next =
      (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    event.preventDefault()
    controls[next]?.focus()
  }

  return (
    <div
      ref={panel}
      className={mode === 'menu' ? 'terminal-text-menu' : 'terminal-text-panel'}
      role="dialog"
      aria-label="复制与粘贴"
      onKeyDown={navigate}
      onContextMenu={(event) => {
        if (mode === 'menu') event.preventDefault()
      }}
    >
      {mode === 'menu' ? (
        <div
          className="terminal-text-actions"
          role="toolbar"
          aria-label="终端文本操作"
        >
          <button type="button" autoFocus onClick={() => setMode('copy')}>
            复制
          </button>
          <button type="button" onClick={() => setMode('paste')}>
            粘贴
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {copying
              ? '长按文字，使用系统菜单选择和拷贝'
              : '点击输入框后长按，使用系统粘贴'}
          </p>
          <textarea
            ref={textarea}
            style={{ fontSize }}
            aria-label={copying ? '可见终端文本' : '待粘贴文本'}
            readOnly={copying}
            value={copying ? snapshot.text : draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
          />
          {mode === 'paste' && (
            <p className="text-xs text-muted-foreground" role="status">
              发送会在末尾附加回车，可能执行命令，请先检查。
            </p>
          )}
          <div className="terminal-text-actions">
            {copying && (
              <button
                type="button"
                onClick={() => {
                  textarea.current?.focus({ preventScroll: true })
                  textarea.current?.select()
                }}
              >
                全选
              </button>
            )}
            <button type="button" autoFocus onClick={onClose}>
              {copying ? '关闭' : '取消'}
            </button>
            {mode === 'paste' && (
              <button
                type="button"
                disabled={!draft}
                onClick={() => {
                  if (onPaste(draft)) onClose()
                }}
              >
                发送
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
