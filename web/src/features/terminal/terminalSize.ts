import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

export const terminalOptions = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  scrollback: 1000,
  lineHeight: 1,
  letterSpacing: 0,
  customGlyphs: true,
  allowProposedApi: false,
} satisfies ITerminalOptions

// Measure with the same engine and layout as the real terminal before the PTY
// starts. Estimating character width would bring the startup resize race back.
export function measureTerminalSize(
  container: HTMLElement,
  fontSize: number,
  auxiliaryKeys: boolean,
) {
  const probe = document.createElement('div')
  probe.className =
    'pointer-events-none invisible absolute inset-0 flex flex-col'
  probe.setAttribute('aria-hidden', 'true')
  const content = document.createElement('div')
  content.className = 'terminal-content'
  const host = document.createElement('div')
  host.className = 'terminal-host'
  content.append(host)
  probe.append(content)
  if (auxiliaryKeys) {
    const bar = document.createElement('div')
    bar.className = 'aux-bar'
    // Only the height matters; reuse the real key/track styles, not a px guess.
    bar.innerHTML = '<div class="aux-track"><span class="aux-key"></span></div>'
    probe.append(bar)
  }
  const terminal = new Terminal({ ...terminalOptions, fontSize })
  try {
    container.append(probe)
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    const webgl = new WebglAddon()
    try {
      terminal.loadAddon(webgl)
    } catch {
      webgl.dispose()
    }
    const size = fit.proposeDimensions()
    if (!size || !host.clientWidth || !host.clientHeight)
      throw new Error('终端区域尚未就绪，请稍后重试')
    return {
      cols: Math.min(500, Math.max(2, size.cols)),
      rows: Math.min(300, Math.max(2, size.rows)),
    }
  } finally {
    try {
      terminal.dispose()
    } finally {
      probe.remove()
    }
  }
}
