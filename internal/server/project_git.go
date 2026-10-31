package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxProjectDiff            = 256 << 10
	maxProjectChanges         = 2000
	maxProjectHistoryPageSize = 100
	projectHistoryPageSize    = 15
	maxProjectHistoryOutput   = 2 << 20
	maxProjectCommitFiles     = 2 << 20
)

var gitCommitHashPattern = regexp.MustCompile(`^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$`)

type projectChange struct {
	Path          string `json:"path"`
	Status        string `json:"status"`
	Label         string `json:"label"`
	Additions     int    `json:"additions"`
	Deletions     int    `json:"deletions"`
	StatsComplete bool   `json:"statsComplete"`
}

type changesResponse struct {
	Files         []projectChange `json:"files"`
	Truncated     bool            `json:"truncated"`
	Additions     int             `json:"additions"`
	Deletions     int             `json:"deletions"`
	StatsComplete bool            `json:"statsComplete"`
}

type projectDiffResponse struct {
	Patch      string `json:"patch"`
	OldContent string `json:"oldContent"`
	NewContent string `json:"newContent"`
	Complete   bool   `json:"complete"`
	Binary     bool   `json:"binary"`
}

type projectHistoryCommit struct {
	Hash       string   `json:"hash"`
	ShortHash  string   `json:"shortHash"`
	Parents    []string `json:"parents"`
	Subject    string   `json:"subject"`
	AuthorName string   `json:"authorName"`
	AuthoredAt string   `json:"authoredAt"`
}

type projectHistoryRef struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Commit string `json:"commit"`
}

type projectHistoryResponse struct {
	Commits       []projectHistoryCommit `json:"commits"`
	Refs          []projectHistoryRef    `json:"refs"`
	Truncated     bool                   `json:"truncated"`
	RefsTruncated bool                   `json:"refsTruncated"`
}

type projectCommitFile struct {
	Path   string `json:"path"`
	Status string `json:"status"`
	Label  string `json:"label"`
}

type projectCommitResponse struct {
	Hash           string              `json:"hash"`
	ShortHash      string              `json:"shortHash"`
	Parents        []string            `json:"parents"`
	Subject        string              `json:"subject"`
	AuthorName     string              `json:"authorName"`
	AuthoredAt     string              `json:"authoredAt"`
	Files          []projectCommitFile `json:"files"`
	FilesTruncated bool                `json:"filesTruncated"`
}

func (s *Server) projectChanges(w http.ResponseWriter, r *http.Request) {
	directory, err := s.projectWorkingDirectory(r.Context(), r.URL.Query().Get("session"))
	if err != nil {
		http.Error(w, "无法读取当前终端目录", http.StatusNotFound)
		return
	}
	changes, truncated, err := gitChanges(r.Context(), directory, r.URL.Query().Get("hidden") == "1")
	if err != nil {
		http.Error(w, "无法读取 Git 更改", http.StatusConflict)
		return
	}
	additions, deletions, complete := gitChangeStats(r.Context(), directory, changes)
	respond(w, changesResponse{Files: changes, Truncated: truncated, Additions: additions, Deletions: deletions, StatsComplete: complete && !truncated})
}

func (s *Server) projectHistory(w http.ResponseWriter, r *http.Request) {
	directory, err := s.projectWorkingDirectory(r.Context(), r.URL.Query().Get("session"))
	if err != nil {
		http.Error(w, "无法读取当前终端目录", http.StatusNotFound)
		return
	}
	limit, offset, err := projectHistoryParams(
		r.URL.Query().Get("limit"),
		r.URL.Query().Get("offset"),
	)
	if err != nil {
		http.Error(w, "历史提交数量无效", http.StatusBadRequest)
		return
	}
	history, err := gitHistory(r.Context(), directory, limit, offset)
	if err != nil {
		http.Error(w, "无法读取 Git 历史", http.StatusConflict)
		return
	}
	respond(w, history)
}

func (s *Server) projectCommit(w http.ResponseWriter, r *http.Request) {
	hash := r.URL.Query().Get("hash")
	if !gitCommitHashPattern.MatchString(hash) {
		http.Error(w, "提交哈希无效", http.StatusBadRequest)
		return
	}
	directory, err := s.projectWorkingDirectory(r.Context(), r.URL.Query().Get("session"))
	if err != nil {
		http.Error(w, "无法读取当前终端目录", http.StatusNotFound)
		return
	}
	commit, err := gitCommitDetails(r.Context(), directory, hash)
	if err != nil {
		if gitExitCode(err) == 128 {
			http.Error(w, "提交不存在", http.StatusNotFound)
			return
		}
		http.Error(w, "无法读取提交详情", http.StatusConflict)
		return
	}
	respond(w, commit)
}

func (s *Server) projectCommitDiff(w http.ResponseWriter, r *http.Request) {
	hash := r.URL.Query().Get("hash")
	name, pathErr := cleanProjectPath(r.URL.Query().Get("path"))
	if !gitCommitHashPattern.MatchString(hash) || pathErr != nil || name == "." || hasGitComponent(name) {
		http.Error(w, "提交文件路径无效", http.StatusBadRequest)
		return
	}
	directory, err := s.projectWorkingDirectory(r.Context(), r.URL.Query().Get("session"))
	if err != nil {
		http.Error(w, "无法读取当前终端目录", http.StatusNotFound)
		return
	}
	diff, err := gitCommitDiff(r.Context(), directory, hash, name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || gitExitCode(err) == 128 {
			http.Error(w, "提交文件不存在", http.StatusNotFound)
			return
		}
		http.Error(w, "无法读取提交文件差异", http.StatusConflict)
		return
	}
	respond(w, diff)
}

func (s *Server) projectDiff(w http.ResponseWriter, r *http.Request) {
	name, err := cleanProjectPath(r.URL.Query().Get("path"))
	if err != nil || name == "." || hasGitComponent(name) || (r.URL.Query().Get("hidden") != "1" && hasHiddenComponent(name)) {
		http.Error(w, "文件路径无效", http.StatusBadRequest)
		return
	}
	directory, err := s.projectWorkingDirectory(r.Context(), r.URL.Query().Get("session"))
	if err != nil {
		http.Error(w, "无法读取当前终端目录", http.StatusNotFound)
		return
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		http.Error(w, "无法打开项目目录", http.StatusInternalServerError)
		return
	}
	defer root.Close()
	fileInfo, fileErr := projectInfo(root, name, true)
	if fileErr != nil && !errors.Is(fileErr, os.ErrNotExist) {
		http.Error(w, "文件路径无效", http.StatusNotFound)
		return
	}
	if fileErr == nil && !fileInfo.Mode().IsRegular() {
		http.Error(w, "只能读取普通文件差异", http.StatusBadRequest)
		return
	}
	changes, _, err := gitChanges(r.Context(), directory, true)
	if err != nil {
		http.Error(w, "当前工作目录不是可用的 Git 仓库", http.StatusConflict)
		return
	}
	untracked := false
	for _, change := range changes {
		if change.Path == name && change.Status == "??" {
			untracked = true
			break
		}
	}
	args := []string{"--no-pager", "diff", "--no-ext-diff", "--no-color", "--unified=1000000"}
	if untracked {
		args = append(args, "--no-index", "--", "/dev/null", name)
	} else {
		args = append(args, "HEAD", "--", ":(literal)"+filepath.ToSlash(name))
	}
	data, err := runGit(r.Context(), directory, args, maxProjectDiff)
	if err != nil && !(untracked && gitExitCode(err) == 1) {
		http.Error(w, "无法读取文件差异", http.StatusConflict)
		return
	}
	oldContent := []byte(nil)
	if !untracked {
		oldContent, err = runGit(r.Context(), directory, []string{"show", "HEAD:./" + filepath.ToSlash(name)}, maxProjectPreview)
		if err != nil {
			if gitExitCode(err) != 128 {
				http.Error(w, "无法读取文件旧版本", http.StatusConflict)
				return
			}
			oldContent = nil
		}
	}
	newContent := []byte(nil)
	if fileErr == nil {
		file, err := root.Open(name)
		if err != nil {
			http.Error(w, "无法读取文件当前版本", http.StatusNotFound)
			return
		}
		newContent, err = io.ReadAll(io.LimitReader(file, maxProjectPreview+1))
		_ = file.Close()
		if err != nil {
			http.Error(w, "无法读取文件当前版本", http.StatusInternalServerError)
			return
		}
	}
	complete := len(oldContent) <= maxProjectPreview && len(newContent) <= maxProjectPreview && bytes.IndexByte(oldContent, 0) < 0 && bytes.IndexByte(newContent, 0) < 0 && utf8.Valid(oldContent) && utf8.Valid(newContent)
	result := projectDiffResponse{Patch: string(data), Complete: complete}
	if complete {
		result.OldContent = string(oldContent)
		result.NewContent = string(newContent)
	}
	respond(w, result)
}

func projectHistoryParams(rawLimit, rawOffset string) (int, int, error) {
	limit := projectHistoryPageSize
	if rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > maxProjectHistoryPageSize {
			return 0, 0, errors.New("invalid history limit")
		}
		limit = parsed
	}
	offset := 0
	if rawOffset != "" {
		parsed, err := strconv.Atoi(rawOffset)
		if err != nil || parsed < 0 {
			return 0, 0, errors.New("invalid history offset")
		}
		offset = parsed
	}
	return limit, offset, nil
}

func gitHistory(ctx context.Context, directory string, limit, offset int) (projectHistoryResponse, error) {
	args := []string{
		"--no-pager",
		"log",
		"--all",
		"--topo-order",
		fmt.Sprintf("--max-count=%d", limit+1),
		"--format=%H%x00%P%x00%an%x00%aI%x00%s%x1e",
	}
	if offset > 0 {
		args = append(args, fmt.Sprintf("--skip=%d", offset))
	}
	args = append(args, "--", ".")
	data, err := runGit(ctx, directory, args, maxProjectHistoryOutput)
	if err != nil {
		return projectHistoryResponse{}, err
	}
	commits, outputTruncated := parseProjectHistoryCommits(data)
	truncated := outputTruncated || len(commits) > limit
	if len(commits) > limit {
		commits = commits[:limit]
	}
	refs, refsTruncated, err := gitHistoryRefs(ctx, directory)
	if err != nil {
		return projectHistoryResponse{}, err
	}
	return projectHistoryResponse{
		Commits:       commits,
		Refs:          refs,
		Truncated:     truncated,
		RefsTruncated: refsTruncated,
	}, nil
}

func parseProjectHistoryCommits(data []byte) ([]projectHistoryCommit, bool) {
	const marker = "\n…输出已截断…\n"
	outputTruncated := bytes.Contains(data, []byte(marker))
	data = bytes.TrimSuffix(data, []byte(marker))
	commits := make([]projectHistoryCommit, 0)
	for _, record := range bytes.Split(data, []byte{0x1e}) {
		record = bytes.Trim(record, "\r\n")
		if len(record) == 0 {
			continue
		}
		fields := bytes.Split(record, []byte{0})
		if len(fields) < 5 || !gitCommitHashPattern.MatchString(string(fields[0])) {
			continue
		}
		hash := string(fields[0])
		parents := strings.Fields(string(fields[1]))
		commits = append(commits, projectHistoryCommit{
			Hash:       hash,
			ShortHash:  hash[:7],
			Parents:    parents,
			AuthorName: string(fields[2]),
			AuthoredAt: string(fields[3]),
			Subject:    string(fields[4]),
		})
	}
	return commits, outputTruncated
}

func gitHistoryRefs(ctx context.Context, directory string) ([]projectHistoryRef, bool, error) {
	data, err := runGit(ctx, directory, []string{
		"--no-pager",
		"for-each-ref",
		"--format=%(refname)%00%(objectname)%00%(*objectname)%00",
		"refs/heads",
		"refs/remotes",
		"refs/tags",
	}, maxProjectHistoryOutput)
	if err != nil {
		return nil, false, err
	}
	const marker = "\n…输出已截断…\n"
	truncated := bytes.Contains(data, []byte(marker))
	data = bytes.TrimSuffix(data, []byte(marker))
	refs := make([]projectHistoryRef, 0)
	for _, record := range bytes.Split(data, []byte{'\n'}) {
		fields := bytes.Split(bytes.TrimSpace(record), []byte{0})
		if len(fields) < 3 || len(fields[0]) == 0 {
			continue
		}
		fullName := string(fields[0])
		commit := string(fields[2])
		if commit == "" {
			commit = string(fields[1])
		}
		if !gitCommitHashPattern.MatchString(commit) {
			continue
		}
		kind, name, ok := projectRefName(fullName)
		if !ok {
			continue
		}
		refs = append(refs, projectHistoryRef{Name: name, Kind: kind, Commit: commit})
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].Kind != refs[j].Kind {
			return refs[i].Kind < refs[j].Kind
		}
		return refs[i].Name < refs[j].Name
	})
	return refs, truncated, nil
}

func projectRefName(fullName string) (kind, name string, ok bool) {
	switch {
	case strings.HasPrefix(fullName, "refs/heads/"):
		return "branch", strings.TrimPrefix(fullName, "refs/heads/"), true
	case strings.HasPrefix(fullName, "refs/remotes/"):
		return "remote", strings.TrimPrefix(fullName, "refs/remotes/"), true
	case strings.HasPrefix(fullName, "refs/tags/"):
		return "tag", strings.TrimPrefix(fullName, "refs/tags/"), true
	default:
		return "", "", false
	}
}

func gitCommitDetails(ctx context.Context, directory, hash string) (projectCommitResponse, error) {
	data, err := runGit(ctx, directory, []string{
		"--no-pager",
		"show",
		"--no-patch",
		"--format=%H%x00%P%x00%an%x00%aI%x00%s%x1e",
		hash,
	}, maxProjectHistoryOutput)
	if err != nil {
		return projectCommitResponse{}, err
	}
	commits, _ := parseProjectHistoryCommits(data)
	if len(commits) == 0 {
		return projectCommitResponse{}, fmt.Errorf("commit %s not found", hash)
	}
	commit := commits[0]
	files, truncated, err := gitCommitFiles(ctx, directory, hash, commit.Parents)
	if err != nil {
		return projectCommitResponse{}, err
	}
	return projectCommitResponse{
		Hash:           commit.Hash,
		ShortHash:      commit.ShortHash,
		Parents:        commit.Parents,
		Subject:        commit.Subject,
		AuthorName:     commit.AuthorName,
		AuthoredAt:     commit.AuthoredAt,
		Files:          files,
		FilesTruncated: truncated,
	}, nil
}

func gitCommitFiles(ctx context.Context, directory, hash string, parents []string) ([]projectCommitFile, bool, error) {
	args := []string{"--no-pager"}
	if len(parents) > 0 {
		args = append(args, "diff", "--relative", "--no-renames", "--name-status", "-z", parents[0], hash)
	} else {
		args = append(args, "diff-tree", "--relative", "--root", "--no-commit-id", "--no-renames", "--name-status", "-r", "-z", hash)
	}
	data, err := runGit(ctx, directory, args, maxProjectCommitFiles)
	if err != nil {
		return nil, false, err
	}
	const marker = "\n…输出已截断…\n"
	truncated := bytes.Contains(data, []byte(marker))
	data = bytes.TrimSuffix(data, []byte(marker))
	fields := bytes.Split(data, []byte{0})
	files := make([]projectCommitFile, 0, len(fields)/2)
	for index := 0; index+1 < len(fields); index += 2 {
		status := strings.TrimSpace(string(fields[index]))
		path := string(fields[index+1])
		if status == "" || path == "" {
			continue
		}
		files = append(files, projectCommitFile{Path: filepath.ToSlash(path), Status: status, Label: changeLabel(status)})
	}
	return files, truncated, nil
}

func gitCommitDiff(ctx context.Context, directory, hash, name string) (projectDiffResponse, error) {
	commit, err := gitCommitDetails(ctx, directory, hash)
	if err != nil {
		return projectDiffResponse{}, err
	}
	changed := false
	for _, file := range commit.Files {
		if file.Path == name {
			changed = true
			break
		}
	}
	if !changed {
		return projectDiffResponse{}, os.ErrNotExist
	}

	oldContent := []byte(nil)
	oldComplete := true
	if len(commit.Parents) > 0 {
		oldContent, _, oldComplete, err = gitBlob(ctx, directory, commit.Parents[0]+":./"+filepath.ToSlash(name))
		if err != nil {
			return projectDiffResponse{}, err
		}
	}
	newContent, _, newComplete, err := gitBlob(ctx, directory, hash+":./"+filepath.ToSlash(name))
	if err != nil {
		return projectDiffResponse{}, err
	}
	patchArgs := []string{"--no-pager"}
	if len(commit.Parents) > 0 {
		patchArgs = append(patchArgs, "diff", "--no-ext-diff", "--no-color", "--unified=1000000", commit.Parents[0], hash)
	} else {
		patchArgs = append(patchArgs, "diff-tree", "--root", "--no-commit-id", "--no-ext-diff", "--no-color", "--unified=1000000", "-r", hash)
	}
	patchArgs = append(patchArgs, "--", ":(literal)"+name)
	patch, err := runGit(ctx, directory, patchArgs, maxProjectDiff)
	if err != nil {
		return projectDiffResponse{}, err
	}
	patch = bytes.TrimSuffix(patch, []byte("\n…输出已截断…\n"))
	binary := isBinaryProjectContent(oldContent) || isBinaryProjectContent(newContent)
	result := projectDiffResponse{
		Patch:  string(patch),
		Binary: binary,
	}
	if oldComplete && newComplete && !binary {
		result.OldContent = string(oldContent)
		result.NewContent = string(newContent)
		result.Complete = true
	}
	return result, nil
}

func gitBlob(ctx context.Context, directory, spec string) ([]byte, bool, bool, error) {
	data, err := runGit(ctx, directory, []string{"--no-pager", "show", spec}, maxProjectPreview+1)
	if err != nil {
		if gitExitCode(err) == 128 {
			return nil, false, true, nil
		}
		return nil, false, false, err
	}
	truncated := bytes.Contains(data, []byte("\n…输出已截断…\n"))
	data = bytes.TrimSuffix(data, []byte("\n…输出已截断…\n"))
	complete := !truncated && len(data) <= maxProjectPreview && !isBinaryProjectContent(data)
	return data, true, complete, nil
}

func isBinaryProjectContent(data []byte) bool {
	return bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data)
}

func gitChanges(ctx context.Context, directory string, showHidden bool) ([]projectChange, bool, error) {
	data, err := runGit(ctx, directory, []string{"--no-pager", "status", "--porcelain=v1", "-z", "--untracked-files=all"}, 4<<20)
	if err != nil {
		return nil, false, err
	}
	const truncationMarker = "\n…输出已截断…\n"
	outputTruncated := bytes.Contains(data, []byte(truncationMarker))
	data = bytes.TrimSuffix(data, []byte(truncationMarker))
	changes := make([]projectChange, 0)
	records := bytes.Split(data, []byte{0})
	for i := 0; i < len(records); i++ {
		record := string(records[i])
		if len(record) < 4 {
			continue
		}
		status, name := record[:2], record[3:]
		if (strings.Contains(status, "R") || strings.Contains(status, "C")) && i+1 < len(records) {
			i++
		} // The following record is the old path.
		name = filepath.ToSlash(name)
		if !showHidden && hasHiddenComponent(name) {
			continue
		}
		changes = append(changes, projectChange{Path: name, Status: status, Label: changeLabel(status)})
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	truncated := outputTruncated
	if len(changes) > maxProjectChanges {
		truncated = true
		changes = changes[:maxProjectChanges]
	}
	return changes, truncated, nil
}

func changeLabel(status string) string {
	if status == "??" || strings.Contains(status, "A") {
		return "新增"
	}
	if strings.Contains(status, "D") {
		return "删除"
	}
	if strings.Contains(status, "R") {
		return "重命名"
	}
	if strings.Contains(status, "U") {
		return "冲突"
	}
	return "修改"
}

type cappedBuffer struct {
	bytes.Buffer
	limit     int
	truncated bool
}

func (b *cappedBuffer) Write(data []byte) (int, error) {
	original := len(data)
	remaining := b.limit - b.Len()
	if remaining > 0 {
		if len(data) > remaining {
			_, _ = b.Buffer.Write(data[:remaining])
			b.truncated = true
		} else {
			_, _ = b.Buffer.Write(data)
		}
	} else if len(data) != 0 {
		b.truncated = true
	}
	return original, nil
}

func runGit(ctx context.Context, directory string, args []string, limit int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = directory
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "GIT_PAGER=cat")
	output := &cappedBuffer{limit: limit}
	stderr := &cappedBuffer{limit: 8 << 10}
	cmd.Stdout, cmd.Stderr = output, stderr
	err := cmd.Run()
	data := output.Bytes()
	if output.truncated {
		data = append(append([]byte(nil), data...), []byte("\n…输出已截断…\n")...)
	}
	if err != nil {
		return data, fmt.Errorf("git command failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return data, nil
}

func gitExitCode(err error) int {
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	return -1
}
