//go:build !darwin && !linux

package session

import (
	"context"
	"errors"
)

func processWorkingDirectory(context.Context, int) (string, error) {
	return "", errors.New("terminal working directory tracking is unsupported on this platform")
}
