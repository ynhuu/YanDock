import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { TerminalEvent } from '../sessions/sessionState'
import { attachTerminalTouch } from './terminalTouch'
import {
  applyStickyShift,
  resolveAuxKey,
  toControlCharacter,
  type AuxKey,
} from './keys'
import { createTerminalConnection } from './terminalConnection'
import { createTerminalLayout } from './terminalLayout'
import { visibleTerminalText, type TerminalTextSnapshot } from './terminalText'
import { terminalOptions } from './terminalSize'
import type { ThemeMode } from '../../shared/theme/useThemePreference'
import type { StatusToastVariant } from '../../shared/ui/StatusToast'

type Props = {
  id: string
  active: boolean
  closing: boolean
  theme: ThemeMode
  fontSize: number
  mobileClipboard: boolean
  onEvent: (event: TerminalEvent) => void
  onToast: (message: string, variant: StatusToastVariant) => void
}

const terminalThemes = {
  dark: {
    background: '#0b0f14',
    foreground: '#e6edf3',
    cursor: '#64e4a3',
    selectionBackground: '#315442',
  },
  light: {
    background: '#fbfdff',
    foreground: '#1d2936',
    cursor: '#087e57',
    selectionBackground: '#c5ead8',
    selectionForeground: '#17212b',
  },
}

// Keeps one terminal per session. Hidden tabs stay mounted so switching back
// keeps the visible buffer and the control connection instead of reattaching.
export function useTerminal({
  id,
  active,
  closing,
  theme,
  fontSize,
  mobileClipboard,
  onEvent,
  onToast,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [ctrlOn, setCtrlOn] = useState(false)
  const [shiftOn, setShiftOn] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const keyboardGeometry = useRef<{
    baseline: number
    wasVisible: boolean
  } | null>(null)
  const [textSnapshot, setTextSnapshot] = useState<TerminalTextSnapshot | null>(
    null,
  )
  const paste = useRef<(text: string) => boolean>(() => false)
  const send = useRef<(data: string) => void>(() => {})
  const term = useRef<XTerm | null>(null)
  const ctrl = useRef(false)
  const shift = useRef(false)
  const refit = useRef<(repaint?: boolean) => void>(() => {})
  const report = useEffectEvent(onEvent)
  const reportHint = useEffectEvent(
    (message: string, variant: StatusToastVariant) => {
      if (active && !closing) onToast(message, variant)
    },
  )
  const initialFontSize = useEffectEvent(() => fontSize)

  useEffect(() => {
    if (!host.current) return
    ctrl.current = false
    shift.current = false
    setCtrlOn(false)
    setShiftOn(false)
    const terminal = new XTerm({
      ...terminalOptions,
      cursorBlink: true,
      fontSize: initialFontSize(),
      theme:
        terminalThemes[
          document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
        ],
    })
    term.current = terminal
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    let webgl: WebglAddon | undefined
    let contextLoss: { dispose(): void } | undefined
    try {
      webgl = new WebglAddon()
      contextLoss = webgl.onContextLoss(() => webgl?.dispose())
      terminal.loadAddon(webgl)
    } catch {
      // Keep the DOM renderer on devices without WebGL2 support.
      contextLoss?.dispose()
      webgl?.dispose()
    }
    const element = host.current
    const connection = createTerminalConnection({
      id,
      terminal,
      onEvent: report,
      onHint: reportHint,
      onReady: () => {
        if (element.clientWidth && element.clientHeight) fit.fit()
        connection.resize(terminal.cols, terminal.rows)
        refit.current()
      },
    })

    send.current = (data: string) => {
      if (!connection.isReady()) return
      let payload = data
      if (shift.current) {
        payload = applyStickyShift(payload)
        shift.current = false
        setShiftOn(false)
      }
      if (ctrl.current) {
        const control = toControlCharacter(data)
        if (control) {
          payload = control
          ctrl.current = false
          setCtrlOn(false)
        }
      }
      connection.sendText(payload)
    }
    const layout = createTerminalLayout(
      element,
      terminal,
      () => {
        if (!connection.isRestoring()) fit.fit()
      },
      (cols, rows) => connection.resize(cols, rows),
    )
    // Match the server's measured initial grid before opening the socket.
    // Otherwise early PTY output can be parsed at xterm's default 80×24 size.
    fit.fit()
    refit.current = layout.schedule
    const observer = new ResizeObserver(() => layout.schedule())
    observer.observe(element)
    // xterm emits onData synchronously from paste(). Capture its normalized,
    // bracketed payload instead of applying sticky Ctrl or sending piecemeal.
    let pasteData: string | null = null
    const input = terminal.onData((data) => {
      if (pasteData !== null) pasteData += data
      else send.current(data)
    })
    paste.current = (text) => {
      pasteData = ''
      try {
        terminal.paste(text)
        // Enter follows the paste terminator and shares the same preflight.
        // If xterm suppresses input, do not send a lone Enter.
        return pasteData !== '' && connection.sendPaste(pasteData + '\r')
      } finally {
        pasteData = null
      }
    }
    const binary = terminal.onBinary((data) => connection.sendBinary(data))

    connection.start()
    layout.schedule()
    return () => {
      send.current = () => {}
      paste.current = () => false
      term.current = null
      refit.current = () => {}
      connection.dispose()
      layout.dispose()
      observer.disconnect()
      input.dispose()
      binary.dispose()
      contextLoss?.dispose()
      terminal.dispose()
    }
  }, [id])

  // Changing device capabilities only rebinds gestures, never the PTY UI or
  // its connection. Desktop touch screens keep scrolling, but no hold menu.
  useEffect(() => {
    const element = host.current
    const terminal = term.current
    if (!element || !terminal) return
    const input = element.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea',
    )
    if (input) input.readOnly = mobileClipboard
    const virtualKeyboard = (
      navigator as Navigator & {
        virtualKeyboard?: EventTarget & {
          readonly boundingRect: Pick<DOMRectReadOnly, 'height'>
        }
      }
    ).virtualKeyboard
    let viewportFrame: number | undefined
    let viewportTimers: number[] = []
    const clearViewportRechecks = () => {
      if (viewportFrame !== undefined) cancelAnimationFrame(viewportFrame)
      viewportFrame = undefined
      for (const timer of viewportTimers) window.clearTimeout(timer)
      viewportTimers = []
    }
    const onViewportResize = () => {
      if (!mobileClipboard || !input || input.readOnly) return
      const geometry = keyboardGeometry.current
      if (!geometry) return
      const height = window.visualViewport?.height ?? window.innerHeight
      if (
        (virtualKeyboard?.boundingRect.height ?? 0) > 0 ||
        height < geometry.baseline - 100
      ) {
        geometry.wasVisible = true
        return
      }
      if (!geometry.wasVisible) return
      terminal.blur()
      onBlur()
    }
    const recheckViewport = () => {
      if (!mobileClipboard || !input || input.readOnly) return
      if (viewportFrame !== undefined) return
      viewportFrame = requestAnimationFrame(() => {
        viewportFrame = undefined
        for (const timer of viewportTimers) window.clearTimeout(timer)
        viewportTimers = [100, 400, 1000].map((delay) =>
          window.setTimeout(onViewportResize, delay),
        )
        onViewportResize()
      })
    }
    const onFocus = () => {
      if (!mobileClipboard || !input) return
      // A native tap or keyboard navigation must not enable terminal input.
      // Only the auxiliary keyboard button removes readOnly before focusing.
      if (input.readOnly) {
        terminal.blur()
        return
      }
      setKeyboardOpen(true)
      recheckViewport()
    }
    const onBlur = () => {
      if (!mobileClipboard || !input) return
      input.readOnly = true
      keyboardGeometry.current = null
      clearViewportRechecks()
      setKeyboardOpen(false)
    }
    input?.addEventListener('focus', onFocus)
    input?.addEventListener('blur', onBlur)
    window.visualViewport?.addEventListener('resize', recheckViewport)
    window.visualViewport?.addEventListener('scroll', recheckViewport)
    window.addEventListener('resize', recheckViewport)
    virtualKeyboard?.addEventListener('geometrychange', recheckViewport)
    const preventMobileTerminalMouseDown = (event: MouseEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const preventTouchFocus = (event: TouchEvent) => {
      // Cancel tap activation without stopping our scroll/hold listeners.
      if (event.cancelable) event.preventDefault()
    }
    if (mobileClipboard) {
      element.addEventListener(
        'mousedown',
        preventMobileTerminalMouseDown,
        true,
      )
      element.addEventListener('touchend', preventTouchFocus, {
        capture: true,
        passive: false,
      })
    }
    const detachTouch = attachTerminalTouch(
      element,
      terminal,
      (data) => send.current(data),
      mobileClipboard
        ? (point) => {
            const rect = element.parentElement?.getBoundingClientRect()
            if (!rect) return
            terminal.blur()
            if (input) input.readOnly = true
            setKeyboardOpen(false)
            setTextSnapshot({
              text: visibleTerminalText(terminal),
              x: point.x - rect.left,
              y: point.y - rect.top,
            })
          }
        : undefined,
    )
    return () => {
      input?.removeEventListener('focus', onFocus)
      input?.removeEventListener('blur', onBlur)
      window.visualViewport?.removeEventListener('resize', recheckViewport)
      window.visualViewport?.removeEventListener('scroll', recheckViewport)
      window.removeEventListener('resize', recheckViewport)
      virtualKeyboard?.removeEventListener('geometrychange', recheckViewport)
      clearViewportRechecks()
      if (mobileClipboard) {
        element.removeEventListener(
          'mousedown',
          preventMobileTerminalMouseDown,
          true,
        )
        element.removeEventListener('touchend', preventTouchFocus, true)
      }
      detachTouch()
    }
  }, [id, mobileClipboard])

  useEffect(() => {
    if (active || !mobileClipboard) return
    const terminal = term.current
    const input = host.current?.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea',
    )
    if (!terminal || !input) return
    terminal.blur()
    input.readOnly = true
    setKeyboardOpen(false)
  }, [active, mobileClipboard])

  // Update xterm's palette in place; changing themes must not recreate the PTY UI.
  useEffect(() => {
    if (term.current) term.current.options.theme = terminalThemes[theme]
  }, [theme])

  useEffect(() => {
    const terminal = term.current
    if (!terminal || terminal.options.fontSize === fontSize) return
    terminal.options.fontSize = fontSize
    refit.current()
  }, [id, fontSize])

  // Returning to a tab repaints from the retained buffer; it never reconnects.
  useEffect(() => {
    if (!active) return
    refit.current(true)
  }, [id, active])

  // A hidden terminal must not bring an old menu/draft back on the next visit.
  if ((!active || !mobileClipboard) && textSnapshot !== null)
    setTextSnapshot(null)

  return {
    host,
    ctrlOn,
    textSnapshot,
    closeText: () => setTextSnapshot(null),
    pasteText: (text: string) => paste.current(text),
    sendKey: (key: AuxKey) =>
      send.current(
        resolveAuxKey(
          key,
          term.current?.modes.applicationCursorKeysMode ?? false,
        ),
      ),
    keyboardOpen,
    shiftOn,
    toggleKeyboard: () => {
      const terminal = term.current
      const input = host.current?.querySelector<HTMLTextAreaElement>(
        '.xterm-helper-textarea',
      )
      if (!terminal || !input || !mobileClipboard) return
      if (keyboardOpen) {
        terminal.blur()
        input.readOnly = true
        keyboardGeometry.current = null
        setKeyboardOpen(false)
      } else {
        terminal.blur()
        keyboardGeometry.current = {
          baseline: window.visualViewport?.height ?? window.innerHeight,
          wasVisible: false,
        }
        input.readOnly = false
        terminal.focus()
        if (input.ownerDocument.activeElement !== input) {
          input.readOnly = true
          keyboardGeometry.current = null
          setKeyboardOpen(false)
        }
      }
    },
    toggleCtrl: () => {
      ctrl.current = !ctrl.current
      setCtrlOn(ctrl.current)
    },
    toggleShift: () => {
      shift.current = !shift.current
      setShiftOn(shift.current)
    },
  }
}
