package session

// Replay storage is bounded per session and never written to disk. Segments
// end only outside ANSI strings/sequences and UTF-8 code points, so eviction
// cannot expose a control-string payload or split the first restored rune.
const maxReplayBytes = 32 << 10
const maxReplayFrames = 512
const replaySegmentBytes = 4096

type ReplayFrame struct {
	Data []byte
	Cols uint16
	Rows uint16
}

type Replay struct {
	Frames     []ReplayFrame
	Modes      []byte
	Cols, Rows uint16
	Truncated  bool
	Fresh      bool
	skipMode   *cursorModeTracker
	skipUTF8   int
}

type replaySegment struct {
	frames     []ReplayFrame
	bytes      int
	cols, rows uint16
	mode       cursorModeTracker
}

type replayLog struct {
	segments            []replaySegment
	pending             replaySegment
	bytes, frames       int
	cols, rows          uint16
	utf8Pending         int
	truncated, dropping bool
}

func (h *replayLog) begin(mode cursorModeTracker) {
	if h.pending.frames == nil {
		h.pending.cols, h.pending.rows, h.pending.mode = h.cols, h.rows, mode
	}
}

func (h *replayLog) append(data []byte, before, after cursorModeTracker) {
	for _, b := range data {
		h.utf8Pending = advanceUTF8(h.utf8Pending, b)
	}

	safe := after.state == cursorGround && h.utf8Pending == 0
	if h.dropping {
		h.dropping = !safe
		return
	}
	h.begin(before)
	last := len(h.pending.frames) - 1
	if last >= 0 && h.pending.frames[last].Cols == 0 && len(h.pending.frames[last].Data)+len(data) <= replaySegmentBytes {
		h.pending.frames[last].Data = append(h.pending.frames[last].Data, data...)
	} else {
		h.pending.frames = append(h.pending.frames, ReplayFrame{Data: append([]byte(nil), data...)})
		h.frames++
	}
	h.pending.bytes += len(data)
	h.bytes += len(data)
	h.boundPending(safe)

	if safe && (h.pending.bytes >= replaySegmentBytes || h.bytes > maxReplayBytes || h.frames > maxReplayFrames) {
		h.flush()
	}
	h.trim()
}

func (h *replayLog) resize(cols, rows uint16, mode cursorModeTracker) {
	if h.cols == cols && h.rows == rows {
		return
	}
	if !h.dropping {
		if mode.state == cursorGround && h.utf8Pending == 0 {
			h.flush()
		}
		h.begin(mode)
		last := len(h.pending.frames) - 1
		if last >= 0 && h.pending.frames[last].Cols != 0 {
			h.pending.frames[last] = ReplayFrame{Cols: cols, Rows: rows}
		} else {
			h.pending.frames = append(h.pending.frames, ReplayFrame{Cols: cols, Rows: rows})
			h.frames++
		}
	}
	h.cols, h.rows = cols, rows
	h.boundPending(mode.state == cursorGround && h.utf8Pending == 0)
	h.trim()
}

func (h *replayLog) boundPending(safe bool) {
	if h.pending.bytes > maxReplayBytes || len(h.pending.frames) > maxReplayFrames {
		// An unterminated or oversized control string cannot be cut safely.
		// Drop the prefix as well, then resume at the next safe boundary;
		// this avoids joining text across an unknown terminal-state gap.
		h.segments = nil
		h.bytes, h.frames = 0, 0
		h.pending = replaySegment{}
		h.truncated, h.dropping = true, !safe
	}
}

func (h *replayLog) flush() {
	if len(h.pending.frames) == 0 {
		return
	}
	h.segments = append(h.segments, h.pending)
	h.pending = replaySegment{}
}

func (h *replayLog) trim() {
	for len(h.segments) > 0 && (h.bytes > maxReplayBytes || h.frames > maxReplayFrames) {
		first := h.segments[0]
		h.bytes -= first.bytes
		h.frames -= len(first.frames)
		h.segments[0] = replaySegment{}
		h.segments = h.segments[1:]
		h.truncated = true
	}
}

// Caller holds Session.mu. Data slices are immutable after append; copy only
// frame headers so a snapshot remains independent of future retention/eviction.
func (h *replayLog) snapshot(mode cursorModeTracker) Replay {
	r := Replay{Cols: h.cols, Rows: h.rows, Truncated: h.truncated, Frames: make([]ReplayFrame, 0, h.frames)}
	if h.dropping {
		copy := mode
		r.skipMode = &copy
		r.skipUTF8 = h.utf8Pending
	}
	if len(h.segments) > 0 {
		first := h.segments[0]
		r.Cols, r.Rows, mode = first.cols, first.rows, first.mode
	} else if len(h.pending.frames) > 0 {
		r.Cols, r.Rows, mode = h.pending.cols, h.pending.rows, h.pending.mode
	}
	r.Modes = mode.restore()
	for _, segment := range h.segments {
		r.Frames = append(r.Frames, segment.frames...)
	}
	r.Frames = append(r.Frames, h.pending.frames...)
	return r
}

// FilterLive skips the unfinished tail of an oversized sequence that could not
// be retained. Never render an OSC/DCS payload as visible text after eviction.
// Only the connection writer uses this snapshot-local parser.
func (r *Replay) FilterLive(data []byte) []byte {
	if r.skipMode == nil {
		return data
	}
	for i, b := range data {
		r.skipMode.consume(data[i : i+1])
		r.skipUTF8 = advanceUTF8(r.skipUTF8, b)
		if r.skipMode.state == cursorGround && r.skipUTF8 == 0 {
			r.skipMode = nil
			return data[i+1:]
		}
	}
	return nil
}

func advanceUTF8(pending int, b byte) int {
	if pending > 0 && b&0xc0 == 0x80 {
		return pending - 1
	}
	switch {
	case b >= 0xc2 && b <= 0xdf:
		return 1
	case b >= 0xe0 && b <= 0xef:
		return 2
	case b >= 0xf0 && b <= 0xf4:
		return 3
	default:
		return 0
	}
}
