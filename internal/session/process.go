package session

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// startSession transfers the child process and PTY to the returned session.
// The manager registers it before starting the reader and waiter goroutines.
func startSession(id, program string, args []string, dir string, cols, rows uint16) (*Session, error) {
	cmd := exec.Command(program, args...)
	cmd.Dir = dir
	cmd.Env = terminalEnvironment(os.Environ(), runtime.GOOS)
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return nil, fmt.Errorf("启动终端: %w", err)
	}
	// A pollable descriptor lets closing the PTY interrupt blocked reads/writes.
	fd, err := syscall.Dup(int(f.Fd()))
	if err == nil {
		err = syscall.SetNonblock(fd, true)
	}
	if err != nil {
		if fd >= 0 {
			_ = syscall.Close(fd)
		}
		_ = f.Close()
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Wait()
		return nil, fmt.Errorf("配置终端: %w", err)
	}
	syscall.CloseOnExec(fd)
	pollable := os.NewFile(uintptr(fd), "pty")
	_ = f.Close()
	return &Session{id: id, cmd: cmd, cwd: dir, pty: pollable, running: true, replay: replayLog{cols: cols, rows: rows}, done: make(chan struct{}), readerDone: make(chan struct{})}, nil
}

// xterm exchanges UTF-8 bytes. Ensure the child shell interprets filenames and
// other multibyte text the same way when the service inherited a non-UTF-8 locale.
func terminalEnvironment(env []string, goos string) []string {
	values := make(map[string]string, 3)
	for _, entry := range env {
		key, value, _ := strings.Cut(entry, "=")
		if key == "LC_ALL" || key == "LC_CTYPE" || key == "LANG" {
			values[key] = value
		}
	}
	locale := values["LC_ALL"]
	if locale == "" {
		locale = values["LC_CTYPE"]
	}
	if locale == "" {
		locale = values["LANG"]
	}
	locale = strings.ToLower(locale)
	needsUTF8 := !strings.Contains(locale, "utf-8") && !strings.Contains(locale, "utf8")
	result := make([]string, 0, len(env)+2)
	for _, entry := range env {
		name, _, ok := strings.Cut(entry, "=")
		if ok && (name == "TERM" || needsUTF8 && (name == "LC_ALL" || name == "LC_CTYPE")) {
			continue
		}
		result = append(result, entry)
	}
	if needsUTF8 {
		// LC_ALL overrides LC_CTYPE, so replace both only in the child env.
		locale = "C.UTF-8"
		if goos == "darwin" {
			locale = "UTF-8"
		}
		result = append(result, "LC_CTYPE="+locale)
	}
	return append(result, "TERM=xterm-256color")
}

func (s *Session) wait() {
	_ = s.cmd.Wait()
	// The process leader can leave descendants behind; this group is session-owned.
	_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
	// Drain final output before closing the descriptor. A deadline also
	// handles descendants that escaped the original process group.
	_ = s.pty.SetReadDeadline(time.Now().Add(time.Second))
	<-s.readerDone
	_ = s.pty.Close()
	s.mu.Lock()
	s.running = false
	if s.output != nil {
		if s.outputActive {
			s.outputActive = false
			close(s.outputDone)
		}
		close(s.output)
		s.output = nil
		s.outputDone = nil
	}
	close(s.done)
	s.mu.Unlock()
}

func (s *Session) Close() {
	s.closeOnce.Do(func() {
		select {
		case <-s.done:
			return
		default:
		}
		_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGTERM)
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case <-s.done:
		case <-timer.C:
			_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
			s.stopOutput()
			_ = s.pty.Close()
			<-s.done
		}
	})
}
