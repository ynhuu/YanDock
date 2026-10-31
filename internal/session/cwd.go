package session

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"
)

const directoryCacheTTL = 250 * time.Millisecond

// CurrentDirectory follows the process leader, including shell built-in cd.
func (s *Session) CurrentDirectory() (string, error) {
	return s.CurrentDirectoryContext(context.Background())
}

func (s *Session) CurrentDirectoryContext(ctx context.Context) (string, error) {
	return s.currentDirectory(ctx, processWorkingDirectory)
}

// mu protects the short-lived cache and a single in-flight lookup per session.
// Waiters can cancel independently; no goroutine is created for a lookup.
func (s *Session) currentDirectory(ctx context.Context, lookup func(context.Context, int) (string, error)) (string, error) {
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		s.mu.Lock()
		if !s.running {
			cwd := s.cwd
			s.mu.Unlock()
			if cwd == "" {
				return "", ErrStopped
			}
			return cwd, nil
		}
		if done := s.cwdLookupDone; done != nil {
			s.mu.Unlock()
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-done:
				continue
			}
		}
		if time.Since(s.cwdChecked) < directoryCacheTTL {
			cwd, err := s.cwd, s.cwdError
			s.mu.Unlock()
			return cwd, err
		}
		pid := s.cmd.Process.Pid
		done := make(chan struct{})
		s.cwdLookupDone = done
		s.mu.Unlock()

		cwd, err := lookup(ctx, pid)
		if err == nil {
			cwd, err = filepath.Abs(cwd)
			if err == nil {
				var info os.FileInfo
				info, err = os.Stat(cwd)
				if err == nil && !info.IsDir() {
					err = errors.New("terminal working directory is not a directory")
				}
			}
			if err == nil {
				cwd, err = filepath.EvalSymlinks(cwd)
			}
		}
		s.mu.Lock()
		if !s.running {
			if s.cwd != "" {
				cwd, err = s.cwd, nil
			}
		} else if err == nil {
			s.cwd = filepath.Clean(cwd)
		}
		// A cancelled owner must not poison a later caller's cache.
		if ctx.Err() == nil {
			s.cwdChecked = time.Now()
			s.cwdError = err
		}
		s.cwdLookupDone = nil
		close(done)
		s.mu.Unlock()
		return cwd, err
	}
}
