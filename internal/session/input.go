package session

import (
	"errors"
	"io"
	"syscall"
	"time"
	"unsafe"

	"github.com/creack/pty"
)

func ValidSize(cols, rows uint16) bool { return cols >= 2 && cols <= 500 && rows >= 2 && rows <= 300 }

func (s *Session) Write(data []byte) error {
	if len(data) > 8192 {
		return errors.New("输入过大")
	}
	s.inputMu.Lock()
	defer s.inputMu.Unlock()
	if !s.Info().Running {
		return ErrStopped
	}
	if err := s.pty.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	n, err := s.pty.Write(data)
	if err == nil && n != len(data) {
		return io.ErrShortWrite
	}
	return err
}

func (s *Session) Resize(cols, rows uint16) error {
	if !ValidSize(cols, rows) {
		return errors.New("终端尺寸无效")
	}
	s.inputMu.Lock()
	defer s.inputMu.Unlock()
	if !s.Info().Running {
		return ErrStopped
	}
	// Serialize the successful resize event with captured PTY output and attach.
	s.mu.Lock()
	defer s.mu.Unlock()
	// File.Fd() would switch a pollable PTY back into blocking mode. Use
	// SyscallConn so ioctl does not break deadline/cancellation semantics.
	raw, err := s.pty.SyscallConn()
	if err != nil {
		return err
	}
	var ioctlErr error
	size := pty.Winsize{Cols: cols, Rows: rows}
	err = raw.Control(func(fd uintptr) {
		_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, syscall.TIOCSWINSZ, uintptr(unsafe.Pointer(&size)))
		if errno != 0 {
			ioctlErr = errno
		}
	})
	if err != nil {
		return err
	}
	if ioctlErr == nil {
		s.replay.resize(cols, rows, s.cursorMode)
	}
	return ioctlErr
}
