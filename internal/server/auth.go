package server

import "net/http"

func (s *Server) checkAuth(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Valid(r) {
		http.Error(w, "请先登录", http.StatusUnauthorized)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "请求来源不允许", http.StatusForbidden)
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if decode(w, r, &body) != nil {
		http.Error(w, "登录请求无效", http.StatusBadRequest)
		return
	}
	if s.auth.Login(w, r, body.Token) {
		w.WriteHeader(http.StatusNoContent)
	}
}
