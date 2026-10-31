// Package auth provides bounded, in-memory single-user browser sessions.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"
)

const CookieName = "yandock_session"

type Auth struct {
	mu        sync.Mutex
	token     [32]byte
	sessionID string
	expires   time.Time
	revoked   chan struct{}
	attempts  int
	window    time.Time
	now       func() time.Time
}

func New(token string) *Auth {
	return &Auth{token: sha256.Sum256([]byte(token)), now: time.Now}
}

// Login limits failed attempts to bound brute-force guessing. Successful
// logins are not counted. Only the latest successful login remains valid.
func (a *Auth) Login(w http.ResponseWriter, r *http.Request, token string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	if now.Sub(a.window) >= time.Minute {
		a.window, a.attempts = now, 0
	}
	if a.attempts >= 5 {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "登录尝试过多，请稍后重试", http.StatusTooManyRequests)
		return false
	}
	hash := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare(hash[:], a.token[:]) != 1 {
		a.attempts++
		http.Error(w, "凭据无效", http.StatusUnauthorized)
		return false
	}
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		http.Error(w, "无法创建登录会话", http.StatusInternalServerError)
		return false
	}
	id := hex.EncodeToString(bytes[:])
	if a.revoked != nil {
		close(a.revoked)
	}
	a.sessionID, a.expires = id, now.Add(12*time.Hour)
	a.revoked = make(chan struct{})
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: id, Path: "/", HttpOnly: true, Secure: r.TLS != nil || strings.HasPrefix(strings.ToLower(r.Header.Get("Origin")), "https://"), SameSite: http.SameSiteStrictMode, MaxAge: 12 * 60 * 60})
	return true
}

func (a *Auth) Valid(r *http.Request) bool {
	_, valid := a.Watch(r)
	return valid
}

// Watch validates the login and returns its revocation signal. Connections
// sharing a login are notified together on logout or a later successful login.
func (a *Auth) Watch(r *http.Request) (<-chan struct{}, bool) {
	c, err := r.Cookie(CookieName)
	if err != nil {
		return nil, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.revoked == nil || c.Value != a.sessionID {
		return nil, false
	}
	if !a.now().Before(a.expires) {
		close(a.revoked)
		a.sessionID, a.revoked = "", nil
		return nil, false
	}
	return a.revoked, true
}

func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	if c, err := r.Cookie(CookieName); err == nil && c.Value == a.sessionID && a.revoked != nil {
		close(a.revoked)
		a.sessionID, a.revoked = "", nil
	}
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: CookieName, Path: "/", HttpOnly: true, Secure: r.TLS != nil || strings.HasPrefix(strings.ToLower(r.Header.Get("Origin")), "https://"), SameSite: http.SameSiteStrictMode, MaxAge: -1})
}
