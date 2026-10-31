package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func projectRequest(t *testing.T, srv *httptest.Server, cookie *http.Cookie, method, path string, body io.Reader) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, srv.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(cookie)
	if method != http.MethodGet {
		request.Header.Set("Origin", srv.URL)
	}
	return doProjectRequest(t, request)
}

func doProjectRequest(t *testing.T, request *http.Request) *http.Response {
	t.Helper()
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

func TestProjectImagePreview(t *testing.T) {
	srv, manager, cookie := setup(t)
	for ext, contentType := range map[string]string{"png": "image/png", "JPG": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "ico": "image/x-icon", "svg": "image/svg+xml"} {
		t.Run(ext, func(t *testing.T) {
			name := "preview." + ext
			data := []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")
			if err := os.WriteFile(filepath.Join(manager.WorkingDir(), name), data, 0o600); err != nil {
				t.Fatal(err)
			}
			response := projectRequest(t, srv, cookie, http.MethodGet, "/api/project/file?image=1&path="+name, nil)
			body, _ := io.ReadAll(response.Body)
			if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != contentType || !bytes.Equal(body, data) {
				t.Fatalf("unexpected image response: %d %v", response.StatusCode, response.Header)
			}
			if response.Header.Get("Content-Security-Policy") != "sandbox; default-src 'none'" || response.Header.Get("Content-Disposition") != "attachment" {
				t.Fatal("missing image document isolation")
			}
		})
	}
	for _, name := range []string{"unsupported.bmp", "large.png"} {
		file, err := os.Create(filepath.Join(manager.WorkingDir(), name))
		if err != nil {
			t.Fatal(err)
		}
		if err := file.Truncate(10<<20 + 1); err != nil {
			t.Fatal(err)
		}
		file.Close()
		response := projectRequest(t, srv, cookie, http.MethodGet, "/api/project/file?image=1&path="+name, nil)
		want := http.StatusUnsupportedMediaType
		if name == "large.png" {
			want = http.StatusRequestEntityTooLarge
		}
		if response.StatusCode != want {
			t.Fatalf("%s: got %d, want %d", name, response.StatusCode, want)
		}
	}
}

func TestProjectEmptyDirectory(t *testing.T) {
	srv, manager, cookie := setup(t)
	if err := os.Mkdir(filepath.Join(manager.WorkingDir(), "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	response := projectRequest(t, srv, cookie, http.MethodGet, "/api/project/files?path=empty", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list empty directory: %d", response.StatusCode)
	}
	var result filesResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Files == nil || len(result.Files) != 0 || result.Truncated {
		t.Fatalf("expected empty array without truncation: %+v", result)
	}
}

func TestProjectDeleteDirectory(t *testing.T) {
	srv, manager, cookie := setup(t)
	root := manager.WorkingDir()
	outside := t.TempDir()
	keep := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(keep, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "folder", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "folder", "nested", "file"), []byte("delete"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "folder", "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git", "config"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked")); err != nil {
		t.Fatal(err)
	}
	response := projectRequest(t, srv, cookie, http.MethodDelete, "/api/project/file?path=folder", nil)
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("delete directory: %d", response.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(root, "folder")); !os.IsNotExist(err) {
		t.Fatalf("directory remains: %v", err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatalf("symlink target changed: %v", err)
	}
	for _, path := range []string{".", "../", ".git", ".git/config", "linked", "linked/keep.txt"} {
		response = projectRequest(t, srv, cookie, http.MethodDelete, "/api/project/file?path="+path, nil)
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("delete protected path %q: %d", path, response.StatusCode)
		}
	}
	for _, path := range []string{root, filepath.Join(root, ".git", "config"), keep} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("protected path changed %q: %v", path, err)
		}
	}
}

func TestProjectFilesPreviewDownloadAndUpload(t *testing.T) {
	srv, manager, cookie := setup(t)
	root := manager.WorkingDir()
	if err := os.Mkdir(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git", "config"), []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello project\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "private.txt"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked")); err != nil {
		t.Fatal(err)
	}

	unauthorized, err := http.Get(srv.URL + "/api/project/files")
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated project access: %d", unauthorized.StatusCode)
	}

	response := projectRequest(t, srv, cookie, http.MethodGet, "/api/project/files", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list files: %d", response.StatusCode)
	}
	var fileList filesResponse
	if err := json.NewDecoder(response.Body).Decode(&fileList); err != nil {
		t.Fatal(err)
	}
	files := fileList.Files
	if len(files) != 2 || files[0].Name != "docs" || files[1].Name != "hello.txt" {
		t.Fatalf("hidden file or symlink leaked into directory listing: %+v", files)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/files?hidden=1", nil)
	fileList = filesResponse{}
	if err := json.NewDecoder(response.Body).Decode(&fileList); err != nil {
		t.Fatal(err)
	}
	files = fileList.Files
	if len(files) != 3 || files[0].Name != "docs" || files[1].Name != ".env" {
		t.Fatalf("hidden file toggle: %+v", files)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/file?path=hello.txt", nil)
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || string(body) != "hello project\n" {
		t.Fatalf("preview status=%d body=%q", response.StatusCode, body)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/file?path=.env", nil)
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("hidden preview status: %d", response.StatusCode)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/file?path=linked/private.txt&hidden=1", nil)
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("symlink preview status: %d", response.StatusCode)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/files?path=.git&hidden=1", nil)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf(".git directory listing status: %d", response.StatusCode)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/download?path=.git/config", nil)
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf(".git file download status: %d", response.StatusCode)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/download?path=hello.txt", nil)
	body, _ = io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || string(body) != "hello project\n" || !strings.Contains(response.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("download status=%d disposition=%q body=%q", response.StatusCode, response.Header.Get("Content-Disposition"), body)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/files?path=../", nil)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("path traversal listing status: %d", response.StatusCode)
	}

	var payload bytes.Buffer
	multipartWriter := multipart.NewWriter(&payload)
	part, err := multipartWriter.CreateFormFile("file", "uploaded.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("upload contents"))
	_ = multipartWriter.Close()
	request, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/project/upload", &payload)
	request.Header.Set("Origin", srv.URL)
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	request.AddCookie(cookie)
	response = doProjectRequest(t, request)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("upload status: %d", response.StatusCode)
	}
	got, err := os.ReadFile(filepath.Join(root, "uploaded.txt"))
	if err != nil || string(got) != "upload contents" {
		t.Fatalf("uploaded data=%q err=%v", got, err)
	}

	payload.Reset()
	multipartWriter = multipart.NewWriter(&payload)
	part, _ = multipartWriter.CreateFormFile("file", "hello.txt")
	_, _ = part.Write([]byte("must not replace"))
	_ = multipartWriter.Close()
	request, _ = http.NewRequest(http.MethodPost, srv.URL+"/api/project/upload", &payload)
	request.Header.Set("Origin", srv.URL)
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	request.AddCookie(cookie)
	response = doProjectRequest(t, request)
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("overwrite upload status: %d", response.StatusCode)
	}
	got, _ = os.ReadFile(filepath.Join(root, "hello.txt"))
	if string(got) != "hello project\n" {
		t.Fatalf("existing file was replaced: %q", got)
	}
}

func TestProjectChangesAndDiff(t *testing.T) {
	srv, manager, cookie := setup(t)
	root := manager.WorkingDir()
	runGitTest(t, root, "init", "-q")
	runGitTest(t, root, "config", "user.name", "YanDock Tests")
	runGitTest(t, root, "config", "user.email", "tests@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("before\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, root, "add", "tracked.txt")
	runGitTest(t, root, "commit", "-q", "-m", "initial")
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("after\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "new.txt"), []byte("new file\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".hidden-change"), []byte("hidden\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := projectRequest(t, srv, cookie, http.MethodGet, "/api/project/changes", nil)
	var changes changesResponse
	if err := json.NewDecoder(response.Body).Decode(&changes); err != nil {
		t.Fatal(err)
	}
	if len(changes.Files) != 2 || changes.Files[0].Path != "new.txt" || changes.Files[1].Path != "tracked.txt" {
		t.Fatalf("changes=%+v", changes)
	}
	if !changes.StatsComplete || !changes.Files[0].StatsComplete || !changes.Files[1].StatsComplete || changes.Additions != 2 || changes.Deletions != 1 || changes.Files[0].Additions != 1 || changes.Files[1].Additions != 1 || changes.Files[1].Deletions != 1 {
		t.Fatalf("change statistics=%+v", changes)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/changes?hidden=1", nil)
	changes = changesResponse{}
	if err := json.NewDecoder(response.Body).Decode(&changes); err != nil {
		t.Fatal(err)
	}
	if len(changes.Files) != 3 {
		t.Fatalf("hidden Git changes=%+v", changes.Files)
	}
	if changes.Additions != 3 || changes.Deletions != 1 {
		t.Fatalf("hidden Git statistics=%+v", changes)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/diff?path=tracked.txt", nil)
	var diff projectDiffResponse
	if err := json.NewDecoder(response.Body).Decode(&diff); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !bytes.Contains([]byte(diff.Patch), []byte("-before")) || !bytes.Contains([]byte(diff.Patch), []byte("+after")) {
		t.Fatalf("tracked diff status=%d diff=%+v", response.StatusCode, diff)
	}
	if !diff.Complete || diff.OldContent != "before\n" || diff.NewContent != "after\n" {
		t.Fatalf("tracked file contents=%+v", diff)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/diff?path=new.txt", nil)
	diff = projectDiffResponse{}
	if err := json.NewDecoder(response.Body).Decode(&diff); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !bytes.Contains([]byte(diff.Patch), []byte("+new file")) {
		t.Fatalf("untracked diff status=%d diff=%+v", response.StatusCode, diff)
	}
	if !diff.Complete || diff.OldContent != "" || diff.NewContent != "new file\n" {
		t.Fatalf("untracked file contents=%+v", diff)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/diff?path=.hidden-change&hidden=1", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("hidden diff status=%d", response.StatusCode)
	}
	if err := os.WriteFile(filepath.Join(root, "oversized.txt"), bytes.Repeat([]byte("x"), maxProjectStatFile+1), 0o600); err != nil {
		t.Fatal(err)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/changes", nil)
	changes = changesResponse{}
	if err := json.NewDecoder(response.Body).Decode(&changes); err != nil {
		t.Fatal(err)
	}
	if changes.StatsComplete || changes.Additions != 2 {
		t.Fatalf("oversized file statistics = %+v", changes)
	}
	found := false
	for _, file := range changes.Files {
		if file.Path == "oversized.txt" {
			found = true
			if file.StatsComplete {
				t.Fatal("oversized file reported exact statistics")
			}
		}
	}
	if !found {
		t.Fatal("oversized file disappeared from changes")
	}

}

func TestProjectHistoryAndCommit(t *testing.T) {
	srv, manager, cookie := setup(t)
	root := manager.WorkingDir()
	runGitTest(t, root, "init", "-q")
	runGitTest(t, root, "config", "user.name", "YanDock Tests")
	runGitTest(t, root, "config", "user.email", "tests@example.invalid")
	for index := 0; index < 101; index++ {
		if err := os.WriteFile(filepath.Join(root, "history.txt"), []byte(strconv.Itoa(index)+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		runGitTest(t, root, "add", "history.txt")
		runGitTest(t, root, "commit", "-q", "-m", fmt.Sprintf("history %03d", index))
	}
	runGitTest(t, root, "tag", "history-v1")

	response := projectRequest(t, srv, cookie, http.MethodGet, "/api/project/history?limit=100", nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("history status: %d", response.StatusCode)
	}
	var history projectHistoryResponse
	if err := json.NewDecoder(response.Body).Decode(&history); err != nil {
		t.Fatal(err)
	}
	if len(history.Commits) != 100 || !history.Truncated {
		t.Fatalf("history size/truncation: len=%d truncated=%v", len(history.Commits), history.Truncated)
	}
	if history.Commits[0].Subject != "history 100" || len(history.Commits[0].Parents) != 1 {
		t.Fatalf("latest commit: %+v", history.Commits[0])
	}
	foundTag := false
	for _, ref := range history.Refs {
		if ref.Kind == "tag" && ref.Name == "history-v1" && ref.Commit == history.Commits[0].Hash {
			foundTag = true
		}
	}
	if !foundTag {
		t.Fatalf("history refs: %+v", history.Refs)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/history?limit=10", nil)
	var historyPage projectHistoryResponse
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&historyPage) != nil {
		t.Fatalf("history first page status: %d", response.StatusCode)
	}
	if len(historyPage.Commits) != 10 || !historyPage.Truncated || historyPage.Commits[0].Subject != "history 100" {
		t.Fatalf("history first page: %+v", historyPage)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/history?limit=10&offset=10", nil)
	historyPage = projectHistoryResponse{}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&historyPage) != nil {
		t.Fatalf("history second page status: %d", response.StatusCode)
	}
	if len(historyPage.Commits) != 10 || historyPage.Commits[0].Subject != "history 090" {
		t.Fatalf("history second page: %+v", historyPage)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/history?limit=10&offset=100", nil)
	historyPage = projectHistoryResponse{}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&historyPage) != nil {
		t.Fatalf("history page after 100 status: %d", response.StatusCode)
	}
	if len(historyPage.Commits) != 1 || historyPage.Commits[0].Subject != "history 000" || historyPage.Truncated {
		t.Fatalf("history page after 100: %+v", historyPage)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/commit?hash="+history.Commits[0].Hash, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("commit status: %d", response.StatusCode)
	}
	var commit projectCommitResponse
	if err := json.NewDecoder(response.Body).Decode(&commit); err != nil {
		t.Fatal(err)
	}
	if commit.Hash != history.Commits[0].Hash || commit.Subject != "history 100" || len(commit.Files) != 1 || commit.Files[0].Path != "history.txt" || commit.Files[0].Status != "M" {
		t.Fatalf("commit details: %+v", commit)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/commit-diff?hash="+history.Commits[0].Hash+"&path=history.txt", nil)
	var commitDiff projectDiffResponse
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&commitDiff) != nil {
		t.Fatalf("commit diff status: %d", response.StatusCode)
	}
	if !commitDiff.Complete || commitDiff.OldContent != "99\n" || commitDiff.NewContent != "100\n" || !bytes.Contains([]byte(commitDiff.Patch), []byte("-99")) || !bytes.Contains([]byte(commitDiff.Patch), []byte("+100")) {
		t.Fatalf("commit diff: %+v", commitDiff)
	}
	if err := os.WriteFile(filepath.Join(root, "binary.dat"), []byte{0, 1, 2, 3}, 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, root, "add", "binary.dat")
	runGitTest(t, root, "commit", "-q", "-m", "binary commit")
	binaryHash := gitOutputTest(t, root, "rev-parse", "HEAD")
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/commit-diff?hash="+binaryHash+"&path=binary.dat", nil)
	commitDiff = projectDiffResponse{}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&commitDiff) != nil {
		t.Fatalf("binary diff status: %d", response.StatusCode)
	}
	if !commitDiff.Binary || commitDiff.Complete {
		t.Fatalf("binary diff: %+v", commitDiff)
	}
	if err := os.WriteFile(filepath.Join(root, "large-history.txt"), bytes.Repeat([]byte("x"), maxProjectPreview+1), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, root, "add", "large-history.txt")
	runGitTest(t, root, "commit", "-q", "-m", "large commit")
	largeHash := gitOutputTest(t, root, "rev-parse", "HEAD")
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/commit-diff?hash="+largeHash+"&path=large-history.txt", nil)
	commitDiff = projectDiffResponse{}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&commitDiff) != nil {
		t.Fatalf("large diff status: %d", response.StatusCode)
	}
	if commitDiff.Binary || commitDiff.Complete {
		t.Fatalf("large diff: %+v", commitDiff)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/history?limit=101", nil)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("history over limit status: %d", response.StatusCode)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/commit?hash=not-a-hash", nil)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid commit hash status: %d", response.StatusCode)
	}
}

func TestProjectHistoryFromNestedDirectory(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, root, "init", "-q")
	runGitTest(t, root, "config", "user.name", "YanDock Tests")
	runGitTest(t, root, "config", "user.email", "tests@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "outside.txt"), []byte("before\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "file.txt"), []byte("before\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, root, "add", ".")
	runGitTest(t, root, "commit", "-q", "-m", "initial")
	if err := os.WriteFile(filepath.Join(root, "outside.txt"), []byte("outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "file.txt"), []byte("after\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, root, "add", ".")
	runGitTest(t, root, "commit", "-q", "-m", "nested change")
	hash := gitOutputTest(t, root, "rev-parse", "HEAD")
	if err := os.WriteFile(filepath.Join(root, "outside.txt"), []byte("outside only\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, root, "add", "outside.txt")
	runGitTest(t, root, "commit", "-q", "-m", "outside-only change")

	history, err := gitHistory(context.Background(), nested, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Commits) != 2 || history.Commits[0].Subject != "nested change" || history.Commits[1].Subject != "initial" {
		t.Fatalf("nested history: %+v", history.Commits)
	}

	commit, err := gitCommitDetails(context.Background(), nested, hash)
	if err != nil {
		t.Fatal(err)
	}
	if len(commit.Files) != 1 || commit.Files[0].Path != "file.txt" {
		t.Fatalf("nested commit files: %+v", commit.Files)
	}
	diff, err := gitCommitDiff(context.Background(), nested, hash, "file.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !diff.Complete || diff.OldContent != "before\n" || diff.NewContent != "after\n" || !bytes.Contains([]byte(diff.Patch), []byte("-before")) || !bytes.Contains([]byte(diff.Patch), []byte("+after")) {
		t.Fatalf("nested commit diff: %+v", diff)
	}
}

func TestProjectDirectoryTracksSelectedSession(t *testing.T) {
	srv, manager, cookie := setup(t)
	root := manager.WorkingDir()
	nested := filepath.Join(root, "subdir")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	nested, err := filepath.EvalSymlinks(nested)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "root.txt"), []byte("root"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "nested.txt"), []byte("nested"), 0o644); err != nil {
		t.Fatal(err)
	}
	current, err := manager.Create(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if err := current.Write([]byte("cd subdir\n")); err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		cwd, cwdErr := current.CurrentDirectory()
		if cwdErr == nil && cwd == nested {
			break
		}
		select {
		case <-deadline.C:
			t.Fatalf("terminal did not change directory: cwd=%q err=%v", cwd, cwdErr)
		case <-ticker.C:
		}
	}

	response := projectRequest(t, srv, cookie, http.MethodGet, "/api/session/"+current.Info().ID+"/cwd", nil)
	var directoryInfo struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&directoryInfo) != nil || directoryInfo.ID == "" || directoryInfo.Name != "subdir" {
		t.Fatalf("terminal directory response status=%d value=%+v", response.StatusCode, directoryInfo)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/files?session="+current.Info().ID, nil)
	var files filesResponse
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&files) != nil {
		t.Fatalf("current directory file list status=%d", response.StatusCode)
	}
	if len(files.Files) != 1 || files.Files[0].Name != "nested.txt" {
		t.Fatalf("project panel did not follow terminal cwd: %+v", files.Files)
	}

	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/files", nil)
	files = filesResponse{}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&files) != nil {
		t.Fatalf("default directory file list status=%d", response.StatusCode)
	}
	if len(files.Files) != 2 || files.Files[0].Name != "subdir" || files.Files[1].Name != "root.txt" {
		t.Fatalf("default project root changed unexpectedly: %+v", files.Files)
	}
}

func TestProjectLimitsAndNonGitDirectory(t *testing.T) {
	srv, manager, cookie := setup(t)
	if err := os.WriteFile(filepath.Join(manager.WorkingDir(), "large.txt"), bytes.Repeat([]byte("x"), maxProjectPreview+1), 0o600); err != nil {
		t.Fatal(err)
	}
	response := projectRequest(t, srv, cookie, http.MethodGet, "/api/project/file?path=large.txt", nil)
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("large preview status: %d", response.StatusCode)
	}
	if err := os.WriteFile(filepath.Join(manager.WorkingDir(), "binary.dat"), []byte{0xff, 0x00, 0x01}, 0o600); err != nil {
		t.Fatal(err)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/file?path=binary.dat", nil)
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("binary preview status: %d", response.StatusCode)
	}
	downloadFile, err := os.Create(filepath.Join(manager.WorkingDir(), "too-large-download.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if err := downloadFile.Truncate(maxProjectDownload + 1); err != nil {
		_ = downloadFile.Close()
		t.Fatal(err)
	}
	if err := downloadFile.Close(); err != nil {
		t.Fatal(err)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/download?path=too-large-download.bin", nil)
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("large download status: %d", response.StatusCode)
	}

	var payload bytes.Buffer
	multipartWriter := multipart.NewWriter(&payload)
	part, err := multipartWriter.CreateFormFile("file", "too-large.bin")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(bytes.Repeat([]byte("x"), maxProjectUpload+1))
	_ = multipartWriter.Close()
	request, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/project/upload", &payload)
	request.Header.Set("Origin", srv.URL)
	request.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	request.AddCookie(cookie)
	response = doProjectRequest(t, request)
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("large upload status: %d", response.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(manager.WorkingDir(), "too-large.bin")); !os.IsNotExist(err) {
		t.Fatalf("oversized upload left a file behind, err=%v", err)
	}
	response = projectRequest(t, srv, cookie, http.MethodGet, "/api/project/changes", nil)
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("non-Git changes status: %d", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "无法读取 Git 更改\n" {
		t.Fatalf("non-Git changes error = %q, err=%v", body, err)
	}
}

func runGitTest(t *testing.T, directory string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}

func gitOutputTest(t *testing.T, directory string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	output, err := command.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(output))
}

func TestProjectTextLineBudgetAndCancellation(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string][]byte{
		"small": []byte("one\ntwo"), "binary": {0, 1},
		"large": bytes.Repeat([]byte("x"), maxProjectStatFile+1),
	} {
		if err := os.WriteFile(filepath.Join(dir, name), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, test := range []struct {
		name     string
		budget   int64
		lines    int
		complete bool
	}{
		{"small", 7, 2, true}, {"small", 6, 0, false},
		{"binary", 2, 0, true}, {"large", maxProjectStatTotal, 0, false},
	} {
		t.Run(test.name+strconv.FormatInt(test.budget, 10), func(t *testing.T) {
			budget := test.budget
			lines, complete := countProjectTextLines(context.Background(), root, test.name, &budget)
			if lines != test.lines || complete != test.complete {
				t.Fatalf("got %d/%v, want %d/%v", lines, complete, test.lines, test.complete)
			}
			if !complete && budget != test.budget {
				t.Fatal("oversized file consumed read budget")
			}
		})
	}
	budget := int64(10)
	if _, ok := countProjectTextLines(context.Background(), root, "small", &budget); !ok {
		t.Fatal("first read failed")
	}
	if _, ok := countProjectTextLines(context.Background(), root, "small", &budget); ok {
		t.Fatal("aggregate budget exceeded")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	budget = maxProjectStatTotal
	if _, ok := countProjectTextLines(ctx, root, "small", &budget); ok || budget != maxProjectStatTotal {
		t.Fatal("cancelled request read file")
	}
}
