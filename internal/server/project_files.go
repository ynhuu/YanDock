package server

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	maxProjectPreview  = 1 << 20
	maxProjectUpload   = 10 << 20
	maxProjectDownload = 128 << 20
	maxProjectFiles    = 5000
)

type projectFile struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

type filesResponse struct {
	Files     []projectFile `json:"files"`
	Truncated bool          `json:"truncated"`
}

func (s *Server) projectFiles(w http.ResponseWriter, r *http.Request) {
	root, relative, err := s.projectDirectory(r.Context(), r.URL.Query().Get("session"), r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "目录不存在或路径无效", http.StatusBadRequest)
		return
	}
	defer root.Close()
	file, err := root.Open(relative)
	if err != nil {
		http.Error(w, "无法读取目录", http.StatusNotFound)
		return
	}
	defer file.Close()
	entries, err := file.ReadDir(maxProjectFiles + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		http.Error(w, "路径不是目录", http.StatusBadRequest)
		return
	}
	showHidden := r.URL.Query().Get("hidden") == "1"
	truncated := len(entries) > maxProjectFiles
	if truncated {
		entries = entries[:maxProjectFiles]
	}
	result := make([]projectFile, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.EqualFold(name, ".git") || (!showHidden && strings.HasPrefix(name, ".")) || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() && !info.IsDir() {
			continue
		}
		child := name
		if relative != "." {
			child = filepath.Join(relative, name)
		}
		result = append(result, projectFile{Name: name, Path: filepath.ToSlash(child), IsDir: info.IsDir(), Size: info.Size()})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	respond(w, filesResponse{Files: result, Truncated: truncated})
}

func (s *Server) projectFileDelete(w http.ResponseWriter, r *http.Request) {
	root, relative, info, err := s.projectFile(r.Context(), r.URL.Query().Get("session"), r.URL.Query().Get("path"), true)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	if !info.Mode().IsRegular() && !info.IsDir() {
		http.Error(w, "只能删除普通文件或目录", http.StatusBadRequest)
		return
	}
	if err := root.RemoveAll(relative); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.NotFound(w, r)
		} else {
			http.Error(w, "无法删除文件", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) projectDownload(w http.ResponseWriter, r *http.Request) {
	root, relative, info, err := s.projectFile(r.Context(), r.URL.Query().Get("session"), r.URL.Query().Get("path"), true)
	if err != nil || !info.Mode().IsRegular() {
		if root != nil {
			_ = root.Close()
		}
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	if info.Size() > maxProjectDownload {
		http.Error(w, "文件超过 128 MiB 下载上限", http.StatusRequestEntityTooLarge)
		return
	}
	file, err := root.Open(relative)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	name := filepath.Base(relative)
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name})
	if disposition == "" {
		disposition = `attachment; filename="download"`
	}
	w.Header().Set("Content-Disposition", disposition)
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

func (s *Server) projectUpload(w http.ResponseWriter, r *http.Request) {
	root, directory, err := s.projectDirectory(r.Context(), r.URL.Query().Get("session"), r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, "上传目录不存在或路径无效", http.StatusBadRequest)
		return
	}
	defer root.Close()
	if r.ContentLength > maxProjectUpload+128*1024 {
		http.Error(w, "单个文件不能超过 10 MiB", http.StatusRequestEntityTooLarge)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxProjectUpload+128*1024)
	parseErr := r.ParseMultipartForm(1 << 20)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if parseErr != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(parseErr, &tooLarge) {
			http.Error(w, "单个文件不能超过 10 MiB", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "上传表单无效", http.StatusBadRequest)
		}
		return
	}
	if r.MultipartForm == nil || len(r.MultipartForm.File) != 1 || len(r.MultipartForm.File["file"]) != 1 || len(r.MultipartForm.Value) != 0 {
		http.Error(w, "每次只能上传一个文件", http.StatusBadRequest)
		return
	}
	header := r.MultipartForm.File["file"][0]
	if header.Size > maxProjectUpload {
		http.Error(w, "单个文件不能超过 10 MiB", http.StatusRequestEntityTooLarge)
		return
	}
	name := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	if name == "." || name == ".." || name == "" || strings.EqualFold(name, ".git") || strings.ContainsRune(name, 0) {
		http.Error(w, "文件名无效", http.StatusBadRequest)
		return
	}
	target := name
	if directory != "." {
		target = filepath.Join(directory, name)
	}
	if _, err := projectInfo(root, target, false); err == nil {
		http.Error(w, "同名文件已存在，未覆盖", http.StatusConflict)
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		http.Error(w, "无法写入目标目录", http.StatusBadRequest)
		return
	}
	input, err := header.Open()
	if err != nil {
		http.Error(w, "无法读取上传文件", http.StatusBadRequest)
		return
	}
	defer input.Close()
	output, err := root.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			http.Error(w, "同名文件已存在，未覆盖", http.StatusConflict)
		} else {
			http.Error(w, "无法创建上传文件", http.StatusBadRequest)
		}
		return
	}
	written, copyErr := io.Copy(output, io.LimitReader(input, maxProjectUpload+1))
	closeErr := output.Close()
	if copyErr != nil || closeErr != nil || written > maxProjectUpload {
		_ = root.Remove(target)
		if written > maxProjectUpload {
			http.Error(w, "单个文件不能超过 10 MiB", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "上传文件写入失败", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) projectPreview(w http.ResponseWriter, r *http.Request) {
	root, relative, info, err := s.projectFile(r.Context(), r.URL.Query().Get("session"), r.URL.Query().Get("path"), r.URL.Query().Get("hidden") == "1")
	if err != nil {
		http.Error(w, "文件不存在或路径无效", http.StatusNotFound)
		return
	}
	defer root.Close()
	if !info.Mode().IsRegular() {
		http.Error(w, "只能预览普通文件", http.StatusBadRequest)
		return
	}
	imageType := ""
	limit := int64(maxProjectPreview)
	if r.URL.Query().Get("image") == "1" {
		imageType = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".svg": "image/svg+xml"}[strings.ToLower(filepath.Ext(relative))]
		if imageType == "" {
			http.Error(w, "不支持此图片格式", http.StatusUnsupportedMediaType)
			return
		}
		limit = 10 << 20
	}
	if info.Size() > limit {
		if imageType != "" {
			http.Error(w, "图片超过 10 MiB，无法预览", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "文件超过 1 MiB，无法预览", http.StatusRequestEntityTooLarge)
		return
	}
	file, err := root.Open(relative)
	if err != nil {
		http.Error(w, "无法读取文件", http.StatusNotFound)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		http.Error(w, "无法读取文件", http.StatusInternalServerError)
		return
	}
	if int64(len(data)) > limit {
		http.Error(w, "文件超过预览大小限制", http.StatusRequestEntityTooLarge)
		return
	}
	if imageType != "" {
		w.Header().Set("Content-Type", imageType)
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
		w.Header().Set("Content-Disposition", "attachment")
		_, _ = w.Write(data)
		return
	}
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		http.Error(w, "二进制文件不支持文本预览", http.StatusUnsupportedMediaType)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(data)
}
