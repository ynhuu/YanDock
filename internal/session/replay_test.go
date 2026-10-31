package session

import (
	"bytes"
	"os"
	"runtime"
	"testing"
	"time"
	"unicode/utf8"
)

func replayBytes(replay Replay) []byte {
	data := append([]byte(nil), replay.Modes...)
	for _, frame := range replay.Frames {
		data = append(data, frame.Data...)
	}
	return data
}

func appendReplay(h *replayLog, mode *cursorModeTracker, data []byte) {
	before := *mode
	mode.consume(data)
	h.append(data, before, *mode)
}

func TestReplayRetentionBoundariesAndImmutableSnapshot(t *testing.T) {
	h := replayLog{cols: 80, rows: 24}
	var mode cursorModeTracker
	appendReplay(&h, &mode, []byte("first\r\n"))
	old := h.snapshot(mode)
	appendReplay(&h, &mode, []byte("second\r\n"))
	if bytes.Contains(replayBytes(old), []byte("second")) {
		t.Fatal("snapshot mutated after append")
	}
	for i := 0; i < 100; i++ {
		appendReplay(&h, &mode, bytes.Repeat([]byte("中"), 1400))
	}
	snapshot := h.snapshot(mode)
	if !snapshot.Truncated || h.bytes > maxReplayBytes || h.frames > maxReplayFrames {
		t.Fatalf("unbounded replay: %d bytes, %d frames", h.bytes, h.frames)
	}
	if !utf8.Valid(replayBytes(snapshot)) {
		t.Fatal("retention split UTF-8")
	}
	if bytes.Contains(replayBytes(snapshot), []byte("first")) {
		t.Fatal("old output not evicted")
	}
}

func TestReplaySplitANSIAndUTF8(t *testing.T) {
	h := replayLog{cols: 80, rows: 24}
	var mode cursorModeTracker
	data := []byte("\x1b[31m中文\x1b[0m\r\n\x1b]0;title\a")
	for _, b := range data {
		appendReplay(&h, &mode, []byte{b})
	}
	if !bytes.Equal(replayBytes(h.snapshot(mode)), append((&cursorModeTracker{}).restore(), data...)) {
		t.Fatal("split output changed")
	}
	appendReplay(&h, &mode, []byte("\x1b[?1049hFULL"))
	h.resize(100, 30, mode)
	appendReplay(&h, &mode, []byte("\x1b[2;3Hlive"))
	found := false
	for _, frame := range h.snapshot(mode).Frames {
		if frame.Cols == 100 && frame.Rows == 30 {
			found = true
		}
	}
	if !found {
		t.Fatal("resize history missing")
	}
}

func TestReplayOversizedControlAndResizeBounds(t *testing.T) {
	h := replayLog{cols: 80, rows: 24}
	var mode cursorModeTracker
	appendReplay(&h, &mode, []byte("\x1b]0;"))
	for i := 0; i < 80; i++ {
		appendReplay(&h, &mode, bytes.Repeat([]byte("x"), 4096))
	}
	snapshot := h.snapshot(mode)
	if got := snapshot.FilterLive([]byte("hidden control payload")); len(got) != 0 {
		t.Fatal("control-string payload became visible")
	}
	if got := snapshot.FilterLive([]byte("\aSAFE")); string(got) != "SAFE" {
		t.Fatalf("live resync = %q", got)
	}
	appendReplay(&h, &mode, []byte("\a"))
	appendReplay(&h, &mode, []byte("SAFE"))
	if !h.truncated || !bytes.Contains(replayBytes(h.snapshot(mode)), []byte("SAFE")) {
		t.Fatal("did not recover after oversized OSC")
	}
	for i := 0; i < 2000; i++ {
		h.resize(uint16(80+i%2), 24, mode)
	}
	if h.frames > maxReplayFrames || h.bytes > maxReplayBytes {
		t.Fatal("resize history unbounded")
	}
}

func TestReplayAttachBoundaryDetachedOutputAndFinishedProcess(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	s := &Session{running: true, pty: reader, replay: replayLog{cols: 80, rows: 24}, readerDone: make(chan struct{})}
	go s.read()
	waitFor := func(marker string) {
		deadline := time.NewTimer(5 * time.Second)
		defer deadline.Stop()
		for {
			s.mu.Lock()
			found := bytes.Contains(replayBytes(s.replay.snapshot(s.cursorMode)), []byte(marker))
			s.mu.Unlock()
			if found {
				return
			}
			select {
			case <-deadline.C:
				t.Fatalf("output %q not retained", marker)
			default:
				runtime.Gosched()
			}
		}
	}
	if _, err := writer.Write([]byte("BEFORE")); err != nil {
		t.Fatal(err)
	}
	waitFor("BEFORE")
	live, snapshot, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Fresh {
		t.Fatal("first startup was treated as historical queries")
	}
	s.ConfirmAttach(live)
	if !bytes.Contains(replayBytes(snapshot), []byte("BEFORE")) {
		t.Fatal("startup history missing")
	}
	if _, err := writer.Write([]byte("LIVE")); err != nil {
		t.Fatal(err)
	}
	select {
	case data := <-live:
		if string(data) != "LIVE" {
			t.Fatalf("history duplicated into live output: %q", data)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("live output missing")
	}
	detach()
	if _, err := writer.Write([]byte("DETACHED")); err != nil {
		t.Fatal(err)
	}
	waitFor("DETACHED")
	live, snapshot, detach, err = s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Fresh {
		t.Fatal("reattach skipped restoration")
	}
	if !bytes.Contains(replayBytes(snapshot), []byte("BEFORELIVEDETACHED")) || len(live) != 0 {
		t.Fatal("detach output lost or boundary duplicated")
	}
	detach()
	writer.Close()
	<-s.readerDone
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
	live, snapshot, detach, err = s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if _, open := <-live; open {
		t.Fatal("finished stream was not closed")
	}
	if !bytes.Contains(replayBytes(snapshot), []byte("DETACHED")) {
		t.Fatal("finished screen not retained")
	}
}

func TestReplayUTF8C1ControlStringBoundary(t *testing.T) {
	h := replayLog{cols: 80, rows: 24}
	var mode cursorModeTracker
	appendReplay(&h, &mode, []byte("\xc2\x9d0;"))
	for i := 0; i < 80; i++ {
		appendReplay(&h, &mode, bytes.Repeat([]byte("payload"), 600))
	}
	snapshot := h.snapshot(mode)
	if !snapshot.Truncated {
		t.Fatal("oversized C1 OSC was not bounded")
	}
	if got := snapshot.FilterLive([]byte("hidden\xc2")); len(got) != 0 {
		t.Fatal("C1 payload leaked")
	}
	if got := snapshot.FilterLive([]byte("\x9cVISIBLE")); string(got) != "VISIBLE" {
		t.Fatalf("C1 recovery = %q", got)
	}
}

func TestFailedAttachDoesNotConsumeFreshStartup(t *testing.T) {
	s := &Session{running: true, replay: replayLog{cols: 80, rows: 24}}
	old, first, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	if !first.Fresh {
		t.Fatal("first startup not fresh")
	}
	detach() // HTTP upgrade failed before hello could be delivered.
	_, retry, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	if !retry.Fresh {
		t.Fatal("failed handshake consumed first-start terminal queries")
	}
	s.ConfirmAttach(old) // A released controller cannot confirm its successor.
	detach()
	current, retry, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	if !retry.Fresh {
		t.Fatal("stale confirmation affected new controller")
	}
	s.ConfirmAttach(current)
	detach()
	_, next, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if next.Fresh {
		t.Fatal("delivered hello did not enable recovery on reconnect")
	}
}

func TestReplayResizeCannotExceedFrameLimitInsideControlString(t *testing.T) {
	h := replayLog{cols: 80, rows: 24}
	var mode cursorModeTracker
	h.resize(81, 24, mode)
	appendReplay(&h, &mode, []byte("\x1b]0;"))
	for i := 0; i < 255; i++ {
		h.resize(uint16(82+i%2), 24, mode)
		appendReplay(&h, &mode, []byte("x"))
	}
	h.resize(84, 24, mode)
	if h.frames > maxReplayFrames || len(h.snapshot(mode).Frames) > maxReplayFrames {
		t.Fatalf("resize exceeded frame bound: %d", h.frames)
	}
}
