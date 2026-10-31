// Package session owns PTYs independently of browser connections.
package session

import (
	"errors"
	"os"
	"os/exec"
	"sync"
	"time"
)

var ErrConflict = errors.New("会话已有控制连接")
var ErrStopped = errors.New("会话已结束")

type Info struct {
	ID string `json:"id"`
	// Seq is the smallest free tab number at creation; existing labels stay stable.
	Seq     int  `json:"seq"`
	Running bool `json:"running"`
}

// Session owns its process, PTY and output stream. mu guards running and
// output state; inputMu serializes PTY writes and resize operations.
type Session struct {
	mu            sync.Mutex
	inputMu       sync.Mutex
	id            string
	seq           int
	cmd           *exec.Cmd
	cwd           string
	cwdChecked    time.Time
	cwdError      error
	cwdLookupDone chan struct{}
	pty           *os.File
	running       bool
	output        chan []byte
	outputDone    chan struct{}
	outputActive  bool
	attached      bool
	replay        replayLog
	cursorMode    cursorModeTracker
	done          chan struct{}
	readerDone    chan struct{}
	closeOnce     sync.Once
}

func (s *Session) Info() Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Info{ID: s.id, Seq: s.seq, Running: s.running}
}
