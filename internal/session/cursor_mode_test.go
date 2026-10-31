package session

import (
	"strings"
	"testing"
)

func TestCursorModeTracking(t *testing.T) {
	for _, tc := range []struct {
		name string
		data string
		want bool
	}{
		{"enable", "\x1b[?1h", true},
		{"disable", "\x1b[?1h\x1b[?1l", false},
		{"multiple parameters", "\x1b[?25;0001;1049h", true},
		{"other mode", "\x1b[?1001h", false},
		{"nonprivate", "\x1b[1h", false},
		{"soft reset", "\x1b[?1h\x1b[!p", false},
		{"hard reset", "\x1b[?1h\x1bc", false},
		{"charset is not reset", "\x1b[?1h\x1b(c", true},
		{"OSC payload", "\x1b]0;\x1b[?1h\x07", false},
		{"DCS payload", "\x1bP\x1b[?1h\x1b\\", false},
		{"after string", "\x1b]title\x1b\\\x1b[?1h", true},
		{"cancelled", "\x1b[?1\x18h", false},
		{"invalid suffix", "\x1b[?1:2h", false},
		{"overflow recovers", "\x1b[?" + strings.Repeat("9", 1000) + "h\x1b[?1h", true},
		{"UTF-8 text", "中文\x1b[?1h中文", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Every split must produce the same result as one complete read.
			for split := 0; split <= len(tc.data); split++ {
				var mode cursorModeTracker
				mode.consume([]byte(tc.data[:split]))
				mode.consume([]byte(tc.data[split:]))
				if mode.application != tc.want {
					t.Fatalf("split %d: got %v, want %v", split, mode.application, tc.want)
				}
			}
			var mode cursorModeTracker
			for i := range len(tc.data) {
				mode.consume([]byte(tc.data[i : i+1]))
			}
			if mode.application != tc.want {
				t.Fatalf("bytewise: got %v, want %v", mode.application, tc.want)
			}
		})
	}
}

func TestAttachRestoresCursorMode(t *testing.T) {
	s := &Session{running: true}
	_, _, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	detach()
	for _, tc := range []struct {
		output string
		want   string
	}{
		{"\x1b[?1h", "\x18\x1b[?1h"},
		{"\x1b[?1l", "\x18\x1b[?1l"},
	} {
		// Output observed while no browser is attached still changes the mode.
		s.cursorMode.consume([]byte(tc.output))
		_, replay, detach, err := s.Attach()
		if err != nil {
			t.Fatal(err)
		}
		if got := string(replayBytes(replay)); !strings.Contains(got, tc.want[1:]) {
			t.Fatalf("restore = %q, want %q", got, tc.want)
		}
		detach()
	}
}

func TestReconnectRestoresInteractionModes(t *testing.T) {
	data := "\x1b[?1049;1000;1006;2004h"
	for split := 0; split <= len(data); split++ {
		s := &Session{running: true}
		_, _, detach, err := s.Attach()
		if err != nil {
			t.Fatal(err)
		}
		detach()
		s.cursorMode.consume([]byte(data[:split]))
		s.cursorMode.consume([]byte(data[split:]))
		_, replay, detach, err := s.Attach()
		if err != nil {
			t.Fatal(err)
		}
		var restored cursorModeTracker
		restored.consume(replayBytes(replay))
		detach()
		if !restored.alternate || restored.mouse != 1000 || restored.encoding != 1006 || !restored.bracketed {
			t.Fatalf("split %d: incorrect restored modes: %+v", split, restored)
		}
		s.cursorMode.consume([]byte("\x1b[?1049;1000;1006;2004l"))
		restored.consume(s.cursorMode.restore())
		if restored.alternate || restored.mouse != 0 || restored.encoding != 0 || restored.bracketed {
			t.Fatalf("modes not reset: %+v", restored)
		}
	}
}

func TestInteractionModesRejectInvalidParametersAndReset(t *testing.T) {
	var mode cursorModeTracker
	mode.consume([]byte("\x1b[?1;1049;1000;1006;2004h"))
	before := mode.restore()
	// A valid prefix must not partially apply when the suffix is invalid.
	mode.consume([]byte("\x1b[?1;1049;1000;1006;2004:1l"))
	if got := mode.restore(); string(got) != string(before) {
		t.Fatalf("invalid sequence changed interaction modes: %q", got)
	}
	mode.consume([]byte("\x1bc"))
	if mode.application || mode.alternate || mode.mouse != 0 || mode.encoding != 0 || mode.bracketed {
		t.Fatalf("RIS did not reset interaction modes: %+v", mode)
	}
}

func TestSoftResetClearsCoreModesButRetainsMouseAndScreenModes(t *testing.T) {
	var mode cursorModeTracker
	mode.consume([]byte("\x1b[?1;1049;1000;1006;2004h\x1b[!p"))
	if mode.application || mode.bracketed {
		t.Fatalf("soft reset retained core modes: %+v", mode)
	}
	if !mode.alternate || mode.mouse != 1000 || mode.encoding != 1006 {
		t.Fatalf("soft reset changed buffer or mouse modes: %+v", mode)
	}
}
