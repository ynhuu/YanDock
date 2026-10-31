package session

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCurrentDirectoryTracksShellProcess(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	want := filepath.Join(root, "嵌套目录")
	if err := os.Mkdir(want, 0o755); err != nil {
		t.Fatal(err)
	}
	want, err = filepath.EvalSymlinks(want)
	if err != nil {
		t.Fatal(err)
	}
	command := "cd '" + strings.ReplaceAll(want, "'", "'\\''") + "' && exec sleep 30"
	manager := NewManager(sh, []string{"-c", command}, root)
	t.Cleanup(manager.Close)
	current, err := manager.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		got, err := current.CurrentDirectory()
		if err == nil && got == want {
			return
		}
		select {
		case <-deadline.C:
			t.Fatalf("current directory = %q, err=%v, want %q", got, err, want)
		case <-ticker.C:
		}
	}
}

func TestDirectoryLookupCoalescesAndExpires(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	current := &Session{running: true, cmd: &exec.Cmd{Process: &os.Process{Pid: 42}}}
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	lookup := func(ctx context.Context, pid int) (string, error) {
		if pid != 42 {
			t.Errorf("pid = %d", pid)
		}
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		return dir, nil
	}
	owner := make(chan error, 1)
	go func() { _, err := current.currentDirectory(context.Background(), lookup); owner <- err }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	waiter := make(chan error, 1)
	go func() { _, err := current.currentDirectory(ctx, lookup); waiter <- err }()
	cancel()
	if err := <-waiter; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter = %v", err)
	}
	close(release)
	if err := <-owner; err != nil {
		t.Fatal(err)
	}
	if got, err := current.currentDirectory(context.Background(), lookup); err != nil || got != dir {
		t.Fatalf("cached lookup = %q, %v", got, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("cache performed %d lookups", calls.Load())
	}
	current.mu.Lock()
	current.cwdChecked = time.Now().Add(-directoryCacheTTL)
	current.mu.Unlock()
	if _, err := current.currentDirectory(context.Background(), lookup); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatal("expired directory was not refreshed")
	}
}

func TestCancelledDirectoryOwnerDoesNotCacheFailure(t *testing.T) {
	dir := t.TempDir()
	current := &Session{running: true, cmd: &exec.Cmd{Process: &os.Process{Pid: 42}}}
	ctx, cancel := context.WithCancel(context.Background())
	_, err := current.currentDirectory(ctx, func(ctx context.Context, _ int) (string, error) {
		cancel()
		return "", ctx.Err()
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("lookup error = %v", err)
	}
	_, err = current.currentDirectory(context.Background(), func(context.Context, int) (string, error) { return dir, nil })
	if err != nil {
		t.Fatalf("cancelled owner poisoned cache: %v", err)
	}
	current.mu.Lock()
	current.running = false
	current.mu.Unlock()
	_, err = current.currentDirectory(context.Background(), func(context.Context, int) (string, error) { t.Fatal("stopped process queried"); return "", nil })
	if err != nil {
		t.Fatal(err)
	}
}
