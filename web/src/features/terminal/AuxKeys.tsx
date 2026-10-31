import { useCallback, useEffect, useRef } from 'react'
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { AuxKey } from './keys'
import { Icon } from '../../shared/ui/Icon'
import {
  ARROW_KEYS,
  CONTROL_KEYS,
  ENTER_KEY,
  ESC_KEY,
  NAVIGATION_KEYS,
  TAB_KEY,
} from './keys'

type Props = {
  onKey: (key: AuxKey) => void
  onToggleKeyboard: () => void
  keyboardOpen: boolean
  ctrlOn: boolean
  onToggleCtrl: () => void
  shiftOn: boolean
  onToggleShift: () => void
}

type ArrowGesture = {
  key: AuxKey
  button: HTMLButtonElement
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  activationTimer: number | undefined
  repeatTimer: number | undefined
  repeatInterval: number | undefined
  activated: boolean
}

function vibrateOnPress() {
  if (typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(12)
  } catch {
    // Browsers can expose the API while the device or current context rejects it.
  }
}

function preventContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

export function AuxKeys({
  onKey,
  onToggleKeyboard,
  keyboardOpen,
  ctrlOn,
  onToggleCtrl,
  shiftOn,
  onToggleShift,
}: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const arrowGesture = useRef<ArrowGesture | null>(null)
  const onKeyRef = useRef(onKey)
  const lastPointerType = useRef('')
  useEffect(() => {
    onKeyRef.current = onKey
  }, [onKey])

  function markPressed(button: HTMLButtonElement, pointerId: number) {
    button.dataset.pressed = 'true'
    button.dataset.pressedPointerId = String(pointerId)
  }

  const clearPressed = useCallback(
    (button: HTMLButtonElement, pointerId: number) => {
      if (button.dataset.pressedPointerId !== String(pointerId)) return
      delete button.dataset.pressed
      delete button.dataset.pressedPointerId
    },
    [],
  )

  const finishArrowGesture = useCallback(
    (pointerId: number, cancelled: boolean) => {
      const gesture = arrowGesture.current
      if (!gesture || gesture.pointerId !== pointerId) return
      window.clearTimeout(gesture.activationTimer)
      window.clearTimeout(gesture.repeatTimer)
      window.clearInterval(gesture.repeatInterval)
      if (!cancelled && !gesture.activated) {
        gesture.activated = true
        if (gesture.pointerType !== 'mouse') vibrateOnPress()
        onKeyRef.current(gesture.key)
      }
      clearPressed(gesture.button, pointerId)
      arrowGesture.current = null
    },
    [clearPressed],
  )

  function activateArrowGesture(gesture: ArrowGesture) {
    if (arrowGesture.current !== gesture || gesture.activated) return
    gesture.activated = true
    if (gesture.pointerType !== 'mouse') vibrateOnPress()
    onKeyRef.current(gesture.key)
    gesture.repeatTimer = window.setTimeout(
      () => {
        if (arrowGesture.current !== gesture) return
        gesture.repeatInterval = window.setInterval(() => {
          if (arrowGesture.current === gesture) onKeyRef.current(gesture.key)
        }, 80)
      },
      gesture.pointerType === 'mouse' ? 400 : 150,
    )
  }

  useEffect(() => {
    const release = (event: PointerEvent, cancelled: boolean) => {
      for (const button of bar.current?.querySelectorAll<HTMLButtonElement>(
        '[data-pressed-pointer-id]',
      ) ?? []) {
        clearPressed(button, event.pointerId)
      }
      finishArrowGesture(event.pointerId, cancelled)
    }
    const move = (event: PointerEvent) => {
      const gesture = arrowGesture.current
      if (
        !gesture ||
        gesture.pointerId !== event.pointerId ||
        gesture.pointerType === 'mouse'
      )
        return
      if (
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ) > 10
      ) {
        finishArrowGesture(event.pointerId, true)
      }
    }
    const pointerUp = (event: PointerEvent) => release(event, false)
    const pointerCancel = (event: PointerEvent) => release(event, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', pointerUp, true)
    window.addEventListener('pointercancel', pointerCancel, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', pointerCancel, true)
      const gesture = arrowGesture.current
      if (gesture) finishArrowGesture(gesture.pointerId, true)
    }
  }, [clearPressed, finishArrowGesture])

  function press(event: ReactPointerEvent<HTMLButtonElement>) {
    // Keep focus (and the soft keyboard) where the user left it.
    event.preventDefault()
    if (!event.isPrimary || event.button !== 0) return
    lastPointerType.current = event.pointerType
    markPressed(event.currentTarget, event.pointerId)
  }

  function startArrowRepeat(
    event: ReactPointerEvent<HTMLButtonElement>,
    auxKey: AuxKey,
  ) {
    event.preventDefault()
    if (!event.isPrimary || event.button !== 0) return
    if (arrowGesture.current) {
      finishArrowGesture(arrowGesture.current.pointerId, true)
    }
    lastPointerType.current = event.pointerType
    const gesture: ArrowGesture = {
      key: auxKey,
      button: event.currentTarget,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      activationTimer: undefined,
      repeatTimer: undefined,
      repeatInterval: undefined,
      activated: false,
    }
    arrowGesture.current = gesture
    markPressed(event.currentTarget, event.pointerId)
    if (event.pointerType === 'mouse') {
      event.currentTarget.setPointerCapture(event.pointerId)
      activateArrowGesture(gesture)
    } else {
      gesture.activationTimer = window.setTimeout(
        () => activateArrowGesture(gesture),
        250,
      )
    }
  }

  function activateClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    action: () => void,
  ) {
    if (event.detail > 0 && lastPointerType.current !== 'mouse') {
      vibrateOnPress()
    }
    action()
  }

  const key = (auxKey: AuxKey) => (
    <button
      key={auxKey.label}
      type="button"
      className="aux-key"
      onPointerDown={(event) =>
        ARROW_KEYS.includes(auxKey)
          ? startArrowRepeat(event, auxKey)
          : press(event)
      }
      onLostPointerCapture={
        ARROW_KEYS.includes(auxKey)
          ? (event) => finishArrowGesture(event.pointerId, true)
          : undefined
      }
      onContextMenu={preventContextMenu}
      onClick={(event) => {
        if (ARROW_KEYS.includes(auxKey)) {
          // Pointer gestures are handled on release or by the repeat timer.
          if (event.detail > 0) return
          onKey(auxKey)
          return
        }
        activateClick(event, () => onKey(auxKey))
      }}
      aria-label={`发送 ${auxKey.ariaLabel ?? auxKey.label}`}
    >
      {auxKey === ENTER_KEY ? (
        <Icon name="enter" size={14} />
      ) : auxKey.label.startsWith('Ctrl+') ? (
        `^${auxKey.label.slice(5)}`
      ) : (
        auxKey.label
      )}
    </button>
  )

  return (
    <div ref={bar} className="aux-bar" aria-label="终端辅助键">
      <button
        type="button"
        className="aux-key aux-key-keyboard"
        aria-label={keyboardOpen ? '隐藏键盘' : '显示键盘'}
        aria-pressed={keyboardOpen}
        onPointerDown={press}
        onContextMenu={preventContextMenu}
        onClick={(event) => activateClick(event, onToggleKeyboard)}
      >
        <Icon name="keyboard" />
      </button>
      <div className="aux-scroll">
        <div className="aux-track">
          {key(ESC_KEY)}
          {key(TAB_KEY)}
          <button
            type="button"
            className="aux-key"
            onPointerDown={press}
            onContextMenu={preventContextMenu}
            onClick={(event) => activateClick(event, onToggleCtrl)}
            aria-pressed={ctrlOn}
            aria-label="Ctrl 组合键"
          >
            Ctrl
          </button>
          <button
            type="button"
            className="aux-key"
            onPointerDown={press}
            onContextMenu={preventContextMenu}
            onClick={(event) => activateClick(event, onToggleShift)}
            aria-pressed={shiftOn}
            aria-label="Shift 组合键"
          >
            Shift
          </button>
          {ARROW_KEYS.map(key)}
          {key(ENTER_KEY)}
          {CONTROL_KEYS.map(key)}
          {NAVIGATION_KEYS.map(key)}
        </div>
      </div>
    </div>
  )
}
