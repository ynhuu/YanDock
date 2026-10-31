import { memo } from 'react'
import type { ThemeMode } from '../../shared/theme/useThemePreference'
import type { TerminalEvent } from '../sessions/sessionState'
import { AuxKeys } from './AuxKeys'
import { useTerminal } from './useTerminal'
import { TerminalTextPanel } from './TerminalTextPanel'
import type { StatusToastVariant } from '../../shared/ui/StatusToast'

type Props = {
  id: string
  active: boolean
  closing: boolean
  pending: boolean
  theme: ThemeMode
  fontSize: number
  showAuxKeys: boolean
  onEvent: (id: string, event: TerminalEvent) => void
  onToast: (message: string, variant: StatusToastVariant) => void
}

export const Terminal = memo(function Terminal({
  id,
  active,
  closing,
  pending,
  theme,
  fontSize,
  showAuxKeys,
  onEvent,
  onToast,
}: Props) {
  const {
    host,
    ctrlOn,
    shiftOn,
    keyboardOpen,
    sendKey,
    toggleKeyboard,
    toggleCtrl,
    toggleShift,
    textSnapshot,
    closeText,
    pasteText,
  } = useTerminal({
    id,
    active,
    closing,
    theme,
    fontSize,
    mobileClipboard: showAuxKeys,
    onEvent: (event) => onEvent(id, event),
    onToast,
  })

  return (
    <section
      className={
        active ? 'flex min-h-0 flex-1 flex-col' : 'hidden min-h-0 flex-1'
      }
      aria-label="终端"
      aria-busy={pending}
    >
      <div className="terminal-content">
        <div
          ref={host}
          className="terminal-host"
          onContextMenuCapture={(event) => {
            if (!showAuxKeys) return
            event.preventDefault()
            event.stopPropagation()
          }}
        />
        {showAuxKeys && active && !pending && textSnapshot !== null && (
          <TerminalTextPanel
            snapshot={textSnapshot}
            fontSize={fontSize}
            onClose={closeText}
            onPaste={pasteText}
          />
        )}
      </div>
      {showAuxKeys && (
        <AuxKeys
          onKey={sendKey}
          onToggleKeyboard={toggleKeyboard}
          keyboardOpen={keyboardOpen}
          ctrlOn={ctrlOn}
          onToggleCtrl={toggleCtrl}
          shiftOn={shiftOn}
          onToggleShift={toggleShift}
        />
      )}
    </section>
  )
})
