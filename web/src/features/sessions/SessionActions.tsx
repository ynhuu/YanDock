import { useEffect, useRef, type RefObject } from 'react'
import { Icon } from '../../shared/ui/Icon'
import type { ThemePreference } from '../../shared/theme/useThemePreference'

type Props = {
  count: number
  activeId: string | null
  busy: boolean
  themePreference: ThemePreference
  fontSize: number
  onAdjustFontSize: (delta: number) => void
  trigger: RefObject<HTMLButtonElement | null>
  onDismiss: () => void
  onClose: (id: string) => void
  onLogout: () => void
  onCycleTheme: () => void
}

// Mounted only while open; owns menu navigation and focus restoration, not tabs.
export function SessionActions({
  count,
  activeId,
  busy,
  themePreference,
  fontSize,
  onAdjustFontSize,
  trigger,
  onDismiss,
  onClose,
  onLogout,
  onCycleTheme,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const themeLabel =
    themePreference === 'system'
      ? '跟随系统'
      : themePreference === 'dark'
        ? '深色'
        : '浅色'

  useEffect(() => {
    const button = trigger.current
    const buttons = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        ) ?? [],
      )
    buttons()[0]?.focus({ preventScroll: true })
    const navigate = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
      } else if (
        ['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
      ) {
        event.preventDefault()
        const items = buttons()
        const index = items.findIndex((item) => item === document.activeElement)
        const step =
          event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
            ? -1
            : 1
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (index + step + items.length) % items.length
        items[next]?.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', navigate)
    return () => {
      window.removeEventListener('keydown', navigate)
      button?.focus({ preventScroll: true })
    }
  }, [trigger, onDismiss])

  return (
    <>
      <div className="menu-backdrop" aria-hidden="true" onClick={onDismiss} />
      <div
        role="menu"
        id="session-actions"
        ref={menuRef}
        aria-label="更多操作"
        className="tab-menu"
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="menu-heading" role="presentation">
          终端与设置<span>{count} 个终端</span>
        </div>
        <button
          type="button"
          role="menuitem"
          className="appearance-setting"
          aria-label={`主题：${themeLabel}，点击轮换`}
          onClick={onCycleTheme}
        >
          <Icon
            name={
              themePreference === 'system'
                ? 'system'
                : themePreference === 'dark'
                  ? 'moon'
                  : 'sun'
            }
          />
          <span>外观：{themeLabel}</span>
          <span className="setting-action">轮换</span>
        </button>
        <div
          className="appearance-setting font-size-setting"
          role="group"
          aria-label="终端字体大小"
        >
          <Icon name="text" />
          <span>字体大小：{fontSize}px</span>
          <button
            type="button"
            role="menuitem"
            aria-label="减小字体"
            disabled={fontSize <= 8}
            onClick={() => onAdjustFontSize(-2)}
          >
            −
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label="增大字体"
            disabled={fontSize >= 16}
            onClick={() => onAdjustFontSize(2)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          role="menuitem"
          className="danger-action"
          disabled={!activeId || busy}
          onClick={() => {
            onDismiss()
            if (activeId) onClose(activeId)
          }}
        >
          <Icon name="close" />
          关闭当前终端
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => {
            onDismiss()
            onLogout()
          }}
        >
          <Icon name="logout" />
          退出登录
        </button>
        <p className="menu-version">版本 v{import.meta.env.VITE_APP_VERSION}</p>
      </div>
    </>
  )
}
