import { PAGE_DOWN, PAGE_UP } from './touchScroll'

export type AuxKey = {
  label: string
  value: string
  ariaLabel?: string
  // Cursor keys sent while a program enables application cursor keys (DECCKM).
  appValue?: string
}

export const ARROW_KEYS: readonly AuxKey[] = [
  { label: '↑', value: '\x1b[A', appValue: '\x1bOA' },
  { label: '↓', value: '\x1b[B', appValue: '\x1bOB' },
  { label: '←', value: '\x1b[D', appValue: '\x1bOD' },
  { label: '→', value: '\x1b[C', appValue: '\x1bOC' },
]

export const CONTROL_KEYS: readonly AuxKey[] = [
  { label: 'Ctrl+C', value: '\x03' },
  { label: 'Ctrl+D', value: '\x04' },
  { label: 'Ctrl+L', value: '\x0c' },
]

export const NAVIGATION_KEYS: readonly AuxKey[] = [
  { label: 'Home', value: '\x1b[H', appValue: '\x1bOH' },
  { label: 'PgUp', value: PAGE_UP },
  { label: 'PgDn', value: PAGE_DOWN },
  { label: 'End', value: '\x1b[F', appValue: '\x1bOF' },
]

export const ESC_KEY: AuxKey = { label: 'Esc', value: '\x1b' }
export const TAB_KEY: AuxKey = { label: 'Tab', value: '\t' }
export const ENTER_KEY: AuxKey = {
  label: '↵',
  value: '\r',
  ariaLabel: 'Enter',
}

// Full-screen programs such as htop enable DECCKM (CSI ? 1 h) and then expect
// the application form of the cursor keys. Sending the normal form leaves them
// receiving a bare Escape, so resolve it at send time like xterm's own handler.
export function resolveAuxKey(key: AuxKey, applicationCursorKeys: boolean) {
  return applicationCursorKeys && key.appValue ? key.appValue : key.value
}

const shiftedSequences: Record<string, string> = {
  '\r': '\n',
  '\t': '\x1b[Z',
  '\x1b[A': '\x1b[1;2A',
  '\x1bOA': '\x1b[1;2A',
  '\x1b[B': '\x1b[1;2B',
  '\x1bOB': '\x1b[1;2B',
  '\x1b[D': '\x1b[1;2D',
  '\x1bOD': '\x1b[1;2D',
  '\x1b[C': '\x1b[1;2C',
  '\x1bOC': '\x1b[1;2C',
  '\x1b[H': '\x1b[1;2H',
  '\x1bOH': '\x1b[1;2H',
  '\x1b[F': '\x1b[1;2F',
  '\x1bOF': '\x1b[1;2F',
  '\x1b[5~': '\x1b[5;2~',
  '\x1b[6~': '\x1b[6;2~',
}

// Sticky Shift modifies supported terminal keys and uppercases one ASCII letter.
export function applyStickyShift(data: string) {
  if (Object.hasOwn(shiftedSequences, data)) return shiftedSequences[data]
  if (data.length === 1 && data >= 'a' && data <= 'z') return data.toUpperCase()
  return data
}

// Sticky Ctrl: the next latin letter becomes the matching control character.
export function toControlCharacter(data: string): string | null {
  if (data.length !== 1) return null
  const code = data.toUpperCase().charCodeAt(0)
  if (code < 65 || code > 90) return null
  return String.fromCharCode(code & 0x1f)
}
