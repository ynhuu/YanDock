package session

import (
	"strconv"
	"strings"
)

// cursorModeTracker retains interaction modes, not screen contents. It observes every
// PTY read, including output discarded while disconnected. Parser storage is
// bounded and sequences may span reads. Strings must be skipped so terminal
// titles and DCS payloads cannot accidentally change the tracked mode.
type cursorModeTracker struct {
	application bool
	alternate   bool
	mouse       int
	encoding    int
	bracketed   bool
	state       byte
	params      [64]byte
	length      int
	overflow    bool
	osc         bool
	c1Prefix    bool
}

const (
	cursorGround byte = iota
	cursorEscape
	cursorEscapeIntermediate
	cursorCSI
	cursorString
	cursorStringEscape
)

func (m *cursorModeTracker) consume(data []byte) {
	for _, b := range data {
		// UTF-8 encoded C1 controls are interpreted by xterm as well. In
		// particular, never consider a point inside an OSC/DCS string safe.
		if m.c1Prefix {
			m.c1Prefix = false
			if b == 0x9c && (m.state == cursorString || m.state == cursorStringEscape) {
				m.state = cursorGround
				continue
			}
			if m.state != cursorString && m.state != cursorStringEscape {
				switch b {
				case 0x9b:
					m.state = cursorCSI
					m.length, m.overflow = 0, false
					continue
				case 0x9d, 0x90, 0x98, 0x9e, 0x9f:
					m.state, m.osc = cursorString, b == 0x9d
					continue
				}
			}
		}
		if b == 0xc2 {
			m.c1Prefix = true
		}
		if b == 0x18 || b == 0x1a { // CAN / SUB cancel the current sequence.
			m.state = cursorGround
			continue
		}
		if m.state == cursorString || m.state == cursorStringEscape {
			if (m.osc && b == 7) || (m.state == cursorStringEscape && b == '\\') {
				m.state = cursorGround
			} else if b == 0x1b {
				m.state = cursorStringEscape
			} else {
				m.state = cursorString
			}
			continue
		}
		if b == 0x1b {
			m.state = cursorEscape
			continue
		}
		if b < 0x20 || b == 0x7f {
			continue
		}
		switch m.state {
		case cursorEscape:
			switch b {
			case '[':
				m.state = cursorCSI
				m.length, m.overflow = 0, false
			case ']', 'P', 'X', '^', '_':
				m.state, m.osc = cursorString, b == ']'
			case 'c': // RIS resets all tracked modes.
				m.application = false
				m.alternate, m.bracketed = false, false
				m.mouse, m.encoding = 0, 0
				m.state = cursorGround
			default:
				// Intermediate bytes belong to this escape sequence.
				if b >= 0x20 && b <= 0x2f {
					m.state = cursorEscapeIntermediate
				} else {
					m.state = cursorGround
				}
			}
		case cursorEscapeIntermediate:
			if b < 0x20 || b > 0x2f {
				m.state = cursorGround
			}
		case cursorCSI:
			if b >= 0x40 && b <= 0x7e {
				if !m.overflow {
					m.finish(b)
				}
				m.state = cursorGround
			} else if m.length < len(m.params) {
				m.params[m.length] = b
				m.length++
			} else {
				m.overflow = true
			}
		}
	}
}

func (m *cursorModeTracker) finish(final byte) {
	params := string(m.params[:m.length])
	if final == 'p' && params == "!" { // DECSTR soft reset.
		m.application = false
		m.bracketed = false
		return
	}
	if (final != 'h' && final != 'l') || len(params) < 2 || params[0] != '?' {
		return
	}
	// Accept leading zeros, but not subparameters or intermediate bytes.
	for _, b := range params[1:] {
		if b != ';' && (b < '0' || b > '9') {
			return
		}
	}
	number, hasDigit := 0, false
	enabled := final == 'h'
	for _, b := range params[1:] + ";" {
		if b == ';' {
			if hasDigit {
				switch number {
				case 1:
					m.application = enabled
				case 47, 1047, 1049:
					m.alternate = enabled
				case 9, 1000, 1002, 1003:
					m.mouse = 0
					if enabled {
						m.mouse = number
					}
				case 1005, 1006, 1015, 1016:
					m.encoding = 0
					if enabled {
						m.encoding = number
					}
				case 2004:
					m.bracketed = enabled
				}
			}
			number, hasDigit = 0, false
		} else { // The complete parameter list was validated above.
			number = min(10000, number*10+int(b-'0'))
			hasDigit = true
		}
	}
}

func (m *cursorModeTracker) restore() []byte {
	var out strings.Builder
	out.WriteString("\x18\x1b[?1l\x1b[?9;1000;1002;1003;1005;1006;1015;1016;2004l")
	if m.application {
		out.WriteString("\x1b[?1h")
	}
	if m.alternate {
		// Switch buffers without 1049's save-cursor/clear-screen side effects.
		out.WriteString("\x1b[?47h")
	} else {
		out.WriteString("\x1b[?47l")
	}
	for _, mode := range []int{m.mouse, m.encoding} {
		if mode != 0 {
			out.WriteString("\x1b[?" + strconv.Itoa(mode) + "h")
		}
	}
	if m.bracketed {
		out.WriteString("\x1b[?2004h")
	}
	return []byte(out.String())
}
