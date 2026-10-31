package session

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"testing"
	"time"
)

func newTestManager(t *testing.T, args ...string) *Manager {
	t.Helper()
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(sh, args, t.TempDir())
	t.Cleanup(m.Close)
	return m
}

func readUntil(t *testing.T, output <-chan []byte, marker string) []byte {
	t.Helper()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	var all []byte
	for {
		select {
		case data, ok := <-output:
			if !ok {
				t.Fatalf("stream ended before %q", marker)
			}
			all = append(all, data...)
			if bytes.Contains(all, []byte(marker)) {
				return all
			}
		case <-timer.C:
			t.Fatalf("output timeout for %q", marker)
		}
	}
}

func TestPTYUsesUTF8CharacterLocale(t *testing.T) {
	t.Setenv("LANG", "")
	t.Setenv("LC_CTYPE", "C")
	t.Setenv("LC_ALL", "C")

	m := newTestManager(t)
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	output, _, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if err := s.Write([]byte("locale charmap\n")); err != nil {
		t.Fatal(err)
	}
	if data := readUntil(t, output, "UTF-8"); !bytes.Contains(data, []byte("UTF-8")) {
		t.Fatalf("PTY character encoding is not UTF-8: %q", data)
	}
}

func TestInputResizeDetachAndClose(t *testing.T) {
	m := newTestManager(t)
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	output, _, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := s.Attach(); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate controller accepted")
	}
	// Concurrent sessions are independent and have no application-level count limit.
	other, err := m.Create(80, 24)
	if err != nil {
		t.Fatalf("second session rejected: %v", err)
	}
	if !other.Info().Running || len(m.List()) != 2 {
		t.Fatal("second session not tracked")
	}
	if !m.Remove(other.Info().ID) || len(m.List()) != 1 {
		t.Fatal("remove did not drop the session")
	}
	if err := s.Resize(100, 30); err != nil {
		t.Fatal(err)
	}
	if err := s.Write([]byte("stty size\nprintf '\\344\\270\\255\\346\\226\\207\\n'\n")); err != nil {
		t.Fatal(err)
	}
	data := readUntil(t, output, "中文")
	if !bytes.Contains(data, []byte("30 100")) {
		t.Fatalf("resize missing: %q", data)
	}
	detach()
	if !s.Info().Running {
		t.Fatal("disconnect killed session")
	}
	output, _, detach, err = s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if err := s.Write([]byte("printf '\\122\\105\\103\\117\\116\\116\\105\\103\\124\\n'\n")); err != nil {
		t.Fatal(err)
	}
	readUntil(t, output, "RECONNECT")
	if !m.Remove(s.id) {
		t.Fatal("remove failed")
	}
	if s.Info().Running {
		t.Fatal("close did not stop process")
	}
	if err := s.Write([]byte("x")); !errors.Is(err, ErrStopped) {
		t.Fatal("ended process accepted input")
	}
}

func TestFailureAndValidation(t *testing.T) {
	m := NewManager("/not/a/program", nil, t.TempDir())
	if _, err := m.Create(80, 24); err == nil {
		t.Fatal("missing program accepted")
	}
	if len(m.List()) != 0 {
		t.Fatal("failed start leaked session")
	}
	if _, err := m.Create(0, 24); err == nil {
		t.Fatal("invalid size accepted")
	}
	m.Close()
	if _, err := m.Create(80, 24); !errors.Is(err, ErrStopped) {
		t.Fatal("closed manager started process")
	}
}

func TestCreateManySessions(t *testing.T) {
	m := newTestManager(t)
	const count = 10
	for i := 0; i < count; i++ {
		if _, err := m.Create(80, 24); err != nil {
			t.Fatalf("session %d: %v", i+1, err)
		}
	}
	if len(m.List()) != count {
		t.Fatalf("unexpected list length %d", len(m.List()))
	}
	original := m.List()
	for _, index := range []int{1, 4} {
		if !m.Remove(original[index].ID) {
			t.Fatal("remove failed")
		}
	}
	for _, want := range []int{2, 5} {
		s, err := m.Create(80, 24)
		if err != nil {
			t.Fatalf("create after remove: %v", err)
		}
		if s.Info().Seq != want || s.Info().ID == original[want-1].ID {
			t.Fatalf("expected reused label %d with a new ID, got %+v", want, s.Info())
		}
	}
	for _, info := range original {
		if s := m.Get(info.ID); s != nil && s.Info().Seq != info.Seq {
			t.Fatal("existing label changed")
		}
	}
	if len(m.List()) != count {
		t.Fatalf("unexpected list length after replacement %d", len(m.List()))
	}
}

func TestCreateWithSparseLabels(t *testing.T) {
	m := newTestManager(t)
	var sessions []*Session
	for range 6 {
		s, err := m.Create(80, 24)
		if err != nil {
			t.Fatal(err)
		}
		sessions = append(sessions, s)
	}
	// Keep only the highest label, beyond the next allocation's search range.
	for _, s := range sessions[:5] {
		if !m.Remove(s.id) {
			t.Fatal("remove failed")
		}
	}
	for want := 1; want <= 5; want++ {
		s, err := m.Create(80, 24)
		if err != nil {
			t.Fatal(err)
		}
		if s.Info().Seq != want {
			t.Fatalf("expected label %d, got %d", want, s.Info().Seq)
		}
	}
	if sessions[5].Info().Seq != 6 {
		t.Fatal("existing label changed")
	}
}

func TestCursorModeChangesWhileDetached(t *testing.T) {
	m := newTestManager(t)
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	output, _, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { detach() }()
	if err := s.Write([]byte("printf '\\033[?1hMODE_READY\\n'\n")); err != nil {
		t.Fatal(err)
	}
	readUntil(t, output, "MODE_READY\r\n")
	for _, application := range []bool{false, true} {
		detach()
		sequence := "\\033[?1l"
		if application {
			sequence = "\\033[?1h"
		}
		if err := s.Write([]byte("printf '" + sequence + "'\n")); err != nil {
			t.Fatal(err)
		}
		timer := time.NewTimer(5 * time.Second)
		for {
			s.mu.Lock()
			ready := s.cursorMode.application == application
			s.mu.Unlock()
			if ready {
				break
			}
			select {
			case <-timer.C:
				t.Fatal("mode did not change while detached")
			default:
				runtime.Gosched()
			}
		}
		timer.Stop()
		var replay Replay
		output, replay, detach, err = s.Attach()
		if err != nil {
			t.Fatal(err)
		}
		var restored cursorModeTracker
		restored.consume(replayBytes(replay))
		if restored.application != application {
			t.Fatalf("restored application cursor mode = %v, want %v", restored.application, application)
		}
	}
}

func TestNaturalExit(t *testing.T) {
	m := newTestManager(t)
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	output, _, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if err := s.Write([]byte("printf '\\106\\111\\116\\101\\114\\n'; exit\n")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-s.done:
	case <-time.After(5 * time.Second):
		t.Fatal("natural exit leaked resources")
	}
	if s.Info().Running {
		t.Fatal("natural exit still running")
	}
	var final []byte
	for data := range output {
		final = append(final, data...)
	}
	if !bytes.Contains(final, []byte("FINAL")) {
		t.Fatalf("final output lost: %q", final)
	}
}

func TestSlowClientBackpressureCanDetachAndReconnect(t *testing.T) {
	m := newTestManager(t, "-c", "read line; while :; do printf '12345678901234567890'; done")
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	output, _, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if err := s.Write([]byte("go\n")); err != nil {
		t.Fatal(err)
	}
	// Wait until the bounded queue fills; a slow writer must not close it.
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for {
		if len(output) == outputQueueSize {
			break
		}
		runtime.Gosched()
		select {
		case <-s.done:
			t.Fatal("producer exited")
		case <-timer.C:
			t.Fatal("output queue did not fill")
		default:
		}
	}
	if len(output) > outputQueueSize {
		t.Fatal("output queue exceeded its bound")
	}
	if _, _, _, err := s.Attach(); !errors.Is(err, ErrConflict) {
		t.Fatal("overflow prematurely released controller")
	}
	if !s.Info().Running {
		t.Fatal("slow client killed process")
	}
	detach()
	output, _, detach, err = s.Attach()
	if err != nil {
		t.Fatalf("reattach after blocked output: %v", err)
	}
	defer detach()
	readUntil(t, output, "1234567890")
}

func TestCloseReleasesReaderBlockedByFullOutputQueue(t *testing.T) {
	m := newTestManager(t, "-c", "read line; while :; do printf '12345678901234567890'; done")
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	output, _, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if err := s.Write([]byte("go\n")); err != nil {
		t.Fatal(err)
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for len(output) != outputQueueSize {
		select {
		case <-s.done:
			t.Fatal("producer exited before filling the output queue")
		case <-timer.C:
			t.Fatal("output queue did not fill")
		default:
			runtime.Gosched()
		}
	}
	s.Close()
	select {
	case <-s.done:
	case <-time.After(5 * time.Second):
		t.Fatal("close did not release the blocked PTY reader")
	}
}

func TestFullOutputQueueBlocksReaderUntilConsumed(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	defer reader.Close()
	queue := make(chan []byte, 1)
	queue <- []byte("queued")
	s := &Session{
		pty:          reader,
		output:       queue,
		outputDone:   make(chan struct{}),
		outputActive: true,
		readerDone:   make(chan struct{}),
	}
	go s.read()
	if _, err := writer.Write([]byte("next")); err != nil {
		t.Fatal(err)
	}
	_ = writer.Close()
	if got := string(<-queue); got != "queued" {
		t.Fatalf("first output = %q", got)
	}
	select {
	case got, ok := <-queue:
		if !ok || string(got) != "next" {
			t.Fatalf("output after backpressure = %q, open=%v", got, ok)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("blocked output was not delivered after queue space became available")
	}
	select {
	case <-s.readerDone:
	case <-time.After(5 * time.Second):
		t.Fatal("reader did not finish after the pipe closed")
	}
}

func TestStartupOutputAndInputLimits(t *testing.T) {
	m := newTestManager(t, "-c", "printf 'STARTUP_READY\\n'; read line")
	s, err := m.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		s.mu.Lock()
		ready := bytes.Contains(replayBytes(s.replay.snapshot(s.cursorMode)), []byte("STARTUP_READY"))
		s.mu.Unlock()
		if ready {
			break
		}
		runtime.Gosched()
		select {
		case <-deadline.C:
			t.Fatal("startup output not buffered")
		default:
		}
	}
	_, replay, detach, err := s.Attach()
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if !bytes.Contains(replayBytes(replay), []byte("STARTUP_READY")) {
		t.Fatal("startup output not replayed")
	}
	if err := s.Write(make([]byte, 8193)); err == nil {
		t.Fatal("oversized input accepted")
	}
	if err := s.Resize(501, 24); err == nil {
		t.Fatal("oversized resize accepted")
	}
}
