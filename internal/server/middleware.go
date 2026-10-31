package server

import (
	"net/http"
	"net/url"
)

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || origin == "null" {
		return false
	}
	u, err := url.Parse(origin)
	// An HTTPS proxy must preserve the external Host and browser Origin. Never
	// trust forwarded headers supplied by clients to bypass this comparison.
	return err == nil && (u.Scheme == "https" || (u.Scheme == "http" && r.TLS == nil)) && u.Host == r.Host && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}

func (s *Server) protect(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.Valid(r) {
			http.Error(w, "请先登录", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet && !sameOrigin(r) {
			http.Error(w, "请求来源不允许", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}
