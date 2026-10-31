package server

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Shared path policy for file operations and Git previews. Callers own roots.
func (s *Server) projectDirectory(ctx context.Context, sessionID, name string) (*os.Root, string, error) {
	relative, err := cleanProjectPath(name)
	if err != nil {
		return nil, "", err
	}
	if hasGitComponent(relative) {
		return nil, "", errors.New(".git is not browsable")
	}
	root, err := s.projectRoot(ctx, sessionID)
	if err != nil {
		return nil, "", err
	}
	info, err := projectInfo(root, relative, false)
	if err != nil || !info.IsDir() {
		_ = root.Close()
		if err == nil {
			err = errors.New("not a directory")
		}
		return nil, "", err
	}
	return root, relative, nil
}

func (s *Server) projectFile(ctx context.Context, sessionID, name string, showHidden bool) (*os.Root, string, os.FileInfo, error) {
	relative, err := cleanProjectPath(name)
	if err != nil || relative == "." || hasGitComponent(relative) || (!showHidden && hasHiddenComponent(relative)) {
		return nil, "", nil, errors.New("invalid file path")
	}
	root, err := s.projectRoot(ctx, sessionID)
	if err != nil {
		return nil, "", nil, err
	}
	info, err := projectInfo(root, relative, false)
	if err != nil {
		_ = root.Close()
		return nil, "", nil, err
	}
	return root, relative, info, nil
}

func (s *Server) projectRoot(ctx context.Context, sessionID string) (*os.Root, error) {
	directory, err := s.projectWorkingDirectory(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	return os.OpenRoot(directory)
}

func (s *Server) projectWorkingDirectory(ctx context.Context, sessionID string) (string, error) {
	if sessionID == "" {
		return s.manager.WorkingDir(), nil
	}
	current := s.manager.Get(sessionID)
	if current == nil {
		return "", errors.New("unknown terminal session")
	}
	return current.CurrentDirectoryContext(ctx)
}

func projectInfo(root *os.Root, relative string, allowMissing bool) (os.FileInfo, error) {
	if relative == "." {
		return root.Stat(".")
	}
	parts := strings.Split(filepath.Clean(relative), string(filepath.Separator))
	current := ""
	var info os.FileInfo
	for index, part := range parts {
		if part == "" || part == "." {
			continue
		}
		if current == "" {
			current = part
		} else {
			current = filepath.Join(current, part)
		}
		var err error
		info, err = root.Lstat(current)
		if err != nil {
			if allowMissing && errors.Is(err, os.ErrNotExist) {
				return nil, os.ErrNotExist
			}
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("symbolic links are not browsable")
		}
		if index < len(parts)-1 && !info.IsDir() {
			return nil, errors.New("path component is not a directory")
		}
	}
	return info, nil
}

func cleanProjectPath(name string) (string, error) {
	if strings.ContainsRune(name, 0) || filepath.IsAbs(name) || strings.HasPrefix(name, "/") {
		return "", errors.New("invalid project path")
	}
	name = filepath.FromSlash(name)
	clean := filepath.Clean(name)
	if clean == "" {
		clean = "."
	}
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("project path escapes root")
	}
	return clean, nil
}

func hasHiddenComponent(name string) bool {
	for _, part := range strings.Split(filepath.ToSlash(name), "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

func hasGitComponent(name string) bool {
	for _, part := range strings.Split(filepath.ToSlash(name), "/") {
		if strings.EqualFold(part, ".git") {
			return true
		}
	}
	return false
}
