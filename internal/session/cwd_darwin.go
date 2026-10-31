//go:build darwin

package session

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func processWorkingDirectory(ctx context.Context, pid int) (string, error) {
	if pid <= 0 {
		return "", fmt.Errorf("invalid process id %d", pid)
	}
	program, err := exec.LookPath("lsof")
	if err != nil {
		return "", fmt.Errorf("find lsof: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, program, "-a", "-p", strconv.Itoa(pid), "-d", "cwd", "-Fn")
	command.Env = make([]string, 0, len(os.Environ())+1)
	for _, entry := range os.Environ() {
		key, _, ok := strings.Cut(entry, "=")
		if ok && (key == "LC_ALL" || key == "LC_CTYPE") {
			continue
		}
		command.Env = append(command.Env, entry)
	}
	// macOS lsof escapes non-ASCII paths unless its child process has a UTF-8 locale.
	command.Env = append(command.Env, "LC_CTYPE=UTF-8")
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("inspect process directory: %w", err)
	}
	for _, line := range strings.Split(string(output), "\n") {
		if !strings.HasPrefix(line, "n") || len(line) == 1 {
			continue
		}
		cwd := strings.TrimSuffix(line[1:], " (deleted)")
		info, err := os.Stat(cwd)
		if err == nil && info.IsDir() {
			return cwd, nil
		}
	}
	return "", errors.New("process working directory was not reported")
}
