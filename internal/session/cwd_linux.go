//go:build linux

package session

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func processWorkingDirectory(ctx context.Context, pid int) (string, error) {
	if pid <= 0 {
		return "", fmt.Errorf("invalid process id %d", pid)
	}
	path := "/proc/" + strconv.Itoa(pid) + "/cwd"
	cwd, err := os.Readlink(path)
	if err != nil {
		return "", fmt.Errorf("read process directory: %w", err)
	}
	return strings.TrimSuffix(cwd, " (deleted)"), nil
}
