package server

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"path/filepath"

	"yandock/internal/session"
)

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	respond(w, s.manager.List())
}

func (s *Server) currentDirectory(w http.ResponseWriter, r *http.Request) {
	current := s.manager.Get(r.PathValue("id"))
	if current == nil {
		http.NotFound(w, r)
		return
	}
	directory, err := current.CurrentDirectoryContext(r.Context())
	if err != nil {
		http.Error(w, "无法读取终端当前目录", http.StatusServiceUnavailable)
		return
	}
	identity := sha256.Sum256([]byte(filepath.Clean(directory)))
	name := filepath.Base(filepath.Clean(directory))
	if name == "." || name == string(filepath.Separator) {
		name = "工作目录"
	}
	respond(w, struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}{ID: hex.EncodeToString(identity[:]), Name: name})
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cols uint16 `json:"cols"`
		Rows uint16 `json:"rows"`
	}
	if decode(w, r, &body) != nil || !session.ValidSize(body.Cols, body.Rows) {
		http.Error(w, "终端尺寸无效", http.StatusBadRequest)
		return
	}
	current, err := s.manager.Create(body.Cols, body.Rows)
	if err != nil {
		http.Error(w, "无法启动程序，请检查服务端可执行文件和工作目录配置", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	respond(w, current.Info())
}

func (s *Server) remove(w http.ResponseWriter, r *http.Request) {
	if !s.manager.Remove(r.PathValue("id")) {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
