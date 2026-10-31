import {
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../shared/ui/Icon'
import {
  StatusToast,
  type StatusToastVariant,
} from '../../shared/ui/StatusToast'
import type { ProjectDownloadStatus } from './projectApi'
import { ProjectChanges } from './ProjectChanges'
import { ProjectFiles } from './ProjectFiles'
import { useProjectBrowser } from './useProjectBrowser'

type Props = {
  previewBack: Ref<() => boolean>
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onClosed: () => void
  closing: boolean
  mobile: boolean
  onToast: (message: string, variant: StatusToastVariant) => void
  sessionId: string | null
  downloads: ProjectDownloadStatus[]
  onDownload: (path: string) => void
}

// Drawer shell owns focus, animation and navigation; content owns its UI.
export function ProjectDrawer({
  previewBack,
  trigger,
  onClose,
  onClosed,
  closing,
  mobile,
  onToast,
  sessionId,
  downloads,
  onDownload,
}: Props) {
  const panel = useRef<HTMLElement>(null)
  const browser = useProjectBrowser(sessionId)
  const { tab, preview, clearPreview, switchTab, error } = browser
  const previewOpen = preview !== null
  useImperativeHandle(
    previewBack,
    () => () => {
      if (!previewOpen) return false
      clearPreview()
      return true
    },
    [previewOpen, clearPreview],
  )

  useEffect(() => {
    const triggerElement = trigger.current
    panel.current
      ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true })
    return () => triggerElement?.focus({ preventScroll: true })
  }, [trigger])

  useEffect(() => {
    if (!closing) return
    const timeout = window.setTimeout(onClosed, 260)
    return () => window.clearTimeout(timeout)
  }, [closing, onClosed])

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not([type="file"]):not(:disabled), [role="tab"]',
        ),
      ).filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', navigate)
    return () => window.removeEventListener('keydown', navigate)
  }, [onClose])

  return createPortal(
    <div
      className={`project-drawer-layer${mobile ? ' is-mobile' : ''}${closing ? ' is-closing' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={panel}
        className={`project-drawer${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="项目面板"
        onAnimationEnd={(event) => {
          if (closing && event.target === event.currentTarget) onClosed()
        }}
      >
        <div className="project-drawer-nav">
          <div
            className="project-drawer-tabs"
            role="tablist"
            aria-label="项目面板"
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return
              event.preventDefault()
              const next =
                event.key === 'Home' || event.key === 'ArrowLeft'
                  ? 'changes'
                  : 'files'
              switchTab(next)
              panel.current
                ?.querySelector<HTMLButtonElement>(`#project-${next}-tab`)
                ?.focus({ preventScroll: true })
            }}
          >
            {(['changes', 'files'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`project-${value}-tab`}
                aria-controls="project-drawer-content"
                aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1}
                onClick={() => switchTab(value)}
              >
                {value === 'changes' ? 'Git' : '文件'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="project-drawer-close"
            aria-label="关闭项目面板"
            onClick={onClose}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
        <div
          className="project-drawer-content"
          id="project-drawer-content"
          role="tabpanel"
          aria-labelledby={`project-${tab}-tab`}
        >
          {tab === 'changes' && <ProjectChanges {...browser} />}
          <ProjectFiles
            browser={browser}
            sessionId={sessionId}
            panel={panel}
            active={tab === 'files'}
            downloads={downloads}
            onDownload={onDownload}
            onToast={onToast}
          />
        </div>
        {error && (
          <div className="status-toast-anchor">
            <StatusToast variant="error">{error}</StatusToast>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
