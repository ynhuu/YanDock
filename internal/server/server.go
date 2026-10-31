// Package server exposes authenticated HTTP APIs, terminal WebSockets and
// embedded frontend assets. PTYs remain owned by the session manager.
package server

import (
	"io/fs"
	"net/http"
	"strings"

	"yandock/internal/auth"
	"yandock/internal/session"
)

type Server struct {
	auth    *auth.Auth
	manager *session.Manager
}

func New(a *auth.Auth, m *session.Manager, assets fs.FS) http.Handler {
	s := &Server{auth: a, manager: m}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/auth", s.checkAuth)
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.protect(func(w http.ResponseWriter, r *http.Request) {
		a.Logout(w, r)
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /api/sessions", s.protect(s.list))
	mux.HandleFunc("POST /api/session", s.protect(s.create))
	mux.HandleFunc("DELETE /api/session/{id}", s.protect(s.remove))
	mux.HandleFunc("GET /api/session/{id}/cwd", s.protect(s.currentDirectory))
	mux.HandleFunc("GET /api/session/{id}/terminal", s.protect(s.terminal))
	mux.HandleFunc("GET /api/project/files", s.protect(s.projectFiles))
	mux.HandleFunc("GET /api/project/file", s.protect(s.projectPreview))
	mux.HandleFunc("DELETE /api/project/file", s.protect(s.projectFileDelete))
	mux.HandleFunc("GET /api/project/download", s.protect(s.projectDownload))
	mux.HandleFunc("POST /api/project/upload", s.protect(s.projectUpload))
	mux.HandleFunc("GET /api/project/changes", s.protect(s.projectChanges))
	mux.HandleFunc("GET /api/project/history", s.protect(s.projectHistory))
	mux.HandleFunc("GET /api/project/commit", s.protect(s.projectCommit))
	mux.HandleFunc("GET /api/project/commit-diff", s.protect(s.projectCommitDiff))
	mux.HandleFunc("GET /api/project/diff", s.protect(s.projectDiff))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	files := http.FileServerFS(assets)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "方法不允许", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		setStaticAssetCache(w, assets, r.URL.Path)
		files.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}

func setStaticAssetCache(w http.ResponseWriter, assets fs.FS, requestPath string) {
	if !strings.HasPrefix(requestPath, "/assets/") {
		return
	}

	name := strings.TrimPrefix(requestPath, "/")
	if !fs.ValidPath(name) {
		return
	}
	info, err := fs.Stat(assets, name)
	if err != nil || info.IsDir() {
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
}
