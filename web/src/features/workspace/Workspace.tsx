import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type {
  ThemeMode,
  ThemePreference,
} from '../../shared/theme/useThemePreference'
import { Icon } from '../../shared/ui/Icon'
import {
  StatusToast,
  type StatusToastVariant,
} from '../../shared/ui/StatusToast'
import {
  downloadProjectFile,
  type ProjectDownloadStatus,
} from '../project/projectApi'
import { pendingStateText, stateText } from '../sessions/sessionState'
import { SessionTabs } from '../sessions/SessionTabs'
import { ProjectDrawer } from '../project/ProjectDrawer'
import { useProjectDrawer } from '../project/useProjectDrawer'
import type { useWorkspace } from './useWorkspace'

const Terminal = lazy(() =>
  import('../terminal/Terminal').then((module) => ({
    default: module.Terminal,
  })),
)

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const fullscreenViewportTolerance = 48

// Android 浏览器和 WebView 外壳的全屏不一定经过 Fullscreen API：外壳隐藏
// 系统栏和自身工具栏时只会放大布局视口，因此同时比较视口与屏幕高度。
function isFullscreenDisplay(
  displayMode = window.matchMedia('(display-mode: fullscreen)'),
) {
  const viewportGap = window.screen.height - window.innerHeight
  return (
    document.fullscreenElement !== null ||
    displayMode.matches ||
    Math.abs(viewportGap) <= fullscreenViewportTolerance
  )
}

function downloadPercent(
  progress: Pick<ProjectDownloadStatus, 'loaded' | 'total'>,
) {
  return progress.total !== null && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null
}

function downloadId(sessionId: string | null, path: string) {
  return JSON.stringify([sessionId, path])
}

type Props = {
  workspace: ReturnType<typeof useWorkspace>
  theme: ThemeMode
  preference: ThemePreference
  onCycleTheme: () => void
}

export function Workspace({
  workspace,
  theme,
  preference,
  onCycleTheme,
}: Props) {
  const terminalArea = useRef<HTMLDivElement>(null)
  const project = useProjectDrawer()
  const isAndroid = /Android/i.test(navigator.userAgent)
  const [fullscreen, setFullscreen] = useState(
    () => isAndroid && isFullscreenDisplay(),
  )
  const [clock, setClock] = useState(() => clockFormatter.format(new Date()))
  const [globalToast, setGlobalToast] = useState<{
    message: string
    variant: StatusToastVariant
  } | null>(null)
  const toastTimer = useRef<number | null>(null)
  const downloadControllers = useRef(new Map<string, AbortController>())
  const downloadTimers = useRef(new Map<string, number>())
  const [downloads, setDownloads] = useState<ProjectDownloadStatus[]>([])
  const [fontSize, setFontSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('yandock-terminal-font-size'))
      if (
        Number.isInteger(stored) &&
        stored >= 8 &&
        stored <= 16 &&
        stored % 2 === 0
      )
        return stored
    } catch {
      // Use the default when browser storage is unavailable.
    }
    return 14
  })
  useEffect(() => {
    try {
      localStorage.setItem('yandock-terminal-font-size', String(fontSize))
    } catch {
      // Keep the setting usable for this page even when it cannot be saved.
    }
  }, [fontSize])
  useEffect(() => {
    if (!isAndroid) return
    const displayMode = window.matchMedia('(display-mode: fullscreen)')
    const syncFullscreen = () => setFullscreen(isFullscreenDisplay(displayMode))
    document.addEventListener('fullscreenchange', syncFullscreen)
    window.addEventListener('resize', syncFullscreen)
    displayMode.addEventListener('change', syncFullscreen)
    syncFullscreen()
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      window.removeEventListener('resize', syncFullscreen)
      displayMode.removeEventListener('change', syncFullscreen)
    }
  }, [isAndroid])
  useEffect(() => {
    if (!fullscreen) return
    let timer: number
    const updateClock = () => {
      setClock(clockFormatter.format(new Date()))
      timer = window.setTimeout(updateClock, 60_000 - (Date.now() % 60_000))
    }
    updateClock()
    return () => window.clearTimeout(timer)
  }, [fullscreen])
  const {
    sessions,
    activeId,
    closingId,
    states,
    busy,
    error,
    selectSession,
    addSession,
    closeSession,
    moveSession,
    handleEvent,
    logout,
  } = workspace
  const activeState = activeId
    ? closingId === activeId
      ? 'closing'
      : (states[activeId] ?? 'connecting')
    : null
  const showToast = useCallback(
    (message: string, variant: StatusToastVariant) => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
      setGlobalToast({ message, variant })
      toastTimer.current = window.setTimeout(() => {
        setGlobalToast(null)
        toastTimer.current = null
      }, 4000)
    },
    [],
  )
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    },
    [],
  )
  useEffect(
    () => () => {
      for (const controller of downloadControllers.current.values())
        controller.abort()
      downloadControllers.current.clear()
      for (const timer of downloadTimers.current.values())
        window.clearTimeout(timer)
      downloadTimers.current.clear()
    },
    [],
  )
  function clearDownloadTimer(id: string) {
    const timer = downloadTimers.current.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    downloadTimers.current.delete(id)
  }
  async function downloadFile(path: string) {
    const sessionId = activeId
    const id = downloadId(sessionId, path)
    if (downloadControllers.current.has(id)) {
      showToast('文件已在下载中', 'info')
      return
    }
    const controller = new AbortController()
    downloadControllers.current.set(id, controller)
    clearDownloadTimer(id)
    setDownloads((current) => [
      ...current.filter((download) => download.id !== id),
      { id, path, sessionId, loaded: 0, total: null, completed: false },
    ])
    try {
      await downloadProjectFile(
        sessionId,
        path,
        (progress) => {
          if (downloadControllers.current.get(id) === controller)
            setDownloads((current) =>
              current.map((download) =>
                download.id === id ? { ...download, ...progress } : download,
              ),
            )
        },
        controller.signal,
      )
      if (downloadControllers.current.get(id) === controller) {
        setDownloads((current) =>
          current.map((download) =>
            download.id === id
              ? {
                  ...download,
                  loaded: download.total ?? download.loaded,
                  total: download.total ?? download.loaded,
                  completed: true,
                }
              : download,
          ),
        )
        const timer = window.setTimeout(() => {
          setDownloads((current) =>
            current.filter(
              (download) => download.id !== id || !download.completed,
            ),
          )
          downloadTimers.current.delete(id)
        }, 900)
        downloadTimers.current.set(id, timer)
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setDownloads((current) =>
          current.filter((download) => download.id !== id),
        )
        showToast(cause instanceof Error ? cause.message : '下载失败', 'error')
      }
    } finally {
      if (downloadControllers.current.get(id) === controller)
        downloadControllers.current.delete(id)
    }
  }
  function cancelDownload(id: string) {
    downloadControllers.current.get(id)?.abort()
    downloadControllers.current.delete(id)
    clearDownloadTimer(id)
    setDownloads((current) => current.filter((download) => download.id !== id))
  }
  const showAuxKeys =
    isAndroid ||
    /iPhone|iPad/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  const pendingMessage = activeState ? pendingStateText[activeState] : null
  const downloadToasts = downloads.map((download) => {
    const progressPercent = downloadPercent(download)
    return (
      <StatusToast
        key={download.id}
        variant={download.completed ? 'success' : 'info'}
        progress={download.completed ? 100 : (progressPercent ?? undefined)}
        action={
          download.completed ? undefined : (
            <button
              type="button"
              className="status-toast-cancel"
              aria-label="取消下载"
              title={`取消下载 ${download.path}`}
              onClick={() => cancelDownload(download.id)}
            >
              <Icon name="close" size={14} />
            </button>
          )
        }
      >
        {download.completed
          ? `下载完成：${download.path}`
          : progressPercent === null
            ? `正在下载：${download.path}`
            : `正在下载：${download.path} ${progressPercent}%`}
      </StatusToast>
    )
  })
  const addTerminal = () =>
    addSession(async () => {
      const { measureTerminalSize } = await import('../terminal/terminalSize')
      if (!terminalArea.current) throw new Error('终端区域尚未就绪，请稍后重试')
      return measureTerminalSize(terminalArea.current, fontSize, showAuxKeys)
    })
  return (
    <main
      className="workspace flex flex-col overflow-hidden bg-background"
      data-aux-keys={showAuxKeys}
    >
      <header className="workspace-header">
        <div className="workspace-identity">
          <span className="brand-mark">
            <Icon name="terminal" />
          </span>
          <span>YanDock</span>
          <span className="header-divider" />
          <span className="header-session">
            {activeId
              ? `终端 ${sessions.find((session) => session.id === activeId)?.seq ?? ''}`
              : '工作台'}
          </span>
        </div>
        {fullscreen && (
          <time className="workspace-clock" dateTime={clock}>
            {clock}
          </time>
        )}
      </header>
      <span role="status" className="sr-only">
        {activeState
          ? `${stateText[activeState]}（共 ${sessions.length} 个终端）`
          : '还没有终端'}
      </span>
      <div ref={terminalArea} className="relative flex min-h-0 flex-1 flex-col">
        {sessions.length === 0 && (
          <section className="grid flex-1 place-items-center p-6 text-center">
            <div className="empty-state max-w-sm">
              <div className="empty-state-icon" aria-hidden="true">
                <Icon name="terminal" />
              </div>
              <p className="empty-state-kicker">YANDOCK WORKSPACE</p>
              <h2 className="mt-2 text-lg font-semibold">还没有终端</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                开启一个终端，随时回到你的开发现场。
                <br />
                浏览器断线，服务端程序仍会继续运行。
              </p>
              <button
                className="empty-create"
                disabled={busy}
                onClick={addTerminal}
              >
                <Icon name="plus" />
                创建第一个终端
              </button>
              <p className="empty-hint">切换终端不丢失当前画面</p>
            </div>
          </section>
        )}
        <Suspense fallback={null}>
          {sessions.map((session) => (
            <Terminal
              key={session.id}
              id={session.id}
              active={session.id === activeId}
              closing={session.id === closingId}
              pending={session.id === activeId && pendingMessage !== null}
              theme={theme}
              fontSize={fontSize}
              showAuxKeys={showAuxKeys}
              onEvent={handleEvent}
              onToast={showToast}
            />
          ))}
        </Suspense>
      </div>
      {(error || globalToast || pendingMessage || downloads.length > 0) && (
        <div className="status-toast-anchor global-toast-anchor">
          {error && <StatusToast variant="error">{error}</StatusToast>}
          {pendingMessage && (
            <StatusToast variant={activeState === 'retry' ? 'warning' : 'info'}>
              {pendingMessage}
            </StatusToast>
          )}
          {globalToast && (
            <StatusToast variant={globalToast.variant}>
              {globalToast.message}
            </StatusToast>
          )}
          {downloadToasts}
        </div>
      )}
      <SessionTabs
        sessions={sessions.map((session) => ({
          id: session.id,
          seq: session.seq,
          state: states[session.id] ?? 'connecting',
        }))}
        activeId={activeId}
        busy={busy}
        themePreference={preference}
        onSelect={selectSession}
        onMove={moveSession}
        onClose={closeSession}
        onCreate={addTerminal}
        projectOpen={project.open}
        projectTrigger={project.trigger}
        onToggleProject={project.toggle}
        onCycleTheme={onCycleTheme}
        fontSize={fontSize}
        onAdjustFontSize={(delta) =>
          setFontSize((current) => Math.min(16, Math.max(8, current + delta)))
        }
        onLogout={logout}
      />
      {project.state !== 'closed' && (
        <ProjectDrawer
          previewBack={project.previewBack}
          trigger={project.trigger}
          onClose={project.close}
          onClosed={project.finishClose}
          closing={project.state === 'closing'}
          mobile={showAuxKeys}
          onToast={showToast}
          sessionId={activeId}
          downloads={downloads}
          onDownload={downloadFile}
        />
      )}
    </main>
  )
}
